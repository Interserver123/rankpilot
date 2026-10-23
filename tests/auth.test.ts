import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { generateTemporaryPassword, hashPassword, passwordProblem, verifyPassword } from "@/server/passwords";
import { AccountError, changeOwnPassword, claimOwner, hasOrganization, ownerState, passwordSignIn, setMemberPassword, setupFirstAdmin } from "@/server/accounts";
import { removeMember, addMember } from "@/server/services/admin";
import { classifyDbError, ensureSchema } from "@/server/schema";
import { bundledMigrationsSource } from "../scripts/bundle-migrations";
import { readFile } from "node:fs/promises";
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

process.env.OWNER_EMAIL = "owner@agency.test";

describe("setup helpers", () => {
  it("bundled migrations are up to date with supabase/migrations", async () => {
    expect(await readFile("src/server/migrations.generated.ts", "utf8")).toBe(await bundledMigrationsSource());
  });

  it("classifies database errors without leaking details", () => {
    expect(classifyDbError(Object.assign(new Error("x"), { name: "DatabaseConfigError" })).kind).toBe("no_database_url");
    expect(classifyDbError({ code: "ECONNREFUSED", message: "connect ECONNREFUSED 10.0.0.1:5432" })).toMatchObject({ kind: "cannot_connect" });
    expect(classifyDbError({ code: "28P01" }).detail).toMatch(/password was rejected/);
    expect(classifyDbError({ code: "42P01" }).kind).toBe("schema");
  });
});

const d = hasTestDb ? describe : describe.skip;

d("password accounts (requires DATABASE_URL_TEST)", () => {
  let sql: postgres.Sql;
  beforeAll(async () => { sql = await resetDatabase(); });
  afterAll(async () => { await teardown(); });
  beforeEach(async () => { await sql`truncate organizations, users cascade`; });

  const admin = { name: "Shuvro", email: "owner@agency.test", password: "first admin password", agencyName: "Pilot Agency" };

  it("only the owner email can create the workspace", async () => {
    await expect(setupFirstAdmin(sql, { ...admin, email: "someone@else.test" })).rejects.toBeInstanceOf(AccountError);
    expect(await hasOrganization(sql)).toBe(false);
  });

  it("owner can set a first password on an existing workspace, once, and is admin + owner", async () => {
    const [org] = await sql<{ id: string }[]>`insert into organizations (name, slug) values ('Existing', 'existing') returning id`;
    expect(await ownerState(sql)).toBe("owner_needs_password");
    await expect(claimOwner(sql, { password: "short", })).rejects.toBeInstanceOf(AccountError);
    const { userId } = await claimOwner(sql, { name: "Ratul", password: "silver harbor 2026" });
    expect(await ownerState(sql)).toBe("ready");
    await expect(claimOwner(sql, { password: "attacker passphrase" })).rejects.toBeInstanceOf(AccountError);
    const [m] = await sql`select m.role, o.owner_user_id from organization_members m join organizations o on o.id = m.organization_id where m.user_id = ${userId}`;
    expect(m).toMatchObject({ role: "admin", owner_user_id: userId });
    expect(await passwordSignIn(sql, "owner@agency.test", "silver harbor 2026", {})).not.toBeNull();
    // Owner cannot be removed, demoted, or have their password reset by another admin.
    const [other] = await sql<{ id: string }[]>`insert into users (email) values ('admin2@agency.test') returning id`;
    await sql`insert into organization_members (organization_id, user_id, role) values (${org!.id}, ${other!.id}, 'admin')`;
    const actor = { id: other!.id, organizationId: org!.id };
    await expect(removeMember(sql, actor, userId)).rejects.toThrow(/owner/);
    await expect(addMember(sql, actor, "owner@agency.test", "member")).rejects.toThrow(/owner/);
    await expect(setMemberPassword(sql, actor, userId, "hijack passphrase 1")).rejects.toBeInstanceOf(AccountError);
  });

  it("ensureSchema is idempotent", async () => {
    expect((await ensureSchema(sql)).applied).toEqual([]);
  });

  it("sets up the first admin exactly once", async () => {
    expect(await hasOrganization(sql)).toBe(false);
    await setupFirstAdmin(sql, admin);
    expect(await hasOrganization(sql)).toBe(true);
    await expect(setupFirstAdmin(sql, admin)).rejects.toBeInstanceOf(AccountError);
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
