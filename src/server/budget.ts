import { checkBudget, type BudgetDecision } from "@/lib/cost";
import type { Db } from "./db";

export interface BudgetRow {
  id: string;
  organization_id: string;
  project_id: string | null;
  module: string | null;
  monthly_limit: number;
  currency: string;
  alert_threshold_pct: number;
  on_limit: "block" | "require_approval";
}

export interface ScopedBudgetResult {
  budget: BudgetRow;
  spent: number;
  decision: BudgetDecision;
}

export function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Month-to-date spend for a budget scope: recorded usage (actual cost, else estimate) plus the
 * estimates of jobs still queued, which reserve budget before they run.
 */
export async function scopeSpend(db: Db, b: Pick<BudgetRow, "organization_id" | "project_id" | "module">, now: Date): Promise<number> {
  const since = monthStartUtc(now);
  const [usage] = await db<{ total: number | null }[]>`
    select sum(coalesce(actual_cost, estimated_cost, 0))::float8 as total from provider_usage
    where organization_id = ${b.organization_id} and recorded_at >= ${since}
      ${b.project_id ? db`and project_id = ${b.project_id}` : db``}
      ${b.module ? db`and module = ${b.module}` : db``}`;
  const [queued] = await db<{ total: number | null }[]>`
    select sum(coalesce(estimated_cost, 0))::float8 as total from tracking_jobs
    where organization_id = ${b.organization_id} and status = 'queued' and attempts = 0
      ${b.project_id ? db`and project_id = ${b.project_id}` : db``}
      ${b.module ? db`and module = ${b.module}` : db``}`;
  return (usage?.total ?? 0) + (queued?.total ?? 0);
}

/** Evaluates every budget that applies to (org, project, module): global, module, project, project+module. */
export async function evaluateBudgets(
  db: Db, organizationId: string, projectId: string, module: string, estimate: number | null, now = new Date(),
): Promise<ScopedBudgetResult[]> {
  const budgets = await db<BudgetRow[]>`
    select * from budgets where organization_id = ${organizationId}
      and (project_id is null or project_id = ${projectId})
      and (module is null or module = ${module})`;
  const out: ScopedBudgetResult[] = [];
  for (const b of budgets) {
    const spent = await scopeSpend(db, b, now);
    out.push({ budget: b, spent, decision: checkBudget({ limit: b.monthly_limit, spent, alertThresholdPct: b.alert_threshold_pct }, estimate) });
  }
  return out;
}

export type BudgetOutcome =
  | { kind: "ok"; warnings: ScopedBudgetResult[] }
  | { kind: "require_approval"; blockedBy: ScopedBudgetResult[] }
  | { kind: "block"; blockedBy: ScopedBudgetResult[] };

export function summarizeBudgets(results: ScopedBudgetResult[]): BudgetOutcome {
  const blocked = results.filter((r) => !r.decision.allowed);
  if (blocked.length === 0) return { kind: "ok", warnings: results.filter((r) => r.decision.allowed && r.decision.warning) };
  if (blocked.some((r) => r.budget.on_limit === "block")) return { kind: "block", blockedBy: blocked };
  return { kind: "require_approval", blockedBy: blocked };
}
