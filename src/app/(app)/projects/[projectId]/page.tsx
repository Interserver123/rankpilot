import Link from "next/link";
import { requireProjectAccess } from "@/server/authz";
import { sql } from "@/server/db";
import { getLocations, getProject, getTrackingConfigs, listJobs } from "@/server/queries";
import { actionItems, dailyTrend, rankSnapshots } from "@/server/insights";
import { defaultSerpProvider } from "@/server/providers/registry";
import { describeInterval } from "@/lib/schedule";
import { formatDateTime, relativeTime } from "@/lib/format";
import { canProject } from "@/lib/permissions";
import { Notice, Provenance, StatusBadge } from "@/components/ui";
import { ActionList, DeltaChip, KpiCard, Ring, SegmentedLinks, Sparkbars } from "@/components/dashboard";
import { DistributionBars } from "@/components/charts";
import { TrendChart } from "@/components/trend-chart";
import { RefreshButton } from "@/components/refresh-button";
import { Icon } from "@/components/icons";

const MODULE_LABELS: Record<string, string> = { organic: "Organic rankings", maps: "Maps grid", llm: "AI visibility", citations: "Citations" };
const RANGES = { "30d": 30, "90d": 90, "180d": 180 } as const;

export default async function ProjectOverview({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ created?: string; range?: string }> }) {
  const { projectId } = await params;
  const sp = await searchParams;
  const range = (sp.range && sp.range in RANGES ? sp.range : "30d") as keyof typeof RANGES;
  const { relation, organizationId } = await requireProjectAccess(projectId, "project.view");
  const project = (await getProject(sql, projectId))!;
  const filter = sql`p.id = ${projectId}`;
  const [locations, configs, snap, trend, longTrend, jobs, items, [dist]] = await Promise.all([
    getLocations(sql, projectId), getTrackingConfigs(sql, projectId), rankSnapshots(sql, filter, 7),
    dailyTrend(sql, filter, RANGES[range]), dailyTrend(sql, filter, 90), listJobs(sql, filter, {}),
    actionItems(sql, filter, organizationId, { includeBudgets: false }),
    sql<{ top3: number; top10: number; top20: number; top50: number; top100: number; nf: number }[]>`
      with cur as (select distinct on (o.keyword_id) o.position, o.result_status from serp_observations o join keywords k on k.id = o.keyword_id
        where k.project_id = ${projectId} and k.is_active order by o.keyword_id, o.collected_at desc)
      select count(*) filter (where position <= 3)::int as top3, count(*) filter (where position between 4 and 10)::int as top10,
        count(*) filter (where position between 11 and 20)::int as top20, count(*) filter (where position between 21 and 50)::int as top50,
        count(*) filter (where position > 50)::int as top100, count(*) filter (where result_status = 'not_found')::int as nf from cur`,
  ]);
  const provider = defaultSerpProvider();
  const { now, before } = snap;
  const organic = configs.find((c) => c.module === "organic");
  const share = now.measured ? (now.top10 / now.measured) * 100 : null;
  const beforeShare = before.measured ? (before.top10 / before.measured) * 100 : null;
  const spark = longTrend.slice(-10);
  const tz = project.timezone;

  const checklist = [
    { done: locations.length > 0, label: "Business location", href: `/projects/${projectId}/settings` },
    { done: snap.keywords > 0, label: "Keywords added", href: `/projects/${projectId}/keywords` },
    { done: Boolean(provider), label: "SERP provider connected", href: "/integrations" },
    { done: Boolean(organic?.enabled), label: "Organic schedule on", href: `/projects/${projectId}/schedule` },
    { done: now.measured > 0, label: "First rankings collected", href: `/projects/${projectId}/rankings` },
  ];
  const progress = checklist.filter((c) => c.done).length;

  return (
    <div className="space-y-6">
      {sp.created && <Notice tone="good">Project created. {jobs.length ? "The first collection job is running in the background." : "Add keywords and run a refresh to collect baseline rankings."}</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {locations.length} location{locations.length === 1 ? "" : "s"} · {snap.keywords} active keyword configuration{snap.keywords === 1 ? "" : "s"}
          {organic?.last_success_at && <> · updated {relativeTime(organic.last_success_at)}</>}
        </p>
        {canProject(relation, "scan.manual") && <RefreshButton projectId={projectId} keywordIds={null} label="Refresh all keywords" className="btn-primary" disabled={project.status !== "active"} />}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className="card flex items-center gap-6 bg-gradient-to-br from-accent-soft via-panel to-panel p-6 sm:col-span-2">
          <Ring pct={share} label="page one" />
          <div>
            <div className="eyebrow">Visibility</div>
            <div className="mt-1 text-sm text-muted">{now.top10} of {now.measured} measured keywords in the top 10.</div>
            <div className="mt-2"><DeltaChip delta={share !== null && beforeShare !== null ? share - beforeShare : null} suffix=" pts" /> <span className="text-[11px] text-faint">7 days</span></div>
          </div>
        </div>
        <KpiCard icon="target" label="Avg. position" value={now.avgPosition ?? "—"}
          delta={<DeltaChip delta={now.avgPosition !== null && before.avgPosition !== null ? now.avgPosition - before.avgPosition : null} betterWhen="down" precision={1} />}
          hint={`${now.ranked} ranking · not-found excluded`} spark={<Sparkbars values={spark.flatMap((d) => (d.avgPosition === null ? [] : [d.avgPosition]))} invert />} />
        <KpiCard icon="trophy" label="Top 3" value={now.top3} delta={<DeltaChip delta={before.measured ? now.top3 - before.top3 : null} />}
          hint={`of ${now.measured} measured`} spark={<Sparkbars values={spark.map((d) => d.top3)} />} />
        <KpiCard icon="alert" label="Not in top 100" value={now.notFound} delta={<DeltaChip delta={before.measured ? now.notFound - before.notFound : null} betterWhen="down" />}
          hint={snap.keywords - now.measured ? `${snap.keywords - now.measured} awaiting first check` : "All keywords measured"}
          spark={<Sparkbars values={spark.map((d) => d.notFound)} tone="bad" />} />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <section className="card p-6 xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold">Top-10 share over time</h2>
              <p className="text-xs text-muted">Daily share of checked keywords ranking on page one.</p>
            </div>
            <SegmentedLinks active={range} options={Object.keys(RANGES).map((r) => ({ label: r.toUpperCase(), value: r, href: `/projects/${projectId}?range=${r}` }))} />
          </div>
          <div className="mt-4">
            <TrendChart label="Top-10 share" domain={[0, 100]} format="percent" secondaryLabel="Keywords checked"
              points={trend.map((d) => ({ day: d.day, value: d.measured ? (d.top10 / d.measured) * 100 : null, secondary: d.measured }))} />
          </div>
          <div className="mt-2 border-t border-line pt-3 text-xs text-faint">
            <Provenance source={`Independent SERP collection (${provider?.displayName ?? "no provider"})`}
              updated={organic?.last_success_at ? formatDateTime(organic.last_success_at, tz) : "never"}
              next={organic?.enabled && organic.next_run_at ? formatDateTime(organic.next_run_at, tz) : "not scheduled"} />
          </div>
        </section>

        <section className="card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold">Setup</h2>
            <span className="text-xs font-semibold text-muted">{progress}/{checklist.length}</span>
          </div>
          <div className="mb-4 h-2 overflow-hidden rounded-full bg-panel-2"><div className="h-2 rounded-full bg-accent" style={{ width: `${(progress / checklist.length) * 100}%` }} /></div>
          {progress === checklist.length ? (
            <p className="flex items-center gap-2 text-sm text-muted"><span className="grid h-6 w-6 place-items-center rounded-full bg-good/10 text-good"><Icon name="check" size={14} strokeWidth={2.4} /></span>Tracking is fully set up.</p>
          ) : (
          <ul className="space-y-1">
            {checklist.map((c) => (
              <li key={c.label}>
                <Link href={c.href} className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-sm hover:bg-panel-2">
                  <span className={`grid h-6 w-6 place-items-center rounded-full ${c.done ? "bg-good/10 text-good" : "border border-dashed border-line text-faint"}`}>{c.done && <Icon name="check" size={14} strokeWidth={2.4} />}</span>
                  <span className={c.done ? "text-muted line-through decoration-faint/60" : "font-medium"}>{c.label}</span>
                </Link>
              </li>
            ))}
          </ul>
          )}
          {items.length > 0 && <div className="mt-5 border-t border-line pt-4"><div className="eyebrow mb-2">Needs attention</div><ActionList items={items.slice(0, 2)} empty="" /></div>}
        </section>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <section className="card p-6">
          <h2 className="font-display mb-4 text-lg font-semibold">Position distribution</h2>
          {now.measured ? (
            <DistributionBars items={[
              { label: "1–3", value: dist?.top3 ?? 0, tone: "var(--color-accent)" },
              { label: "4–10", value: dist?.top10 ?? 0, tone: "var(--color-accent)" },
              { label: "11–20", value: dist?.top20 ?? 0, tone: "var(--color-warn)" },
              { label: "21–50", value: dist?.top50 ?? 0, tone: "var(--color-warn)" },
              { label: "51–100", value: dist?.top100 ?? 0, tone: "var(--color-bad)" },
              { label: "Not found", value: dist?.nf ?? 0, tone: "var(--color-faint)" },
            ]} />
          ) : <p className="text-sm text-muted">No verified ranking data yet.</p>}
        </section>
        <section className="card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Schedules</h2>
            <Link href={`/projects/${projectId}/schedule`} className="text-xs font-semibold text-accent hover:underline">Edit</Link>
          </div>
          <ul className="space-y-3 text-sm">
            {Object.keys(MODULE_LABELS).map((m) => configs.find((c) => c.module === m)).filter(Boolean).map((c) => (
              <li key={c!.id} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${c!.enabled ? "bg-good" : "bg-line"}`} />{MODULE_LABELS[c!.module]}</span>
                <span className="text-right text-xs text-muted">{c!.enabled ? <>{describeInterval(c!.interval_value, c!.interval_unit)} · {c!.preferred_run_time}<br /><span className="text-faint">next {c!.next_run_at ? relativeTime(c!.next_run_at) : "—"}</span></> : "Off"}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Recent jobs</h2>
            <Link href={`/jobs?projectId=${projectId}`} className="text-xs font-semibold text-accent hover:underline">All jobs</Link>
          </div>
          {jobs.length === 0 ? <p className="text-sm text-muted">No jobs yet.</p> : (
            <ul className="space-y-2.5 text-sm">
              {jobs.slice(0, 5).map((j) => (
                <li key={j.id}>
                  <Link href={`/jobs/${j.id}`} className="flex items-center justify-between gap-2 rounded-xl px-1 py-1 hover:bg-panel-2">
                    <span><span className="font-medium capitalize">{j.trigger}</span>{j.summary?.total ? <span className="text-faint"> · {j.summary.succeeded ?? 0}/{j.summary.total} keywords</span> : null}</span>
                    <span className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-muted">{relativeTime(j.created_at)}<StatusBadge status={j.status} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
