import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { generateTemporaryPassword, hashPassword, passwordProblem, verifyPassword } from "@/server/passwords";
import { AccountError, changeOwnPassword, hasOrganization, passwordSignIn, setMemberPassword, setupFirstAdmin } from "@/server/accounts";
import { resolveSession, revokeSession } from "@/server/sessions";
import { hasTestDb, resetDatabase, teardown } from "./helpers/db";

describe("passwords", () => {
  it("hashes with a random salt and verifies", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("wrong horse battery", a)).toBe(false);
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await verifyPassword("anything", "garbage")).toBe(false);
  });

  it("rejects weak passwords and generates strong temporary ones", () => {
    expect(passwordProblem("short")).toMatch(/at least/);
    expect(passwordProblem("aaaaaaaaaaaa")).toBeTruthy();
    expect(passwordProblem("shuvro-secret-1", "shuvro@agency.com")).toMatch(/email/);
    expect(passwordProblem("a long and fine passphrase")).toBeNull();
    const t = generateTemporaryPassword();
    expect(t).toHaveLength(16);
    expect(passwordProblem(t)).toBeNull();
  });
});

const d = hasTestDb ? describe : describe.skip;

d("password accounts (requires DATABASE_URL_TEST)", () => {
  let sql: postgres.Sql;
  beforeAll(async () => { sql = await resetDatabase(); });
  afterAll(async () => { await teardown(); });
  beforeEach(async () => { await sql`truncate organizations, users cascade`; });

  const admin = { name: "Shuvro", email: "owner@agency.test", password: "first admin password", agencyName: "Pilot Agency" };

  it("sets up the first admin exactly once", async () => {
    expect(await hasOrganization(sql)).toBe(false);
    await setupFirstAdmin(sql, admin);
    expect(await hasOrganization(sql)).toBe(true);
    await expect(setupFirstAdmin(sql, { ...admin, email: "attacker@x.test" })).rejects.toBeInstanceOf(AccountError);
    const [m] = await sql`select m.role from organization_members m join users u on u.id = m.user_id where u.email = ${admin.email}`;
    expect(m!.role).toBe("admin");
  });

  it("signs in with correct credentials only, and sessions can be revoked", async () => {
    await setupFirstAdmin(sql, admin);
    expect(await passwordSignIn(sql, admin.email, "wrong password here", {})).toBeNull();
    expect(await passwordSignIn(sql, "nobody@x.test", admin.password, {})).toBeNull();
    const s = await passwordSignIn(sql, "OWNER@agency.test", admin.password, {});
    expect(s).not.toBeNull();
    expect(await resolveSession(sql, s!.token)).toBe(s!.userId);
    const [row] = await sql`select token_hash from auth_sessions`;
    expect(row!.token_hash).not.toBe(s!.token); // only the hash is stored
    await revokeSession(sql, s!.token);
    expect(await resolveSession(sql, s!.token)).toBeNull();
  });

  it("changing a password signs out other sessions; disabled users cannot sign in", async () => {
    const { userId } = await setupFirstAdmin(sql, admin);
    const a = (await passwordSignIn(sql, admin.email, admin.password, {}))!;
    const b = (await passwordSignIn(sql, admin.email, admin.password, {}))!;
    await expect(changeOwnPassword(sql, userId, "not my password", "a brand new passphrase", a.token)).rejects.toBeInstanceOf(AccountError);
    await changeOwnPassword(sql, userId, admin.password, "a brand new passphrase", a.token);
    expect(await resolveSession(sql, a.token)).toBe(userId);
    expect(await resolveSession(sql, b.token)).toBeNull();
    expect(await passwordSignIn(sql, admin.email, admin.password, {})).toBeNull();
    await sql`update users set status = 'disabled' where id = ${userId}`;
    expect(await passwordSignIn(sql, admin.email, "a brand new passphrase", {})).toBeNull();
    expect(await resolveSession(sql, a.token)).toBeNull();
  });

  it("admins can only set passwords for members of their own organization", async () => {
    const { userId } = await setupFirstAdmin(sql, admin);
    const [org] = await sql<{ id: string }[]>`select id from organizations`;
    const [other] = await sql<{ id: string }[]>`insert into users (email) values ('outsider@else.test') returning id`;
    await expect(setMemberPassword(sql, { id: userId, organizationId: org!.id }, other!.id, "temporary password 1")).rejects.toBeInstanceOf(AccountError);
    await sql`insert into organization_members (organization_id, user_id, role) values (${org!.id}, ${other!.id}, 'member')`;
    await setMemberPassword(sql, { id: userId, organizationId: org!.id }, other!.id, "temporary password 1");
    expect(await passwordSignIn(sql, "outsider@else.test", "temporary password 1", {})).not.toBeNull();
  });
});
