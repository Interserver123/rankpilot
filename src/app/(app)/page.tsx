import Link from "next/link";
import { requireStaff, visibleProjectsFilter } from "@/server/authz";
import { sql } from "@/server/db";
import { rankMovements, usageSummary } from "@/server/queries";
import { actionItems, dailyTrend, projectHealth, rankSnapshots, recentActivity } from "@/server/insights";
import { formatMoney } from "@/lib/cost";
import { relativeTime } from "@/lib/format";
import { canOrg } from "@/lib/permissions";
import { ActionList, DeltaChip, KpiCard, Ring, SegmentedLinks, Sparkbars } from "@/components/dashboard";
import { TrendChart } from "@/components/trend-chart";
import { Greeting } from "@/components/greeting";
import { Icon } from "@/components/icons";
import { EmptyState } from "@/components/ui";

export const metadata = { title: "Overview" };

const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;
type Range = keyof typeof RANGES;

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ range?: string; metric?: string }> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const range: Range = sp.range && sp.range in RANGES ? (sp.range as Range) : "30d";
  const metric = sp.metric === "avg" ? "avg" : "top10";
  const filter = visibleProjectsFilter(sql, user);
  const showCosts = canOrg(user.role, "usage.view");

  const [snap, trend, longTrend, items, moves, health, activity, usage, [projectCount]] = await Promise.all([
    rankSnapshots(sql, filter, 7),
    dailyTrend(sql, filter, RANGES[range]),
    dailyTrend(sql, filter, 90),
    actionItems(sql, filter, user.organizationId, { includeBudgets: canOrg(user.role, "budget.manage") }),
    rankMovements(sql, filter, 7, 8),
    projectHealth(sql, filter, 5),
    recentActivity(sql, filter, user.organizationId, 7),
    showCosts ? usageSummary(sql, user.organizationId) : Promise.resolve(null),
    sql<{ n: number }[]>`select count(*)::int as n from projects p where ${filter} and p.status = 'active'`,
  ]);

  const { now, before } = snap;
  const top10Share = now.measured ? (now.top10 / now.measured) * 100 : null;
  const beforeShare = before.measured ? (before.top10 / before.measured) * 100 : null;
  const spark = longTrend.slice(-10);
  const spend = usage?.byProvider.reduce((a, r) => a + (r.cost ?? 0), 0) ?? 0;
  const gains = moves.filter((m) => (m.prev_pos ?? 101) > (m.cur_pos ?? 101));
  const losses = moves.filter((m) => (m.prev_pos ?? 101) < (m.cur_pos ?? 101));
  const q = (o: Record<string, string>) => `/?${new URLSearchParams({ range, metric, ...o })}`;

  const summary = now.measured === 0
    ? "No ranking data yet. Your first collection results will appear here."
    : `${now.top10} of ${now.measured} measured keyword${now.measured === 1 ? "" : "s"} rank on page one${gains.length || losses.length ? `, with ${gains.length} notable gain${gains.length === 1 ? "" : "s"} and ${losses.length} loss${losses.length === 1 ? "" : "es"} this week` : ""}.`;

  if ((projectCount?.n ?? 0) === 0) {
    return (
      <div className="space-y-8">
        <Greeting name={user.name ?? user.email.split("@")[0]!} />
        <EmptyState title="Let's set up your first client" action={canOrg(user.role, "project.create") ? <Link href="/projects/new" className="btn-primary"><Icon name="plus" size={16} />Create a project</Link> : undefined}>
          A project holds one client's website, locations, keywords and schedules. Setup takes about two minutes and no integrations are required.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Greeting name={user.name ?? user.email.split("@")[0]!} />
          <p className="mt-1.5 max-w-2xl text-[15px] text-muted">{summary}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/rank-tracking" className="btn-secondary"><Icon name="rank" size={16} />All rankings</Link>
          {canOrg(user.role, "project.create") && <Link href="/projects/new" className="btn-primary"><Icon name="plus" size={16} />New project</Link>}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <div className="card flex items-center gap-6 bg-gradient-to-br from-accent-soft via-panel to-panel p-6 sm:col-span-2">
          <Ring pct={top10Share} label="page one" />
          <div className="min-w-0">
            <div className="eyebrow">Search visibility</div>
            <div className="mt-1 text-sm text-muted">Share of measured keywords ranking in the top 10.</div>
            <div className="mt-2"><DeltaChip delta={top10Share !== null && beforeShare !== null ? top10Share - beforeShare : null} suffix=" pts" /> <span className="text-[11px] text-faint">vs 7 days ago</span></div>
          </div>
        </div>
        <KpiCard icon="key" label="Tracked keywords" value={snap.keywords}
          hint={`${now.measured} measured · ${snap.keywords - now.measured} awaiting data`}
          spark={<Sparkbars values={spark.map((d) => d.measured)} />} />
        <KpiCard icon="target" label="Avg. position" value={now.avgPosition ?? "—"}
          delta={<DeltaChip delta={now.avgPosition !== null && before.avgPosition !== null ? now.avgPosition - before.avgPosition : null} betterWhen="down" precision={1} />}
          hint={`Across ${now.ranked} ranking keywords`}
          spark={<Sparkbars values={spark.flatMap((d) => (d.avgPosition === null ? [] : [d.avgPosition]))} invert />} />
        <KpiCard icon="trophy" label="Top 3" value={now.top3}
          delta={<DeltaChip delta={before.measured ? now.top3 - before.top3 : null} />}
          hint={`${now.top10} in the top 10`}
          spark={<Sparkbars values={spark.map((d) => d.top3)} />} />
        <KpiCard icon="wallet" label="Spend · month" value={showCosts ? formatMoney(spend) : "—"}
          hint={showCosts ? "Actual where reported, else estimate" : "Visible to staff with usage access"}
          spark={showCosts && usage ? <Sparkbars values={usage.daily.map((d) => d.cost ?? 0)} tone="warn" /> : undefined} />
      </div>

      {/* Trend + actions */}
      <div className="grid items-stretch gap-6 xl:grid-cols-3">
        <section className="card p-6 xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold">Ranking trend</h2>
              <p className="text-xs text-muted">Daily aggregate of verified organic observations. Days without checks are skipped, not drawn as zero.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <SegmentedLinks active={metric} options={[{ label: "Top-10 share", value: "top10", href: q({ metric: "top10" }) }, { label: "Avg. position", value: "avg", href: q({ metric: "avg" }) }]} />
              <SegmentedLinks active={range} options={(Object.keys(RANGES) as Range[]).map((r) => ({ label: r.toUpperCase(), value: r, href: q({ range: r }) }))} />
            </div>
          </div>
          <div className="mt-4">
            {metric === "top10" ? (
              <TrendChart label="Top-10 share" domain={[0, 100]} format="percent" secondaryLabel="Keywords measured"
                points={trend.map((d) => ({ day: d.day, value: d.measured ? (d.top10 / d.measured) * 100 : null, secondary: d.measured }))} />
            ) : (
              <TrendChart label="Avg. position (ranked only)" invert format="decimal" secondaryLabel="Not found"
                points={trend.map((d) => ({ day: d.day, value: d.avgPosition, secondary: d.notFound }))} />
            )}
          </div>
        </section>

        <section className="card flex flex-col p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-display text-xl font-semibold">Action center</h2>
              <p className="text-xs text-muted">Prioritized from your live data</p>
            </div>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent"><Icon name="bolt" size={18} /></span>
          </div>
          <ActionList items={items.slice(0, 4)} empty="Everything is collecting normally." />
          {items.length > 4 && <Link href="/alerts" className="mt-3 text-center text-xs font-semibold text-accent hover:underline">View all {items.length} items</Link>}
        </section>
      </div>

      {/* Bottom row */}
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <section className="card p-6">
          <h2 className="font-display mb-4 text-lg font-semibold">Keyword movements</h2>
          {moves.length === 0 ? <p className="text-sm text-muted">No position changes recorded in the last 7 days.</p> : (
            <ul className="space-y-3">
              {[...gains.slice(0, 3), ...losses.slice(0, 3)].map((m) => {
                const up = (m.prev_pos ?? 101) > (m.cur_pos ?? 101);
                const fmt = (p: number | null) => (p === null ? "n/f" : `#${p}`);
                return (
                  <li key={m.keyword_id}>
                    <Link href={`/projects/${m.project_id}/rankings/${m.keyword_id}`} className="flex items-center gap-3 rounded-xl p-1 hover:bg-panel-2">
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${up ? "bg-good/10 text-good" : "bg-bad/10 text-bad"}`}><Icon name={up ? "up" : "down"} size={16} strokeWidth={2.2} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{m.keyword}</span>
                        <span className="block truncate text-xs text-faint">{m.project_name}</span>
                      </span>
                      <span className="text-right text-xs tabular-nums">
                        <span className="block font-semibold text-ink">{fmt(m.cur_pos)}</span>
                        <span className="text-faint">from {fmt(m.prev_pos)}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Project health</h2>
            <Link href="/projects" className="text-xs font-semibold text-accent hover:underline">All projects</Link>
          </div>
          <ul className="space-y-3">
            {health.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="flex items-center gap-3 rounded-xl p-1 hover:bg-panel-2">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-navy text-xs font-bold uppercase text-panel">{p.name.slice(0, 2)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{p.name}</span>
                    <span className="block text-xs text-faint">{p.measured ? `${p.top10}/${p.measured} top 10 · avg ${p.avg ?? "—"}` : `${p.keywords} keywords · no data yet`}</span>
                  </span>
                  <span className="w-20"><Sparkbars values={p.trend} height={26} /></span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Recent activity</h2>
            <Link href="/jobs" className="text-xs font-semibold text-accent hover:underline">Job monitor</Link>
          </div>
          {activity.length === 0 ? <p className="text-sm text-muted">No activity yet.</p> : (
            <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-line">
              {activity.map((a) => {
                const dot = { good: "bg-good", warn: "bg-warn", bad: "bg-bad", info: "bg-info" }[a.tone];
                const body = (
                  <>
                    <span className={`absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full border-2 border-panel ${dot}`} />
                    <span className="block text-sm font-medium">{a.title}</span>
                    <span className="block truncate text-xs text-muted">{a.detail} · {relativeTime(a.at)}</span>
                  </>
                );
                return <li key={a.id} className="relative pl-6">{a.href ? <Link href={a.href} className="block hover:opacity-80">{body}</Link> : body}</li>;
              })}
            </ol>
          )}
        </section>
      </div>

      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-line px-5 py-4 text-sm text-muted">
        <span className="font-semibold text-ink">Coming next:</span>
        {["Maps geo-grid heatmaps", "Search Console & GA4", "AI search visibility", "Citation monitoring", "Client dashboards"].map((m) => (
          <span key={m} className="rounded-full bg-panel px-3 py-1 text-xs font-medium shadow-sm">{m}</span>
        ))}
      </section>
    </div>
  );
}
