import { requireProjectAccess } from "@/server/authz";
import { sql } from "@/server/db";
import { getLocations, getProject } from "@/server/queries";
import { canProject } from "@/lib/permissions";
import { describeLocation } from "@/lib/format";
import { Card, Badge } from "@/components/ui";
import { DetailsForm, LocationForm, StatusControls, AssignmentToggle, DeleteLocationButton } from "./settings-forms";

export default async function ProjectSettings({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { relation } = await requireProjectAccess(projectId, "project.view");
  const project = (await getProject(sql, projectId))!;
  const locations = await getLocations(sql, projectId);
  const canEdit = canProject(relation, "project.update");
  const isAdmin = canProject(relation, "member.manage");
  const members = isAdmin ? await sql<{ id: string; email: string; role: string; assigned: boolean }[]>`
    select u.id, u.email, m.role, exists (select 1 from project_assignments a where a.project_id = ${projectId} and a.user_id = u.id) as assigned
    from organization_members m join users u on u.id = m.user_id where m.organization_id = ${project.organization_id} order by u.email` : [];

  return (
    <div className="space-y-6">
      <Card title="Project details">
        <DetailsForm projectId={projectId} disabled={!canEdit} timezones={["UTC", ...Intl.supportedValuesOf("timeZone")]}
          initial={{ name: project.name, domain: project.domain, businessCategory: project.business_category ?? "", timezone: project.timezone, language: project.language, notes: project.notes ?? "" }} />
      </Card>

      <Card title="Locations" footer="Changing targeting affects future collections only. Existing observations keep the location that was actually requested.">
        <div className="space-y-4">
          {locations.map((l) => (
            <details key={l.id} className="rounded-lg border border-line">
              <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm">
                <span className="font-medium">{l.name}</span>{l.is_primary && <Badge tone="info">primary</Badge>}
                <span className="text-muted">{describeLocation(l)} · {l.google_domain}</span>
                {l.business_name && <span className="text-faint">· {l.business_name}</span>}
              </summary>
              <div className="border-t border-line p-4">
                <LocationForm projectId={projectId} location={l} disabled={!canEdit} />
                {canEdit && !l.is_primary && <div className="mt-3"><DeleteLocationButton projectId={projectId} locationId={l.id} /></div>}
              </div>
            </details>
          ))}
          {canEdit && (
            <details className="rounded-lg border border-dashed border-line">
              <summary className="cursor-pointer px-4 py-3 text-sm text-accent">+ Add location</summary>
              <div className="border-t border-line p-4"><LocationForm projectId={projectId} location={null} disabled={false} /></div>
            </details>
          )}
        </div>
      </Card>

      {isAdmin && (
        <Card title="Team access" footer="Administrators and managers can work on every project. Members only see projects they are assigned to.">
          <table className="table">
            <thead><tr><th>Member</th><th>Role</th><th>Assigned</th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}><td>{m.email}</td><td className="capitalize text-muted">{m.role}</td>
                  <td>{m.role === "member" ? <AssignmentToggle projectId={projectId} userId={m.id} assigned={m.assigned} /> : <span className="text-faint">All projects</span>}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card title="Client access">
        <p className="text-sm text-muted">Read-only client dashboards with expiring, revocable invitations are planned for Phase 7. The access model is already enforced server-side.</p>
      </Card>

      {canEdit && (
        <Card title="Project status" footer="Pausing stops scheduled and queued collection. Archiving hides the project. Historical data is never deleted.">
          <StatusControls projectId={projectId} status={project.status} canArchive={canProject(relation, "project.archive")} />
        </Card>
      )}
    </div>
  );
}
