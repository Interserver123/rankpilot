import { requireStaff } from "@/server/authz";
import { sql } from "@/server/db";
import { canOrg } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";
import { AddMemberForm, OrgNameForm, RemoveMember } from "./settings-forms";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireStaff();
  const isAdmin = canOrg(user.role, "member.manage");
  const [org] = await sql<{ name: string; slug: string; plan: string }[]>`select name, slug, plan from organizations where id = ${user.organizationId}`;
  const members = await sql<{ id: string; email: string; role: string; linked: boolean; created_at: Date }[]>`
    select u.id, u.email, m.role, u.authentication_user_id is not null as linked, m.created_at
    from organization_members m join users u on u.id = m.user_id where m.organization_id = ${user.organizationId} order by m.role, u.email`;
  const log = isAdmin ? await sql<{ id: string; action: string; entity_type: string; created_at: Date; email: string | null }[]>`
    select a.id, a.action, a.entity_type, a.created_at, u.email from audit_logs a left join users u on u.id = a.actor_user_id
    where a.organization_id = ${user.organizationId} order by a.created_at desc limit 50` : [];
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle={`${org?.name} · plan: ${org?.plan}`} />
      {isAdmin && <Card title="Organization"><OrgNameForm name={org?.name ?? ""} /></Card>}
      <Card title="Team" footer="Admins manage budgets, members and integrations. Managers work on all projects. Members work only on assigned projects (assign them in each project's settings).">
        <table className="table mb-4">
          <thead><tr><th>Email</th><th>Role</th><th>Signed in</th><th>Added</th><th></th></tr></thead>
          <tbody>{members.map((m) => (
            <tr key={m.id}><td>{m.email}</td><td className="capitalize text-muted">{m.role}</td><td className="text-muted">{m.linked ? "Yes" : "Invited"}</td>
              <td className="text-muted">{formatDateTime(m.created_at)}</td><td>{isAdmin && m.id !== user.id && <RemoveMember userId={m.id} />}</td></tr>
          ))}</tbody>
        </table>
        {isAdmin && <AddMemberForm />}
      </Card>
      {isAdmin && (
        <Card title="Audit log (latest 50)">
          <table className="table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th></tr></thead>
            <tbody>{log.map((l) => <tr key={l.id}><td className="whitespace-nowrap text-muted">{formatDateTime(l.created_at)}</td><td className="text-muted">{l.email ?? "system"}</td><td>{l.action}</td><td className="text-muted">{l.entity_type}</td></tr>)}</tbody></table>
        </Card>
      )}
    </div>
  );
}
