import Link from "next/link";
import { requireStaff, visibleProjectsFilter } from "@/server/authz";
import { sql } from "@/server/db";
import { delayedJobs, jobStatusCounts, rankMovements, usageSummary, listBudgets } from "@/server/queries";
import { scopeSpend } from "@/server/budget";
import { Card, PageHeader, Stat, Badge, EmptyState } from "@/components/ui";
import { formatMoney } from "@/lib/cost";
import { relativeTime } from "@/lib/format";
import { canOrg } from "@/lib/permissions";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const user = await requireStaff();
  const filter = visibleProjectsFilter(sql, user);
  const [counts] = await sql<{ projects: number; keywords: number; due24h: number; overdue: number }[]>`
    select
      (select count(*)::int from projects p where ${filter} and p.status = 'active') as projects,
      (select count(*)::int from keywords k join projects p on p.id = k.project_id where ${filter} and p.status = 'active' and k.is_active) as keywords,
      (select count(*)::int from tracking_configs c join projects p on p.id = c.project_id
        where ${filter} and p.status = 'active' and c.enabled and c.next_run_at between now() and now() + interval '24 hours') as due24h,
      (select count(*)::int from tracking_configs c join projects p on p.id = c.project_id
        where ${filter} and p.status = 'active' and c.enabled and c.next_run_at < now() - interval '15 minutes') as overdue`;
  const jobs = await jobStatusCounts(sql, filter);
  const delayed = await delayedJobs(sql, filter);
  const moves = await rankMovements(sql, filter, 7, 12);
  const gains = moves.filter((m) => (m.prev_pos ?? 101) > (m.cur_pos ?? 101));
  const losses = moves.filter((m) => (m.prev_pos ?? 101) < (m.cur_pos ?? 101));

  const showCosts = canOrg(user.role, "usage.view");
  const usage = showCosts ? await usageSummary(sql, user.organizationId) : null;
  const monthCost = usage?.byProvider.reduce((a, r) => a + (r.cost ?? 0), 0) ?? 0;
  const budgets = showCosts ? await listBudgets(sql, user.organizationId) : [];
  const overBudget: { name: string; pct: number }[] = [];
  for (const b of budgets) {
    const spent = await scopeSpend(sql, { organization_id: user.organizationId, project_id: b.project_id, module: b.module }, new Date());
    const pct = b.monthly_limit > 0 ? (spent / b.monthly_limit) * 100 : 100;
    if (pct >= b.alert_threshold_pct) overBudget.push({ name: `${b.project_name ?? "Organization"}${b.module ? ` · ${b.module}` : ""}`, pct });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Agency overview" subtitle="Latest successfully collected data across your projects." actions={<Link href="/projects/new" className="btn-primary">New project</Link>} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active projects" value={counts?.projects ?? 0} href="/projects" />
        <Stat label="Tracked keywords" value={counts?.keywords ?? 0} href="/rank-tracking" />
        <Stat label="Scans due (24h)" value={counts?.due24h ?? 0} hint={counts?.overdue ? `${counts.overdue} overdue` : "None overdue"} />
        <Stat label="Spend this month" value={showCosts ? formatMoney(monthCost) : "—"} hint="Actual where reported, otherwise estimated" href={showCosts ? "/usage" : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Jobs (active + last 7 days)" actions={<Link className="link text-xs" href="/jobs">Job monitor</Link>}>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {(["queued", "running", "awaiting_approval", "completed", "partial", "failed"] as const).map((s) => (
              <Link key={s} href={`/jobs?status=${s}`} className="flex items-center justify-between rounded-lg bg-panel-2 px-3 py-2 hover:ring-1 hover:ring-accent/50">
                <span className="capitalize text-muted">{s.replace("_", " ")}</span>
                <span className="font-semibold tabular-nums">{jobs[s] ?? 0}</span>
              </Link>
            ))}
          </div>
          {delayed > 0 && <p className="mt-3 text-sm text-warn">{delayed} queued job(s) are delayed by more than 15 minutes. Check that the worker is running.</p>}
        </Card>

        <Card title="Biggest ranking gains (7 days)">
          {gains.length === 0 ? <p className="text-sm text-muted">No gains recorded in the last 7 days.</p> : (
            <ul className="space-y-2 text-sm">{gains.slice(0, 6).map((m) => <Movement key={m.keyword_id} m={m} />)}</ul>
          )}
        </Card>
        <Card title="Biggest ranking losses (7 days)">
          {losses.length === 0 ? <p className="text-sm text-muted">No losses recorded in the last 7 days.</p> : (
            <ul className="space-y-2 text-sm">{losses.slice(0, 6).map((m) => <Movement key={m.keyword_id} m={m} />)}</ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Budgets needing attention">
          {!showCosts ? <p className="text-sm text-muted">Cost data is visible to administrators.</p>
            : overBudget.length === 0 ? <p className="text-sm text-muted">{budgets.length ? "All budgets are below their alert thresholds." : "No budgets configured."} <Link className="link" href="/usage">Manage budgets</Link></p>
            : <ul className="space-y-2 text-sm">{overBudget.map((b) => (
                <li key={b.name} className="flex justify-between"><span>{b.name}</span><Badge tone={b.pct >= 100 ? "bad" : "warn"}>{b.pct.toFixed(0)}% used</Badge></li>))}</ul>}
        </Card>
        <Card title="Other modules">
          <ul className="space-y-2 text-sm text-muted">
            <li>Maps visibility, AI visibility, citations, Search Console and GA4 are planned modules. Their data will appear here once enabled.</li>
          </ul>
        </Card>
      </div>
      {counts?.projects === 0 && <EmptyState title="No projects yet" action={<Link href="/projects/new" className="btn-primary">Create your first project</Link>}>Create a project to start tracking rankings.</EmptyState>}
    </div>
  );
}

function Movement({ m }: { m: { project_id: string; project_name: string; keyword_id: string; keyword: string; cur_pos: number | null; prev_pos: number | null; collected_at: Date } }) {
  const fmt = (p: number | null) => (p === null ? "n/f" : `#${p}`);
  return (
    <li className="flex items-center justify-between gap-3">
      <Link className="min-w-0 truncate hover:underline" href={`/projects/${m.project_id}/rankings/${m.keyword_id}`}>
        <span className="text-ink">{m.keyword}</span> <span className="text-faint">· {m.project_name}</span>
      </Link>
      <span className="shrink-0 tabular-nums text-muted" title={relativeTime(m.collected_at)}>{fmt(m.prev_pos)} → <span className="text-ink">{fmt(m.cur_pos)}</span></span>
    </li>
  );
}
