import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff, visibleProjectsFilter } from "@/server/authz";
import { sql } from "@/server/db";
import { jobTargets, listJobs, type JobListRow } from "@/server/queries";
import { formatMoney } from "@/lib/cost";
import { formatDateTime } from "@/lib/format";
import { canOrg } from "@/lib/permissions";
import { Card, StatusBadge } from "@/components/ui";
import { JobButtons } from "../job-buttons";

export default async function JobDetail({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const user = await requireStaff("job.view");
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) notFound();
  const [job] = (await listJobs(sql, sql`${visibleProjectsFilter(sql, user)} and j.id = ${jobId}`)) as JobListRow[];
  if (!job) notFound();
  const targets = await jobTargets(sql, jobId);
  const counts = targets.reduce<Record<string, number>>((a, t) => ({ ...a, [t.status]: (a[t.status] ?? 0) + 1 }), {});
  const usage = await sql<{ units: number; est: number | null; actual: number | null }[]>`
    select sum(coalesce(units_consumed, units_requested))::float8 as units, sum(estimated_cost)::float8 as est, sum(actual_cost)::float8 as actual from provider_usage where job_id = ${jobId}`;
  const rows: [string, React.ReactNode][] = [
    ["Project", <Link key="p" className="link" href={`/projects/${job.project_id}`}>{job.project_name}</Link>],
    ["Module / type", `${job.module} · ${job.job_type}`],
    ["Provider", job.provider],
    ["Trigger", `${job.trigger}${job.requested_by_email ? ` by ${job.requested_by_email}` : ""}`],
    ["Created", formatDateTime(job.created_at)],
    ["Started", formatDateTime(job.started_at)],
    ["Completed", formatDateTime(job.completed_at)],
    ["Attempts", `${job.attempts} of ${job.max_attempts}`],
    ["Estimated cost", formatMoney(job.estimated_cost, job.currency)],
    ["Recorded usage", `${usage[0]?.units ?? 0} units · est. ${formatMoney(usage[0]?.est ?? null, job.currency)} · actual ${usage[0]?.actual === null ? "not reported" : formatMoney(usage[0]?.actual, job.currency)}`],
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/jobs" className="text-xs text-muted hover:underline">← Job monitor</Link>
        <h1 className="text-lg font-semibold">Job {job.id.slice(0, 8)}</h1><StatusBadge status={job.status} />
        <JobButtons jobId={job.id} status={job.status} canApprove={canOrg(user.role, "budget.approve")} />
      </div>
      {job.error_message && <div className="rounded-lg border border-bad/30 bg-bad/10 p-3 text-sm text-bad">{job.error_code}: {job.error_message}</div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-1">
          <dl className="space-y-2 text-sm">{rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="text-right">{v}</dd></div>)}</dl>
        </Card>
        <Card title={`Targets (${targets.length})`} className="lg:col-span-2"
          footer={"\"Uncertain\" means a request may have been sent and billed but its result was lost; it is not retried automatically."}>
          <div className="mb-3 flex flex-wrap gap-2">{Object.entries(counts).map(([s, n]) => <span key={s} className="flex items-center gap-1 text-xs"><StatusBadge status={s} /> {n}</span>)}</div>
          <div className="max-h-[32rem] overflow-auto">
            <table className="table">
              <thead><tr><th>Keyword</th><th>Status</th><th className="text-right">Attempts</th><th>Error</th><th>Updated</th></tr></thead>
              <tbody>
                {targets.map((t) => (
                  <tr key={t.id}>
                    <td>{t.keyword_id ? <Link className="hover:underline" href={`/projects/${job.project_id}/rankings/${t.keyword_id}`}>{t.keyword}</Link> : <span className="text-faint">deleted</span>}</td>
                    <td><StatusBadge status={t.status} /></td>
                    <td className="text-right tabular-nums text-muted">{t.attempts}</td>
                    <td className="max-w-72 text-xs text-bad">{t.error_code ? `${t.error_code}: ${t.error_message ?? ""}` : ""}</td>
                    <td className="whitespace-nowrap text-xs text-muted">{formatDateTime(t.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
