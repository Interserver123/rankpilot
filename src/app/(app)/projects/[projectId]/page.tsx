import Link from "next/link";
import { requireProjectAccess } from "@/server/authz";
import { sql } from "@/server/db";
import { getLocations, getProject, getTrackingConfigs, latestRanks, listJobs } from "@/server/queries";
import { defaultSerpProvider } from "@/server/providers/registry";
import { averagePosition, rankDistribution, type ObservedRank } from "@/lib/ranking";
import { describeInterval } from "@/lib/schedule";
import { formatDateTime, relativeTime } from "@/lib/format";
import { canProject } from "@/lib/permissions";
import { Card, Notice, Provenance, Stat, StatusBadge } from "@/components/ui";
import { DistributionBars } from "@/components/charts";
import { RefreshButton } from "@/components/refresh-button";

const MODULE_LABELS: Record<string, string> = { organic: "Organic rankings", maps: "Maps grid", llm: "AI visibility", citations: "Citations" };

export default async function ProjectOverview({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ created?: string }> }) {
  const { projectId } = await params;
  const { created } = await searchParams;
  const { relation } = await requireProjectAccess(projectId, "project.view");
  const project = (await getProject(sql, projectId))!;
  const [locations, configs, ranks, jobs] = await Promise.all([
    getLocations(sql, projectId), getTrackingConfigs(sql, projectId), latestRanks(sql, projectId),
    listJobs(sql, sql`p.id = ${projectId}`, {}),
  ]);
  const provider = defaultSerpProvider();
  const observed: (ObservedRank | null)[] = ranks.map((r) =>
    r.result_status === "ranked" ? { status: "ranked", position: r.position! } : r.result_status === "not_found" ? { status: "not_found", depth: r.result_depth! } : null);
  const dist = rankDistribution(observed);
  const avg = averagePosition(observed);
  const organic = configs.find((c) => c.module === "organic");
  const hasData = dist.measured > 0;

  const checklist = [
    { done: locations.length > 0, label: "Add a business location", href: `/projects/${projectId}/settings` },
    { done: ranks.length > 0, label: "Add keywords", href: `/projects/${projectId}/keywords` },
    { done: Boolean(provider), label: "SERP provider configured", href: "/integrations" },
    { done: Boolean(organic?.enabled), label: "Organic schedule enabled", href: `/projects/${projectId}/schedule` },
    { done: hasData, label: "First ranking data collected", href: `/projects/${projectId}/rankings` },
    { done: false, label: "Connect Search Console & GA4 (planned)", href: "/integrations" },
  ];
  const depths = [...new Set(ranks.map((r) => r.result_depth).filter(Boolean))];

  return (
    <div className="space-y-6">
      {created && <Notice tone="good">Project created. {jobs.length ? "The first collection job is queued." : "Add keywords and run a refresh to collect the first data."}</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted">
          {project.business_category && <span>{project.business_category} · </span>}{locations.length} location(s) · {ranks.length} active keyword configuration(s)
        </div>
        {canProject(relation, "scan.manual") && <RefreshButton projectId={projectId} keywordIds={null} label="Refresh all keywords" className="btn-primary" disabled={project.status !== "active"} />}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Avg. position" value={avg.average ?? "—"} hint={avg.counted ? `Over ${avg.counted} ranking keyword(s); not-found excluded` : "No ranking keywords yet"} />
        <Stat label="Top 3" value={dist.buckets.top3} hint={`of ${dist.measured} measured`} />
        <Stat label="Top 10" value={dist.buckets.top3 + dist.buckets.top10} hint={`of ${dist.measured} measured`} />
        <Stat label={`Not in top ${depths.length === 1 ? depths[0] : "N"}`} value={dist.buckets.notFound} hint={dist.noData ? `${dist.noData} keyword(s) without data yet` : "All keywords measured"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Ranking distribution" className="lg:col-span-2"
          footer={<Provenance source={`Independent SERP collection (${provider?.displayName ?? "no provider"})`} updated={organic?.last_success_at ? formatDateTime(organic.last_success_at, project.timezone) : "never"} next={organic?.next_run_at ? formatDateTime(organic.next_run_at, project.timezone) : "not scheduled"} />}>
          {hasData ? (
            <DistributionBars items={[
              { label: "1–3", value: dist.buckets.top3, tone: "var(--color-good)" },
              { label: "4–10", value: dist.buckets.top10, tone: "var(--color-good)" },
              { label: "11–20", value: dist.buckets.top20, tone: "var(--color-warn)" },
              { label: "21–50", value: dist.buckets.top50, tone: "var(--color-warn)" },
              { label: "51–100", value: dist.buckets.top100 + dist.buckets.beyond, tone: "var(--color-bad)" },
              { label: "Not found", value: dist.buckets.notFound, tone: "var(--color-faint)" },
            ]} />
          ) : <p className="text-sm text-muted">No verified ranking data yet. Data appears after the first collection job completes.</p>}
        </Card>
        <Card title="Setup checklist">
          <ul className="space-y-2 text-sm">
            {checklist.map((c) => (
              <li key={c.label} className="flex items-center gap-2">
                <span className={c.done ? "text-good" : "text-faint"}>{c.done ? "✓" : "○"}</span>
                <Link href={c.href} className={c.done ? "text-muted" : "hover:underline"}>{c.label}</Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Tracking schedules" actions={<Link href={`/projects/${projectId}/schedule`} className="link text-xs">Edit</Link>}>
          <table className="table">
            <thead><tr><th>Module</th><th>Frequency</th><th>Last success</th><th>Next run</th></tr></thead>
            <tbody>
              {configs.sort((a, b) => Object.keys(MODULE_LABELS).indexOf(a.module) - Object.keys(MODULE_LABELS).indexOf(b.module)).map((c) => (
                <tr key={c.id}>
                  <td>{MODULE_LABELS[c.module] ?? c.module}</td>
                  <td className="text-muted">{c.enabled ? `${describeInterval(c.interval_value, c.interval_unit)} at ${c.preferred_run_time}` : "Off"}</td>
                  <td className="text-muted" title={formatDateTime(c.last_success_at, project.timezone)}>{relativeTime(c.last_success_at)}</td>
                  <td className="text-muted">{c.enabled && c.next_run_at ? formatDateTime(c.next_run_at, project.timezone) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Recent jobs" actions={<Link href={`/jobs?projectId=${projectId}`} className="link text-xs">All jobs</Link>}>
          {jobs.length === 0 ? <p className="text-sm text-muted">No jobs yet.</p> : (
            <ul className="space-y-2 text-sm">
              {jobs.slice(0, 6).map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-2">
                  <Link href={`/jobs/${j.id}`} className="hover:underline"><span className="capitalize">{j.module}</span> · {j.trigger}</Link>
                  <span className="flex items-center gap-2 text-muted"><span title={formatDateTime(j.created_at, project.timezone)}>{relativeTime(j.created_at)}</span><StatusBadge status={j.status} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
