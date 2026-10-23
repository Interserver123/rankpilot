import "server-only";
import { notFound, redirect } from "next/navigation";
import { canOrg, canProject, type Action, type OrgRole } from "@/lib/permissions";
import { sql, type Db } from "./db";
import { projectRelation } from "./relations";

export { projectRelation };
import { authIdentity, getCurrentUser, type SessionUser } from "./auth";

export type StaffUser = SessionUser & { organizationId: string; role: OrgRole };

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  // Signed in with the auth provider but not invited to the workspace.
  if (!user) redirect((await authIdentity()) ? "/no-access" : "/sign-in");
  return user;
}

/** Internal agency staff only. Client viewers are sent to their own dashboard. */
export async function requireStaff(action?: Action): Promise<StaffUser> {
  const user = await requireUser();
  if (!user.organizationId || !user.role) redirect("/no-access");
  if (action && !canOrg(user.role, action)) throw new AuthorizationError(action);
  return user as StaffUser;
}

export class AuthorizationError extends Error {
  constructor(action: string) {
    super(`Not permitted: ${action}`);
    this.name = "AuthorizationError";
  }
}

/**
 * Loads the project only if the user may perform `action` on it. Unauthorized and missing
 * projects both return 404 so project ids cannot be probed.
 */
export async function requireProjectAccess(projectId: string, action: Action) {
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) notFound();
  const rel = await projectRelation(sql, user, projectId);
  if (!rel || !canProject(rel.relation, "project.view")) notFound();
  if (!canProject(rel.relation, action)) throw new AuthorizationError(action);
  return { user, relation: rel.relation, organizationId: rel.organizationId };
}

/** SQL fragment restricting projects (alias p) to those visible to a staff user. */
export function visibleProjectsFilter(db: Db, user: StaffUser) {
  return user.role === "member"
    ? db`p.organization_id = ${user.organizationId} and exists (select 1 from project_assignments a where a.project_id = p.id and a.user_id = ${user.id})`
    : db`p.organization_id = ${user.organizationId}`;
}
