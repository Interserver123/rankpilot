import type { Sql } from "./db";
import { audit } from "./audit";
import { hashPassword, passwordProblem, verifyPassword } from "./passwords";
import { createSession, revokeUserSessions } from "./sessions";

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
export async function setupFirstAdmin(sql: Sql, input: { name: string; email: string; password: string; agencyName: string }) {
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
  const problem = passwordProblem(password, m.email);
  if (problem) throw new AccountError(problem);
  await sql`update users set password_hash = ${await hashPassword(password)}, password_updated_at = now() where id = ${userId}`;
  await revokeUserSessions(sql, userId);
  await audit(sql, { organizationId: actor.organizationId, actorUserId: actor.id, action: "member.password_set", entityType: "user", entityId: userId });
}
