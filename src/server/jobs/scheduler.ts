import { advanceSchedule, type IntervalUnit } from "@/lib/schedule";
import type { Sql } from "../db";
import { audit } from "../audit";
import { enqueueOrganic } from "./organic";

/** A run that starts this long after its slot is labelled a recovery run. */
const LATE_GRACE_MS = 60 * 60_000;

export interface DueConfig {
  id: string;
  project_id: string;
  organization_id: string;
  module: string;
  target_type: string;
  target_tag: string | null;
  interval_value: number;
  interval_unit: IntervalUnit;
  preferred_run_time: string;
  timezone: string;
  next_run_at: Date;
}

/** Modules with a working collector. Others can be configured but are not run yet. */
export const RUNNABLE_MODULES = new Set(["organic"]);

/**
 * Finds due tracking configs, advances their schedule and enqueues one job each.
 * The scheduler never calls providers itself, and never backfills missed slots: an overdue
 * config gets a single recovery run and the missed slots are written to the audit log.
 */
export async function runSchedulerTick(sql: Sql, now = new Date()): Promise<{ enqueued: number; skipped: number }> {
  let enqueued = 0;
  let skipped = 0;
  const due = await sql.begin(async (tx) => {
    const rows = await tx<DueConfig[]>`
      select c.id, c.project_id, p.organization_id, c.module, c.target_type, c.target_tag, c.interval_value, c.interval_unit,
        c.preferred_run_time::text as preferred_run_time, c.timezone, c.next_run_at
      from tracking_configs c join projects p on p.id = c.project_id
      where c.enabled and c.next_run_at <= ${now} and p.status = 'active'
      order by c.next_run_at
      for update of c skip locked limit 200`;
    for (const c of rows) {
      const { nextRunAt, missedSlots } = advanceSchedule(
        { intervalValue: c.interval_value, intervalUnit: c.interval_unit, preferredRunTime: c.preferred_run_time, timezone: c.timezone },
        c.next_run_at, now,
      );
      await tx`update tracking_configs set next_run_at = ${nextRunAt}, updated_at = now() where id = ${c.id}`;
      if (missedSlots > 0) {
        await audit(tx, { organizationId: c.organization_id, actorUserId: null, action: "schedule.missed", entityType: "tracking_config", entityId: c.id,
          metadata: { missed_slots: missedSlots, due_at: c.next_run_at.toISOString(), recovered_at: now.toISOString() } });
      }
    }
    return rows;
  });

  for (const c of due) {
    if (!RUNNABLE_MODULES.has(c.module)) { skipped++; continue; }
    const late = now.getTime() - c.next_run_at.getTime() > LATE_GRACE_MS;
    const result = await enqueueOrganic(sql, {
      projectId: c.project_id,
      keywordIds: null,
      tag: c.target_type === "keyword_tag" ? c.target_tag : null,
      trigger: late ? "recovery" : "scheduled",
      trackingConfigId: c.id,
    });
    if (result.kind === "queued" || result.kind === "awaiting_approval") enqueued++;
    else skipped++;
  }
  return { enqueued, skipped };
}
