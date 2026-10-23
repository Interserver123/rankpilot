import { createHash } from "node:crypto";
import { backoffDelayMs } from "@/lib/retry";
import type { Db, Sql } from "../db";
import { audit } from "../audit";
import { evaluateBudgets, summarizeBudgets, type ScopedBudgetResult } from "../budget";

export type JobStatus = "awaiting_approval" | "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";
export const ACTIVE_STATUSES: JobStatus[] = ["awaiting_approval", "queued", "running"];

export interface JobRow {
  id: string;
  organization_id: string;
  project_id: string;
  tracking_config_id: string | null;
  module: string;
  job_type: string;
  provider: string;
  trigger: "scheduled" | "manual" | "initial" | "recovery";
  status: JobStatus;
  priority: number;
  idempotency_key: string;
  requested_by_user_id: string | null;
  scheduled_for: Date;
  run_after: Date;
  started_at: Date | null;
  completed_at: Date | null;
  locked_by: string | null;
  locked_at: Date | null;
  attempts: number;
  max_attempts: number;
  estimated_cost: number | null;
  actual_cost: number | null;
  currency: string;
  payload_json: Record<string, unknown>;
  result_summary_json: Record<string, unknown>;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
}

export interface EnqueueInput {
  organizationId: string;
  projectId: string;
  trackingConfigId?: string | null;
  module: "organic" | "maps" | "llm" | "citations" | "gsc" | "ga4";
  jobType: string;
  provider: string;
  trigger: JobRow["trigger"];
  requestedByUserId?: string | null;
  priority?: number;
  payload?: Record<string, unknown>;
  targetType: "keyword" | "map_point" | "llm_prompt" | "citation";
  targetIds: string[];
  /** Per-target cost estimate (null = unknown price). */
  costPerTarget: number | null;
  currency: string;
  /** Admin override: queue even if a "require_approval" budget is exceeded. */
  budgetOverride?: boolean;
}

export type EnqueueResult =
  | { kind: "queued"; job: JobRow; skippedTargets: number; targets: number }
  | { kind: "awaiting_approval"; job: JobRow; blockedBy: ScopedBudgetResult[]; skippedTargets: number }
  | { kind: "duplicate"; skippedTargets: number } // every target already has an active job
  | { kind: "budget_blocked"; blockedBy: ScopedBudgetResult[]; job: JobRow | null }
  | { kind: "nothing_to_do" };

function hashKey(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

/**
 * Enqueues a job, deduplicating at the target level: targets already pending or in flight in
 * another active job of the same module are skipped, so repeated clicks or overlapping
 * "refresh all" requests never send duplicate provider requests. Serialized per
 * project+module with an advisory lock so concurrent requests cannot race.
 */
export async function enqueueJob(sql: Sql, input: EnqueueInput, now = new Date()): Promise<EnqueueResult> {
  if (input.targetIds.length === 0) return { kind: "nothing_to_do" };
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`enqueue:${input.projectId}:${input.module}`}))`;

    const active = await tx<{ target_id: string }[]>`
      select t.target_id from tracking_job_targets t
      join tracking_jobs j on j.id = t.job_id
      where j.project_id = ${input.projectId} and j.module = ${input.module}
        and j.status in ('awaiting_approval', 'queued', 'running')
        and t.status in ('pending', 'in_flight')
        and t.target_type = ${input.targetType}
        and t.target_id = any(${input.targetIds}::uuid[])`;
    const busy = new Set(active.map((r) => r.target_id));
    const targets = [...new Set(input.targetIds)].filter((id) => !busy.has(id)).sort();
    const skippedTargets = input.targetIds.length - targets.length;
    if (targets.length === 0) return { kind: "duplicate", skippedTargets } as const;

    const estimate = input.costPerTarget === null ? null : Math.round(input.costPerTarget * targets.length * 10000) / 10000;
    const budget = summarizeBudgets(await evaluateBudgets(tx, input.organizationId, input.projectId, input.module, estimate, now));

    let status: JobStatus = "queued";
    let errorCode: string | null = null;
    if (budget.kind === "block") {
      if (input.trigger === "manual") return { kind: "budget_blocked", blockedBy: budget.blockedBy, job: null } as const;
      // Scheduled runs are recorded as cancelled so the skipped run is visible in the job monitor.
      status = "cancelled";
      errorCode = "budget_blocked";
    } else if (budget.kind === "require_approval" && !input.budgetOverride) {
      status = "awaiting_approval";
    }

    const idempotencyKey = `${input.module}:${input.projectId}:${hashKey(targets)}`;
    const [job] = await tx<JobRow[]>`
      insert into tracking_jobs (organization_id, project_id, tracking_config_id, module, job_type, provider, trigger,
        status, priority, idempotency_key, requested_by_user_id, scheduled_for, run_after, estimated_cost, currency,
        payload_json, error_code, error_message, completed_at)
      values (${input.organizationId}, ${input.projectId}, ${input.trackingConfigId ?? null}, ${input.module}, ${input.jobType},
        ${input.provider}, ${input.trigger}, ${status}, ${input.priority ?? 100}, ${idempotencyKey},
        ${input.requestedByUserId ?? null}, ${now}, ${now}, ${estimate}, ${input.currency},
        ${tx.json((input.payload ?? {}) as never)}, ${errorCode},
        ${errorCode ? "Budget limit reached; scheduled run skipped" : null}, ${status === "cancelled" ? now : null})
      returning *`;
    if (!job) throw new Error("Failed to insert job");

    await tx`
      insert into tracking_job_targets ${tx(targets.map((id) => ({
        job_id: job.id, target_type: input.targetType, target_id: id, status: status === "cancelled" ? "skipped" : "pending",
      })))}`;

    if (budget.kind === "block") {
      await audit(tx, { organizationId: input.organizationId, actorUserId: null, action: "job.budget_blocked", entityType: "tracking_job", entityId: job.id, metadata: { budgets: budget.blockedBy.map((b) => b.budget.id) } });
      return { kind: "budget_blocked", blockedBy: budget.blockedBy, job } as const;
    }
    if (status === "awaiting_approval") {
      return { kind: "awaiting_approval", job, blockedBy: (budget as { blockedBy: ScopedBudgetResult[] }).blockedBy, skippedTargets } as const;
    }
    return { kind: "queued", job, skippedTargets, targets: targets.length } as const;
  });
}

export async function approveJob(sql: Sql, jobId: string, organizationId: string, actorUserId: string): Promise<boolean> {
  return sql.begin(async (tx) => {
    const rows = await tx`
      update tracking_jobs set status = 'queued', run_after = now()
      where id = ${jobId} and organization_id = ${organizationId} and status = 'awaiting_approval' returning id`;
    if (rows.length === 0) return false;
    await audit(tx, { organizationId, actorUserId, action: "job.approved", entityType: "tracking_job", entityId: jobId });
    return true;
  });
}

export async function cancelJob(sql: Sql, jobId: string, organizationId: string, actorUserId: string): Promise<boolean> {
  return sql.begin(async (tx) => {
    // Running jobs are not interrupted mid-request; only waiting jobs can be cancelled.
    const rows = await tx`
      update tracking_jobs set status = 'cancelled', completed_at = now(), error_code = 'cancelled', error_message = 'Cancelled by user'
      where id = ${jobId} and organization_id = ${organizationId} and status in ('awaiting_approval', 'queued') returning id`;
    if (rows.length === 0) return false;
    await tx`update tracking_job_targets set status = 'skipped', updated_at = now() where job_id = ${jobId} and status = 'pending'`;
    await audit(tx, { organizationId, actorUserId, action: "job.cancelled", entityType: "tracking_job", entityId: jobId });
    return true;
  });
}

/**
 * Claims the next runnable job for a provider without exceeding its concurrency limit.
 * The advisory lock makes the running-count check and claim atomic across workers.
 */
export async function claimJob(sql: Sql, provider: string, maxConcurrency: number, workerId: string): Promise<JobRow | null> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`claim:${provider}`}))`;
    const [{ n } = { n: 0 }] = await tx<{ n: number }[]>`
      select count(*)::int as n from tracking_jobs where provider = ${provider} and status = 'running'`;
    if (n >= maxConcurrency) return null;
    const [job] = await tx<JobRow[]>`
      update tracking_jobs set status = 'running', locked_by = ${workerId}, locked_at = now(),
        started_at = coalesce(started_at, now()), attempts = attempts + 1
      where id = (
        select j.id from tracking_jobs j join projects p on p.id = j.project_id
        where j.provider = ${provider} and j.status = 'queued' and j.run_after <= now() and p.status = 'active'
        order by j.priority, j.run_after
        for update of j skip locked limit 1)
      returning *`;
    return job ?? null;
  });
}

export async function heartbeat(db: Db, jobId: string, workerId: string) {
  await db`update tracking_jobs set locked_at = now() where id = ${jobId} and locked_by = ${workerId} and status = 'running'`;
}

/**
 * Recovers jobs whose worker died. In-flight targets become "uncertain" (the request may have
 * been billed) and are NOT retried automatically; pending targets are re-queued.
 */
export async function reapStaleJobs(sql: Sql, staleAfterMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const stale = await sql<{ id: string }[]>`
    select id from tracking_jobs where status = 'running' and locked_at < ${cutoff}`;
  for (const { id } of stale) {
    await sql.begin(async (tx) => {
      const [job] = await tx<JobRow[]>`select * from tracking_jobs where id = ${id} and status = 'running' and locked_at < ${cutoff} for update`;
      if (!job) return;
      await tx`
        update tracking_job_targets set status = 'uncertain', error_code = 'worker_lost',
          error_message = 'Worker stopped while this request was in flight; it may have been billed and was not retried',
          updated_at = now()
        where job_id = ${id} and status = 'in_flight'`;
      await finalizeJob(tx, job, { retryAfterMs: 0, now: new Date() });
    });
  }
  return stale.length;
}

export interface TargetCounts { pending: number; in_flight: number; succeeded: number; failed: number; uncertain: number; skipped: number; total: number }

export async function targetCounts(db: Db, jobId: string): Promise<TargetCounts> {
  const rows = await db<{ status: keyof TargetCounts; n: number }[]>`
    select status, count(*)::int as n from tracking_job_targets where job_id = ${jobId} group by status`;
  const c: TargetCounts = { pending: 0, in_flight: 0, succeeded: 0, failed: 0, uncertain: 0, skipped: 0, total: 0 };
  for (const r of rows) { c[r.status] = r.n; c.total += r.n; }
  return c;
}

/**
 * Settles a job after a processing pass: re-queues with backoff if pending targets remain and
 * attempts are left, otherwise sets completed / partial / failed from per-target outcomes.
 */
export async function finalizeJob(
  db: Db, job: JobRow, opts: { retryAfterMs: number; now: Date; fatalError?: { code: string; message: string } },
): Promise<JobStatus> {
  let counts = await targetCounts(db, job.id);

  if (counts.pending > 0 && !opts.fatalError && job.attempts < job.max_attempts) {
    const delay = Math.max(backoffDelayMs(job.attempts), opts.retryAfterMs);
    await db`
      update tracking_jobs set status = 'queued', locked_by = null, locked_at = null,
        run_after = ${new Date(opts.now.getTime() + delay)},
        result_summary_json = ${db.json(counts as never)}
      where id = ${job.id}`;
    return "queued";
  }

  if (counts.pending > 0) {
    await db`
      update tracking_job_targets set status = 'failed',
        error_code = coalesce(error_code, ${opts.fatalError?.code ?? "max_attempts_exceeded"}),
        error_message = coalesce(error_message, ${opts.fatalError?.message ?? "Gave up after the maximum number of attempts"}),
        updated_at = now()
      where job_id = ${job.id} and status = 'pending'`;
    counts = await targetCounts(db, job.id);
  }

  const considered = counts.total - counts.skipped;
  const status: JobStatus =
    considered === 0 ? "completed"
    : counts.succeeded === considered ? "completed"
    : counts.succeeded > 0 ? "partial"
    : "failed";

  const [{ cost } = { cost: null }] = await db<{ cost: number | null }[]>`
    select sum(coalesce(actual_cost, estimated_cost))::float8 as cost from provider_usage where job_id = ${job.id}`;
  const errorCode = status === "completed" ? null : opts.fatalError?.code ?? (status === "failed" ? "all_targets_failed" : "some_targets_failed");
  const errorMessage = status === "completed" ? null
    : opts.fatalError?.message ?? `${counts.failed + counts.uncertain} of ${considered} targets did not complete`;

  await db`
    update tracking_jobs set status = ${status}, completed_at = ${opts.now}, locked_by = null, locked_at = null,
      actual_cost = ${cost}, result_summary_json = ${db.json(counts as never)},
      error_code = ${errorCode}, error_message = ${errorMessage}
    where id = ${job.id}`;

  if (job.tracking_config_id) {
    await db`
      update tracking_configs set last_run_at = ${opts.now},
        last_success_at = case when ${counts.succeeded > 0} then ${opts.now}::timestamptz else last_success_at end
      where id = ${job.tracking_config_id}`;
  }
  return status;
}
