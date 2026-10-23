import { requireStaff } from "@/server/authz";
import { sql } from "@/server/db";
import { listBudgets, usageSummary } from "@/server/queries";
import { scopeSpend } from "@/server/budget";
import { describeProviders } from "@/server/providers/registry";
import { formatMoney } from "@/lib/cost";
import { formatNumber } from "@/lib/format";
import { canOrg } from "@/lib/permissions";
import { Badge, Card, PageHeader } from "@/components/ui";
import { BarSeries } from "@/components/charts";
import { BudgetForm, DeleteBudget } from "./budget-forms";

export const metadata = { title: "Usage & Costs" };

export default async function UsagePage() {
  const user = await requireStaff("usage.view");
  const usage = await usageSummary(sql, user.organizationId);
  const budgets = await listBudgets(sql, user.organizationId);
  const now = new Date();
  const budgetRows = await Promise.all(budgets.map(async (b) => ({ ...b, spent: await scopeSpend(sql, { organization_id: user.organizationId, project_id: b.project_id, module: b.module }, now) })));
  const projects = await sql<{ id: string; name: string }[]>`select id, name from projects where organization_id = ${user.organizationId} and status <> 'archived' order by name`;
  const total = usage.byProvider.reduce((a, r) => a + (r.cost ?? 0), 0);
  const unpriced = usage.byProvider.reduce((a, r) => a + r.unpriced, 0);
  const isAdmin = canOrg(user.role, "budget.manage");
  const monthLabel = usage.since.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="space-y-6">
      <PageHeader title="Usage & costs" subtitle={`${monthLabel} (UTC), month to date. Actual provider-reported cost is used where available; otherwise the configured estimate.`} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Spend this month">
          <div className="text-3xl font-semibold">{formatMoney(total)}</div>
          {unpriced > 0 && <p className="mt-1 text-xs text-warn">{unpriced} usage record(s) have no price configured and are not included.</p>}
          <div className="mt-4"><BarSeries data={usage.daily.map((d) => ({ label: d.day, value: d.cost ?? 0 }))} format={(n) => formatMoney(n)} /></div>
        </Card>
        <Card title="By provider" className="lg:col-span-2">
          {usage.byProvider.length === 0 ? <p className="text-sm text-muted">No usage recorded this month.</p> : (
            <table className="table"><thead><tr><th>Provider</th><th>Module</th><th className="text-right">Units</th><th className="text-right">Cost</th></tr></thead>
              <tbody>{usage.byProvider.map((r) => <tr key={`${r.provider}-${r.module}`}><td>{r.provider}</td><td className="text-muted">{r.module}</td><td className="text-right tabular-nums">{formatNumber(r.units)}</td><td className="text-right tabular-nums">{formatMoney(r.cost, r.currency)}</td></tr>)}</tbody></table>
          )}
        </Card>
      </div>

      <Card title="By project and module">
        {usage.byProject.length === 0 ? <p className="text-sm text-muted">No usage recorded this month.</p> : (
          <table className="table"><thead><tr><th>Project</th><th>Module</th><th className="text-right">Units</th><th className="text-right">Cost</th></tr></thead>
            <tbody>{usage.byProject.map((r) => <tr key={`${r.project_id}-${r.module}`}><td>{r.project_name}</td><td className="text-muted">{r.module}</td><td className="text-right tabular-nums">{formatNumber(r.units)}</td><td className="text-right tabular-nums">{formatMoney(r.cost)}</td></tr>)}</tbody></table>
        )}
      </Card>

      <Card title="Budgets" footer="Spend includes recorded usage plus estimates for queued jobs. Providers with variable or delayed billing may differ from invoices; reconcile monthly.">
        {budgetRows.length === 0 ? <p className="mb-4 text-sm text-muted">No budgets configured. Without a budget, paid jobs are limited only by provider rate limits.</p> : (
          <table className="table mb-4">
            <thead><tr><th>Scope</th><th>Module</th><th className="text-right">Spent</th><th className="text-right">Limit</th><th>Usage</th><th>When reached</th><th></th></tr></thead>
            <tbody>
              {budgetRows.map((b) => {
                const pct = b.monthly_limit > 0 ? (b.spent / b.monthly_limit) * 100 : 100;
                return (
                  <tr key={b.id}>
                    <td>{b.project_name ?? "Whole organization"}</td><td className="text-muted">{b.module ?? "All"}</td>
                    <td className="text-right tabular-nums">{formatMoney(b.spent, b.currency)}</td><td className="text-right tabular-nums">{formatMoney(b.monthly_limit, b.currency)}</td>
                    <td><Badge tone={pct >= 100 ? "bad" : pct >= b.alert_threshold_pct ? "warn" : "good"}>{pct.toFixed(0)}%</Badge></td>
                    <td className="text-muted">{b.on_limit === "block" ? "Block" : "Require approval"}</td>
                    <td>{isAdmin && <DeleteBudget id={b.id} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {isAdmin && <BudgetForm projects={projects} />}
      </Card>

      <Card title="Provider pricing & limits">
        <table className="table"><thead><tr><th>Provider</th><th>Status</th><th className="text-right">Price per unit</th><th className="text-right">Max concurrent jobs</th><th className="text-right">Requests / min</th></tr></thead>
          <tbody>{describeProviders().map((p) => (
            <tr key={p.id}><td>{p.name}</td><td>{p.configured ? <Badge tone="good">configured</Badge> : <Badge>not configured</Badge>}</td>
              <td className="text-right tabular-nums">{p.pricePerUnit === null ? "not set" : formatMoney(p.pricePerUnit, p.currency)}</td>
              <td className="text-right tabular-nums">{p.limits.maxConcurrency}</td><td className="text-right tabular-nums">{p.limits.requestsPerMinute}</td></tr>
          ))}</tbody></table>
      </Card>
    </div>
  );
}
