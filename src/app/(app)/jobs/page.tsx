import Link from "next/link";
import { requireStaff, visibleProjectsFilter } from "@/server/authz";
import { sql } from "@/server/db";
import { listJobs } from "@/server/queries";
import { formatMoney } from "@/lib/cost";
import { formatDateTime, relativeTime } from "@/lib/format";
import { canOrg } from "@/lib/permissions";
import { EmptyState, PageHeader, Pagination, StatusBadge } from "@/components/ui";
import { JobButtons } from "./job-buttons";

export const metadata = { title: "Job Monitor" };

const STATUSES = ["awaiting_approval", "queued", "running", "completed", "partial", "failed", "cancelled"];
const RANGES: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30 };

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ status?: string; projectId?: string; provider?: string; module?: string; range?: string; page?: string }> }) {
  const user = await requireStaff("job.view");
  const sp = await searchParams;
  const filter = visibleProjectsFilter(sql, user);
  const projects = await sql<{ id: string; name: string }[]>`select p.id, p.name from projects p where ${filter} order by p.name`;
  const page = Number(sp.page) || 1;
  const jobs = await listJobs(sql, filter, {
    status: STATUSES.includes(sp.status ?? "") ? sp.status : undefined,
    projectId: projects.some((p) => p.id === sp.projectId) ? sp.projectId : undefined,
    provider: sp.provider || undefined,
    module: sp.module || undefined,
    since: sp.range && RANGES[sp.range] ? new Date(Date.now() - RANGES[sp.range]! * 86400_000) : undefined,
    page,
  });
  const total = jobs[0]?.total ?? 0;
  const canApprove = canOrg(user.role, "budget.approve");
  const qs = (p: number) => `?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v)), page: String(p) })}`;
  return (
    <div>
      <PageHeader title="Job monitor" subtitle="Every collection run with its trigger, status, attempts and cost. Jobs run in the background worker." />
      <form className="mb-4 flex flex-wrap gap-2">
        <select name="projectId" defaultValue={sp.projectId ?? ""} className="input max-w-56"><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select name="status" defaultValue={sp.status ?? ""} className="input max-w-44"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
        <select name="module" defaultValue={sp.module ?? ""} className="input max-w-36"><option value="">All modules</option><option value="organic">Organic</option></select>
        <input name="provider" defaultValue={sp.provider} placeholder="Provider" className="input max-w-36" />
        <select name="range" defaultValue={sp.range ?? ""} className="input max-w-36"><option value="">Any time</option><option value="24h">Last 24h</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select>
        <button className="btn-secondary">Filter</button>
      </form>
      {jobs.length === 0 ? <EmptyState title="No jobs match" /> : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Created</th><th>Project</th><th>Module</th><th>Trigger</th><th>Provider</th><th>Status</th><th className="text-right">Targets</th><th className="text-right">Attempts</th><th className="text-right">Est. / actual cost</th><th>Error</th><th></th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="whitespace-nowrap"><Link className="hover:underline" href={`/jobs/${j.id}`} title={formatDateTime(j.created_at)}>{relativeTime(j.created_at)}</Link></td>
                  <td><Link className="hover:underline" href={`/projects/${j.project_id}`}>{j.project_name}</Link></td>
                  <td className="capitalize text-muted">{j.module}</td>
                  <td className="text-muted">{j.trigger}{j.requested_by_email ? <div className="text-xs text-faint">{j.requested_by_email}</div> : null}</td>
                  <td className="text-muted">{j.provider}</td>
                  <td><StatusBadge status={j.status} />{j.status === "queued" && j.run_after > new Date() && <div className="text-xs text-faint">retry {relativeTime(j.run_after)}</div>}</td>
                  <td className="text-right tabular-nums text-muted">{j.summary?.total ? `${j.summary.succeeded ?? 0}/${j.summary.total}` : "—"}</td>
                  <td className="text-right tabular-nums text-muted">{j.attempts}/{j.max_attempts}</td>
                  <td className="whitespace-nowrap text-right tabular-nums text-muted">{formatMoney(j.estimated_cost, j.currency)} / {j.actual_cost === null ? "—" : formatMoney(j.actual_cost, j.currency)}</td>
                  <td className="max-w-56 truncate text-xs text-bad" title={j.error_message ?? ""}>{j.error_code ?? ""}</td>
                  <td><JobButtons jobId={j.id} status={j.status} canApprove={canApprove} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} total={total} pageSize={50} hrefFor={qs} />
    </div>
  );
}
