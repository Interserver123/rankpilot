import type { Sql } from "./db";
import { audit } from "./audit";
import { hashPassword, passwordProblem, verifyPassword } from "./passwords";
import { createSession, revokeUserSessions } from "./sessions";
import { isOwnerEmail, ownerEmail, ownerSetupCode } from "./owner";
import { timingSafeEqual } from "node:crypto";

export class AccountError extends Error {}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "agency";
}

export async function hasOrganization(sql: Sql): Promise<boolean> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from organizations`;
  return (r?.n ?? 0) > 0;
}

/**
 * First-run setup: creates the agency and its first administrator. Only possible while no
 * organization exists; serialized so two concurrent setups cannot both succeed.
 */
export async function setupFirstAdmin(sql: Sql, input: { name: string; email: string; password: string; agencyName: string; setupCode?: string }) {
  if (!isOwnerEmail(input.email)) throw new AccountError("Only the workspace owner can set up this workspace.");
  checkSetupCode(input.setupCode);
  const problem = passwordProblem(input.password, input.email);
  if (problem) throw new AccountError(problem);
  const hash = await hashPassword(input.password);
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('provision-user'))`;
    const [{ n } = { n: 0 }] = await tx<{ n: number }[]>`select count(*)::int as n from organizations`;
    if (n > 0) throw new AccountError("This workspace is already set up. Sign in instead.");
    const [org] = await tx<{ id: string }[]>`insert into organizations (name, slug) values (${input.agencyName}, ${slugify(input.agencyName)}) returning id`;
    const [user] = await tx<{ id: string }[]>`
      insert into users (email, name, password_hash, password_updated_at) values (${input.email}, ${input.name}, ${hash}, now())
      on conflict (lower(email)) do update set name = excluded.name, password_hash = excluded.password_hash, password_updated_at = now()
      returning id`;
    await tx`insert into organization_members (organization_id, user_id, role) values (${org!.id}, ${user!.id}, 'admin')`;
    await tx`update organizations set owner_user_id = ${user!.id} where id = ${org!.id}`;
    await audit(tx, { organizationId: org!.id, actorUserId: user!.id, action: "organization.bootstrapped", entityType: "organization", entityId: org!.id });
    return { userId: user!.id };
  });
}

/** Verifies credentials and opens a session. Returns null on any failure (no account enumeration). */
export async function passwordSignIn(sql: Sql, email: string, password: string, meta: { userAgent?: string | null; ip?: string | null }) {
  const [user] = await sql<{ id: string; password_hash: string | null; status: string }[]>`
    select id, password_hash, status from users where lower(email) = lower(${email})`;
  const ok = await verifyPassword(password, user?.password_hash);
  if (!user || !ok || user.status !== "active") return null;
  return { userId: user.id, ...(await createSession(sql, user.id, meta)) };
}

export async function changeOwnPassword(sql: Sql, userId: string, current: string, next: string, keepToken?: string) {
  const [user] = await sql<{ email: string; password_hash: string | null }[]>`select email, password_hash from users where id = ${userId}`;
  if (!user || !(await verifyPassword(current, user.password_hash))) throw new AccountError("Current password is incorrect.");
  const problem = passwordProblem(next, user.email);
  if (problem) throw new AccountError(problem);
  await sql`update users set password_hash = ${await hashPassword(next)}, password_updated_at = now() where id = ${userId}`;
  // Sign out every other device.
  await revokeUserSessions(sql, userId, keepToken);
}

/** Admin sets (or resets) a member's password; all of that member's sessions are revoked. */
export async function setMemberPassword(sql: Sql, actor: { id: string; organizationId: string }, userId: string, password: string) {
  const [m] = await sql<{ email: string }[]>`
    select u.email from organization_members m join users u on u.id = m.user_id
    where m.user_id = ${userId} and m.organization_id = ${actor.organizationId}`;
  if (!m) throw new AccountError("Member not found.");
  if (await isOwner(sql, actor.organizationId, userId)) throw new AccountError("Only the owner can change the owner's password.");
  const problem = passwordProblem(password, m.email);
  if (problem) throw new AccountError(problem);
  await sql`update users set password_hash = ${await hashPassword(password)}, password_updated_at = now() where id = ${userId}`;
  await revokeUserSessions(sql, userId);
  await audit(sql, { organizationId: actor.organizationId, actorUserId: actor.id, action: "member.password_set", entityType: "user", entityId: userId });
}

function checkSetupCode(given: string | undefined) {
  const code = ownerSetupCode();
  if (!code) return;
  const a = Buffer.from(given ?? ""), b = Buffer.from(code);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AccountError("The setup code is incorrect.");
}

export type OwnerState = "no_workspace" | "owner_needs_password" | "ready";

/** Whether the sign-in page should offer workspace setup or the owner's first password. */
export async function ownerState(sql: Sql): Promise<OwnerState> {
  if (!(await hasOrganization(sql))) return "no_workspace";
  const [u] = await sql<{ password_hash: string | null }[]>`select password_hash from users where lower(email) = ${ownerEmail()}`;
  return u?.password_hash ? "ready" : "owner_needs_password";
}

/**
 * The owner sets their password for the first time. Allowed only while the owner account has no
 * password; makes them an admin and the owner of the workspace.
 */
export async function claimOwner(sql: Sql, input: { name?: string; password: string; setupCode?: string }) {
  checkSetupCode(input.setupCode);
  const email = ownerEmail();
  const problem = passwordProblem(input.password, email);
  if (problem) throw new AccountError(problem);
  const hash = await hashPassword(input.password);
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('provision-user'))`;
    const [org] = await tx<{ id: string }[]>`select id from organizations order by created_at limit 1`;
    if (!org) throw new AccountError("No workspace exists yet.");
    const [existing] = await tx<{ id: string; password_hash: string | null }[]>`select id, password_hash from users where lower(email) = ${email} for update`;
    if (existing?.password_hash) throw new AccountError("The owner password is already set. Sign in instead.");
    const userId = existing?.id ?? (await tx<{ id: string }[]>`
      insert into users (email, name) values (${email}, ${input.name || email.split("@")[0]!}) returning id`)[0]!.id;
    await tx`update users set password_hash = ${hash}, password_updated_at = now(), status = 'active',
      name = coalesce(nullif(${input.name ?? ""}, ''), name) where id = ${userId}`;
    await tx`insert into organization_members (organization_id, user_id, role) values (${org.id}, ${userId}, 'admin')
      on conflict (organization_id, user_id) do update set role = 'admin'`;
    await tx`update organizations set owner_user_id = ${userId} where id = ${org.id}`;
    await audit(tx, { organizationId: org.id, actorUserId: userId, action: "owner.claimed", entityType: "user", entityId: userId });
    return { userId };
  });
}

/** True when `userId` is the owner of the organization. */
export async function isOwner(sql: Sql, organizationId: string, userId: string): Promise<boolean> {
  const [r] = await sql`select 1 from organizations where id = ${organizationId} and owner_user_id = ${userId}`;
  return Boolean(r);
}
