import type { ProjectRelation } from "@/lib/permissions";
import type { Db } from "./db";

export interface RelationUser { id: string; organizationId: string | null; role: "admin" | "manager" | "member" | null }

export async function projectRelation(db: Db, user: RelationUser, projectId: string): Promise<{ relation: ProjectRelation; organizationId: string } | null> {
  const [p] = await db<{ organization_id: string; assigned: boolean; client_role: "viewer" | "viewer_with_refresh" | null }[]>`
    select p.organization_id,
      exists (select 1 from project_assignments a where a.project_id = p.id and a.user_id = ${user.id}) as assigned,
      (select c.role from client_project_access c where c.project_id = p.id and c.user_id = ${user.id}
         and c.revoked_at is null and (c.expires_at is null or c.expires_at > now()) limit 1) as client_role
    from projects p where p.id = ${projectId}`;
  if (!p) return null;
  if (user.organizationId === p.organization_id && user.role) {
    return { relation: { kind: "org", role: user.role, assigned: p.assigned }, organizationId: p.organization_id };
  }
  if (p.client_role) return { relation: { kind: "client", role: p.client_role }, organizationId: p.organization_id };
  return { relation: { kind: "none" }, organizationId: p.organization_id };
}

