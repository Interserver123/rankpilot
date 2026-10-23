export type OrgRole = "admin" | "manager" | "member";
export type ClientRole = "viewer" | "viewer_with_refresh";

export type Action =
  | "project.view"
  | "project.create"
  | "project.update"
  | "project.archive"
  | "keyword.manage"
  | "schedule.update"
  | "scan.manual"
  | "job.view"
  | "usage.view"
  | "budget.manage"
  | "budget.approve"
  | "integration.manage"
  | "member.manage"
  | "client_access.manage";

/** A principal's relationship to one project. */
export type ProjectRelation =
  | { kind: "org"; role: OrgRole; assigned: boolean }
  | { kind: "client"; role: ClientRole }
  | { kind: "none" };

const ADMIN_ONLY: Action[] = ["budget.manage", "budget.approve", "integration.manage", "member.manage", "client_access.manage", "project.archive"];
const STAFF: Action[] = ["project.view", "project.update", "keyword.manage", "schedule.update", "scan.manual", "job.view", "usage.view"];

/** Organization-level actions (not tied to a single project). */
export function canOrg(role: OrgRole | null, action: Action): boolean {
  if (!role) return false;
  if (role === "admin") return true;
  if (ADMIN_ONLY.includes(action)) return false;
  if (action === "project.create") return role === "manager";
  if (action === "job.view" || action === "usage.view" || action === "project.view") return true;
  return false;
}

export function canProject(rel: ProjectRelation, action: Action): boolean {
  if (rel.kind === "none") return false;
  if (rel.kind === "client") {
    if (action === "project.view") return true;
    // Paid scans are off for clients unless explicitly granted.
    if (action === "scan.manual") return rel.role === "viewer_with_refresh";
    return false;
  }
  if (rel.role === "admin") return true;
  if (ADMIN_ONLY.includes(action)) return false;
  // Managers work on every project in the org; members only on assigned projects.
  if (rel.role === "member" && !rel.assigned) return false;
  return STAFF.includes(action);
}
