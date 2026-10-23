import Link from "next/link";
import { requireStaff, visibleProjectsFilter } from "@/server/authz";
import { sql } from "@/server/db";
import { listProjects } from "@/server/queries";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime, relativeTime } from "@/lib/format";
import { canOrg } from "@/lib/permissions";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const user = await requireStaff();
  const { q, status } = await searchParams;
  const validStatus = ["active", "paused", "archived"].includes(status ?? "") ? status : undefined;
  const projects = await listProjects(sql, visibleProjectsFilter(sql, user), q, validStatus);
  return (
    <div>
      <PageHeader title="Projects" subtitle={`${projects.length} project${projects.length === 1 ? "" : "s"}`}
        actions={canOrg(user.role, "project.create") && <Link href="/projects/new" className="btn-primary">New project</Link>} />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Filter by name, domain or client" className="input max-w-sm" />
        <select name="status" defaultValue={validStatus ?? ""} className="input max-w-40">
          <option value="">Active & paused</option><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option>
        </select>
        <button className="btn-secondary">Filter</button>
      </form>
      {projects.length === 0 ? (
        <EmptyState title={q ? "No matching projects" : "No projects yet"} action={!q && canOrg(user.role, "project.create") ? <Link href="/projects/new" className="btn-primary">Create a project</Link> : undefined}>
          {q ? "Try a different search." : "Projects hold a client's keywords, locations, schedules and results."}
        </EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Project</th><th>Client</th><th>Status</th><th className="text-right">Keywords</th><th>Last successful update</th><th>Next organic run</th><th>Jobs</th></tr></thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td><Link className="font-medium hover:underline" href={`/projects/${p.id}`}>{p.name}</Link><div className="text-xs text-faint">{p.domain}</div></td>
                  <td className="text-muted">{p.client_name}</td>
                  <td><Badge tone={p.status === "active" ? "good" : p.status === "paused" ? "warn" : "neutral"}>{p.status}</Badge></td>
                  <td className="text-right tabular-nums">{p.keyword_count}</td>
                  <td className="text-muted" title={formatDateTime(p.last_success_at, p.timezone)}>{relativeTime(p.last_success_at)}</td>
                  <td className="text-muted">{p.next_run_at ? formatDateTime(p.next_run_at, p.timezone) : "Not scheduled"}</td>
                  <td>{p.active_jobs > 0 ? <Badge tone="info">{p.active_jobs} active</Badge> : <span className="text-faint">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
