import type { Sql } from "./db";
import { audit } from "./audit";

export interface UserRow { id: string; email: string; name: string | null; status: string; authentication_user_id: string | null }

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "agency";
}

/**
 * Maps an authenticated identity to an app user.
 * - Known auth id → that user.
 * - Email invited by an admin (row without auth id) → linked on first sign-in.
 * - No organization exists yet → first user bootstraps the agency as its admin.
 * - Otherwise → null (authenticated but not authorized; self-registration is disabled).
 */
export async function provisionUser(sql: Sql, authId: string | null, email: string): Promise<UserRow | null> {
  if (authId) {
    const [byAuth] = await sql<UserRow[]>`select * from users where authentication_user_id = ${authId}`;
    if (byAuth) return byAuth;
  }
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('provision-user'))`;
    const [byEmail] = await tx<UserRow[]>`select * from users where lower(email) = lower(${email}) for update`;
    if (byEmail) {
      if (byEmail.authentication_user_id && byEmail.authentication_user_id !== authId) return null;
      const [linked] = await tx<UserRow[]>`
        update users set authentication_user_id = ${authId} where id = ${byEmail.id} returning *`;
      return linked ?? null;
    }
    const [{ n } = { n: 0 }] = await tx<{ n: number }[]>`select count(*)::int as n from organizations`;
    if (n > 0) return null;

    const orgName = process.env.BOOTSTRAP_ORG_NAME?.trim() || "My Agency";
    const [org] = await tx<{ id: string }[]>`
      insert into organizations (name, slug) values (${orgName}, ${slugify(orgName)}) returning id`;
    const [user] = await tx<UserRow[]>`
      insert into users (authentication_user_id, email, name) values (${authId}, ${email}, ${email.split("@")[0] ?? null}) returning *`;
    await tx`insert into organization_members (organization_id, user_id, role) values (${org!.id}, ${user!.id}, 'admin')`;
    await audit(tx, { organizationId: org!.id, actorUserId: user!.id, action: "organization.bootstrapped", entityType: "organization", entityId: org!.id });
    return user ?? null;
  });
}
