import type { Db, Fragment } from "./db";
import { scopeSpend } from "./budget";
import { defaultSerpProvider } from "./providers/registry";

/* Dashboard read models. Every number is derived from stored observations, jobs and usage. */

export interface RankSnapshot { measured: number; ranked: number; top3: number; top10: number; notFound: number; avgPosition: number | null }

/** Latest verified observation per active keyword, now and as of `daysAgo` days ago. */
export async function rankSnapshots(db: Db, filter: Fragment, daysAgo = 7): Promise<{ now: RankSnapshot; before: RankSnapshot; keywords: number }> {
  const [r] = await db<{
    keywords: number;
    n_measured: number; n_ranked: number; n_top3: number; n_top10: number; n_nf: number; n_avg: number | null;
    b_measured: number; b_ranked: number; b_top3: number; b_top10: number; b_nf: number; b_avg: number | null;
  }[]>`
    with kw as (select k.id from keywords k join projects p on p.id = k.project_id where ${filter} and p.status = 'active' and k.is_active),
    cur as (select distinct on (o.keyword_id) o.position, o.result_status from serp_observations o join kw on kw.id = o.keyword_id
            order by o.keyword_id, o.collected_at desc),
    prev as (select distinct on (o.keyword_id) o.position, o.result_status from serp_observations o join kw on kw.id = o.keyword_id
             where o.collected_at <= now() - make_interval(days => ${daysAgo}) order by o.keyword_id, o.collected_at desc)
    select (select count(*)::int from kw) as keywords,
      (select count(*)::int from cur) as n_measured, (select count(position)::int from cur) as n_ranked,
      (select count(*) filter (where position <= 3)::int from cur) as n_top3, (select count(*) filter (where position <= 10)::int from cur) as n_top10,
      (select count(*) filter (where result_status = 'not_found')::int from cur) as n_nf, (select round(avg(position)::numeric, 1)::float8 from cur) as n_avg,
      (select count(*)::int from prev) as b_measured, (select count(position)::int from prev) as b_ranked,
      (select count(*) filter (where position <= 3)::int from prev) as b_top3, (select count(*) filter (where position <= 10)::int from prev) as b_top10,
      (select count(*) filter (where result_status = 'not_found')::int from prev) as b_nf, (select round(avg(position)::numeric, 1)::float8 from prev) as b_avg`;
  const snap = (p: "n" | "b"): RankSnapshot => ({
    measured: r![`${p}_measured`], ranked: r![`${p}_ranked`], top3: r![`${p}_top3`], top10: r![`${p}_top10`], notFound: r![`${p}_nf`], avgPosition: r![`${p}_avg`],
  });
  return { now: snap("n"), before: snap("b"), keywords: r!.keywords };
}

export interface DailyPoint { day: string; measured: number; top3: number; top10: number; avgPosition: number | null; notFound: number }

/** Per-day aggregates of observations collected that day (one point per day with data). */
export async function dailyTrend(db: Db, filter: Fragment, days: number): Promise<DailyPoint[]> {
  const rows = await db<{ day: string; measured: number; top3: number; top10: number; avg: number | null; nf: number }[]>`
    with daily as (
      select distinct on (o.keyword_id, date_trunc('day', o.collected_at)) date_trunc('day', o.collected_at) as d, o.position, o.result_status
      from serp_observations o join keywords k on k.id = o.keyword_id join projects p on p.id = k.project_id
      where ${filter} and k.is_active and o.collected_at > now() - make_interval(days => ${days})
      order by o.keyword_id, date_trunc('day', o.collected_at), o.collected_at desc)
    select to_char(d, 'YYYY-MM-DD') as day, count(*)::int as measured,
      count(*) filter (where position <= 3)::int as top3, count(*) filter (where position <= 10)::int as top10,
      round(avg(position)::numeric, 1)::float8 as avg, count(*) filter (where result_status = 'not_found')::int as nf
    from daily group by d order by d`;
  return rows.map((r) => ({ day: r.day, measured: r.measured, top3: r.top3, top10: r.top10, avgPosition: r.avg, notFound: r.nf }));
}

export interface ActionItem {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  href: string;
  cta: string;
}

/**
 * Prioritized, data-backed to-do list for the agency: things that block data collection or
 * cost money first, then setup gaps.
 */
export async function actionItems(db: Db, filter: Fragment, organizationId: string, opts: { includeBudgets: boolean }): Promise<ActionItem[]> {
  const items: ActionItem[] = [];
  if (!defaultSerpProvider()) {
    items.push({ id: "no-provider", severity: "critical", title: "No SERP provider connected", detail: "Rankings cannot be collected until provider credentials are configured on the server.", href: "/integrations", cta: "Open integrations" });
  }

  const awaiting = await db<{ id: string; project_name: string; estimated_cost: number | null }[]>`
    select j.id, p.name as project_name, j.estimated_cost from tracking_jobs j join projects p on p.id = j.project_id
    where ${filter} and j.status = 'awaiting_approval' order by j.created_at limit 5`;
  for (const j of awaiting) {
    items.push({ id: `approve-${j.id}`, severity: "warning", title: `Job waiting for budget approval`, detail: `${j.project_name}: a collection job is paused because a budget limit was reached.`, href: `/jobs/${j.id}`, cta: "Review job" });
  }

  const failing = await db<{ project_id: string; project_name: string; n: number; code: string | null }[]>`
    with last as (
      select distinct on (t.target_id) t.target_id, t.status, t.error_code, j.project_id
      from tracking_job_targets t join tracking_jobs j on j.id = t.job_id
      where t.target_type = 'keyword' and t.status <> 'skipped' and j.created_at > now() - interval '30 days'
      order by t.target_id, t.updated_at desc)
    select p.id as project_id, p.name as project_name, count(*)::int as n, min(l.error_code) as code
    from last l join projects p on p.id = l.project_id join keywords k on k.id = l.target_id and k.is_active
    where ${filter} and l.status in ('failed', 'uncertain') group by p.id, p.name order by n desc limit 5`;
  for (const f of failing) {
    items.push({ id: `fail-${f.project_id}`, severity: "critical", title: `${f.n} keyword check${f.n === 1 ? "" : "s"} failing`, detail: `${f.project_name}: the latest attempt did not return data${f.code ? ` (${f.code})` : ""}.`, href: `/projects/${f.project_id}/rankings`, cta: "See keywords" });
  }

  const delayed = await db<{ n: number }[]>`
    select count(*)::int as n from tracking_jobs j join projects p on p.id = j.project_id
    where ${filter} and j.status = 'queued' and j.run_after < now() - interval '15 minutes'`;
  if ((delayed[0]?.n ?? 0) > 0) {
    items.push({ id: "delayed", severity: "warning", title: `${delayed[0]!.n} job(s) delayed`, detail: "Queued jobs are waiting longer than 15 minutes. Check that the background worker is running.", href: "/jobs?status=queued", cta: "Open job monitor" });
  }

  if (opts.includeBudgets) {
    const budgets = await db<{ id: string; project_id: string | null; module: string | null; monthly_limit: number; alert_threshold_pct: number; name: string | null }[]>`
      select b.id, b.project_id, b.module, b.monthly_limit, b.alert_threshold_pct, p.name from budgets b left join projects p on p.id = b.project_id
      where b.organization_id = ${organizationId}`;
    for (const b of budgets) {
      const spent = await scopeSpend(db, { organization_id: organizationId, project_id: b.project_id, module: b.module }, new Date());
      const pct = b.monthly_limit > 0 ? (spent / b.monthly_limit) * 100 : 100;
      if (pct >= b.alert_threshold_pct) {
        items.push({ id: `budget-${b.id}`, severity: pct >= 100 ? "critical" : "warning", title: `Budget ${pct >= 100 ? "reached" : `at ${pct.toFixed(0)}%`}`,
          detail: `${b.name ?? "Organization"}${b.module ? ` · ${b.module}` : ""}: new paid scans ${pct >= 100 ? "are restricted" : "may soon be restricted"}.`, href: "/usage", cta: "Manage budgets" });
      }
    }
  }

  const unchecked = await db<{ id: string; name: string; n: number }[]>`
    select p.id, p.name, count(*)::int as n from keywords k join projects p on p.id = k.project_id
    where ${filter} and p.status = 'active' and k.is_active and not exists (select 1 from serp_observations o where o.keyword_id = k.id)
      and not exists (select 1 from tracking_job_targets t where t.target_id = k.id and t.status in ('pending', 'in_flight'))
    group by p.id, p.name order by n desc limit 3`;
  for (const u of unchecked) {
    items.push({ id: `unchecked-${u.id}`, severity: "info", title: `${u.n} keyword${u.n === 1 ? "" : "s"} never checked`, detail: `${u.name}: run a refresh to get baseline positions instead of waiting for the next scheduled run.`, href: `/projects/${u.id}/rankings`, cta: "Collect baseline" });
  }

  const gaps = await db<{ id: string; name: string; keywords: number; competitors: number }[]>`
    select p.id, p.name, (select count(*)::int from keywords k where k.project_id = p.id) as keywords,
      (select count(*)::int from competitors c where c.project_id = p.id) as competitors
    from projects p where ${filter} and p.status = 'active'`;
  for (const g of gaps) {
    if (g.keywords === 0) items.push({ id: `nokw-${g.id}`, severity: "info", title: "Project has no keywords", detail: `${g.name}: add keywords to start tracking.`, href: `/projects/${g.id}/keywords`, cta: "Add keywords" });
    else if (g.competitors === 0) items.push({ id: `nocomp-${g.id}`, severity: "info", title: "No competitors configured", detail: `${g.name}: add competitor domains to benchmark positions on every check.`, href: `/projects/${g.id}/competitors`, cta: "Add competitors" });
  }

  const order = { critical: 0, warning: 1, info: 2 };
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

export interface ProjectHealth { id: string; name: string; domain: string; keywords: number; measured: number; top10: number; avg: number | null; improved: number; declined: number; trend: number[] }

export async function projectHealth(db: Db, filter: Fragment, limit = 6): Promise<ProjectHealth[]> {
  const rows = await db<Omit<ProjectHealth, "trend">[]>`
    with latest as (
      select k.project_id, o.position, o.result_status,
        lag(o.position) over w as prev_pos, lag(o.result_status) over w as prev_status,
        row_number() over (partition by o.keyword_id order by o.collected_at desc) as rn
      from serp_observations o join keywords k on k.id = o.keyword_id join projects p on p.id = k.project_id
      where ${filter} and k.is_active
      window w as (partition by o.keyword_id order by o.collected_at))
    select p.id, p.name, p.domain,
      (select count(*)::int from keywords k where k.project_id = p.id and k.is_active) as keywords,
      count(l.*)::int as measured, count(*) filter (where l.position <= 10)::int as top10,
      round(avg(l.position)::numeric, 1)::float8 as avg,
      count(*) filter (where l.prev_status is not null and coalesce(l.position, 1000) < coalesce(l.prev_pos, 1000))::int as improved,
      count(*) filter (where l.prev_status is not null and coalesce(l.position, 1000) > coalesce(l.prev_pos, 1000))::int as declined
    from projects p left join latest l on l.project_id = p.id and l.rn = 1
    where ${filter} and p.status = 'active'
    group by p.id order by count(l.*) desc, p.name limit ${limit}`;
  const out: ProjectHealth[] = [];
  for (const r of rows) {
    const t = await dailyTrend(db, db`p.id = ${r.id}`, 60);
    out.push({ ...r, trend: t.slice(-10).map((d) => (d.measured ? Math.round((d.top10 / d.measured) * 100) : 0)) });
  }
  return out;
}

export interface ActivityItem { id: string; kind: "job" | "audit"; at: Date; title: string; detail: string; tone: "good" | "warn" | "bad" | "info"; href?: string }

const AUDIT_LABELS: Record<string, string> = {
  "project.created": "Project created", "schedule.updated": "Schedule changed", "schedule.missed": "Missed run recovered",
  "keywords.added": "Keywords added", "refresh.requested": "Manual refresh requested", "budget.saved": "Budget updated",
  "job.approved": "Job approved", "job.budget_blocked": "Scheduled run blocked by budget", "member.saved": "Team member updated",
  "project.paused": "Project paused", "project.active": "Project resumed", "competitor.added": "Competitor added",
};

export async function recentActivity(db: Db, filter: Fragment, organizationId: string, limit = 8): Promise<ActivityItem[]> {
  const jobs = await db<{ id: string; status: string; trigger: string; completed_at: Date; project_name: string; summary: Record<string, number> }[]>`
    select j.id, j.status, j.trigger, j.completed_at, p.name as project_name, j.result_summary_json as summary
    from tracking_jobs j join projects p on p.id = j.project_id
    where ${filter} and j.completed_at is not null and j.status in ('completed', 'partial', 'failed')
    order by j.completed_at desc limit ${limit}`;
  const logs = await db<{ id: string; action: string; created_at: Date; email: string | null; entity_type: string; entity_id: string | null }[]>`
    select a.id, a.action, a.created_at, u.email, a.entity_type, a.entity_id from audit_logs a left join users u on u.id = a.actor_user_id
    where a.organization_id = ${organizationId} and a.action = any(${Object.keys(AUDIT_LABELS)})
    order by a.created_at desc limit ${limit}`;
  const items: ActivityItem[] = [
    ...jobs.map((j) => ({
      id: j.id, kind: "job" as const, at: j.completed_at, href: `/jobs/${j.id}`,
      title: j.status === "completed" ? "Rank check completed" : j.status === "partial" ? "Rank check partially completed" : "Rank check failed",
      detail: [j.project_name, j.summary?.total ? `${j.summary.succeeded ?? 0}/${j.summary.total} keywords` : null, j.trigger].filter(Boolean).join(" · "),
      tone: (j.status === "completed" ? "good" : j.status === "partial" ? "warn" : "bad") as ActivityItem["tone"],
    })),
    ...logs.map((l) => ({
      id: l.id, kind: "audit" as const, at: l.created_at, title: AUDIT_LABELS[l.action] ?? l.action,
      detail: l.email ?? "System", tone: (l.action.includes("blocked") || l.action.includes("missed") ? "warn" : "info") as ActivityItem["tone"],
      href: l.entity_type === "project" && l.entity_id ? `/projects/${l.entity_id}` : undefined,
    })),
  ];
  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
