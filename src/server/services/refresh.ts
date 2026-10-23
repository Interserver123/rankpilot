import type { Sql } from "../db";
import { audit } from "../audit";
import { enqueueOrganic, organicEstimate } from "../jobs/organic";
import type { Actor } from "./projects";

/** Manual refreshes above this estimated amount (or unit count, when price is unknown) need confirmation. */
export function confirmThreshold() {
  return {
    amount: Number(process.env.MANUAL_REFRESH_CONFIRM_AMOUNT ?? 1),
    units: Number(process.env.MANUAL_REFRESH_CONFIRM_UNITS ?? 100),
  };
}

export type RefreshResult =
  | { kind: "needs_confirmation"; estimate: Awaited<ReturnType<typeof organicEstimate>> }
  | { kind: "queued"; jobId: string; targets: number; skipped: number }
  | { kind: "awaiting_approval"; jobId: string }
  | { kind: "duplicate"; skipped: number }
  | { kind: "budget_blocked"; message: string }
  | { kind: "no_provider" }
  | { kind: "nothing_to_do" };

/**
 * Manual organic refresh. Creates a job and returns immediately; it never changes the
 * recurring schedule. Expensive refreshes must be confirmed first.
 */
export async function requestOrganicRefresh(
  sql: Sql, actor: Actor, projectId: string, keywordIds: string[] | null,
  opts: { confirmed: boolean; budgetOverride?: boolean },
): Promise<RefreshResult> {
  const estimate = await organicEstimate(sql, projectId, keywordIds);
  const t = confirmThreshold();
  const material = estimate.amount !== null ? estimate.amount >= t.amount : estimate.units >= t.units;
  if (material && !opts.confirmed) return { kind: "needs_confirmation", estimate };

  const result = await enqueueOrganic(sql, { projectId, keywordIds, trigger: "manual", requestedByUserId: actor.id, budgetOverride: opts.budgetOverride });
  switch (result.kind) {
    case "queued":
      await audit(sql, { organizationId: actor.organizationId, actorUserId: actor.id, action: "refresh.requested", entityType: "tracking_job", entityId: result.job.id,
        metadata: { module: "organic", targets: keywordIds?.length ?? "all", estimate: estimate.amount } });
      return { kind: "queued", jobId: result.job.id, targets: result.targets, skipped: result.skippedTargets };
    case "awaiting_approval":
      return { kind: "awaiting_approval", jobId: result.job.id };
    case "duplicate":
      return { kind: "duplicate", skipped: result.skippedTargets };
    case "budget_blocked":
      return { kind: "budget_blocked", message: "A budget limit has been reached. An administrator must raise the budget before new paid scans can run." };
    default:
      return result;
  }
}
