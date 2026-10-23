import { sql } from "../db";
import { runWorkerPass } from "./worker";

/**
 * Serverless hosts (Vercel) cannot run the long-lived worker. They process queued jobs inline instead:
 * right after a refresh is requested, and from the cron endpoint. Disable with INLINE_WORKER=off
 * when a dedicated `npm run worker` host does the processing.
 */
export function inlineWorkerEnabled(): boolean {
  const v = process.env.INLINE_WORKER;
  if (v === "off") return false;
  return v === "on" || Boolean(process.env.VERCEL);
}

const BUDGET_MS = 45_000; // inside the 60 s function limit; unstarted keywords are picked up by the next run

let running = false; // one inline pass per instance at a time; claimJob also prevents double processing

/** Claims and processes queued jobs until none are ready or the time budget is used. */
export async function runJobsInline(budgetMs = BUDGET_MS): Promise<{ processed: number }> {
  if (running) return { processed: 0 };
  running = true;
  try { return await runLoop(budgetMs); } finally { running = false; }
}

async function runLoop(budgetMs: number): Promise<{ processed: number }> {
  const deadlineAt = Date.now() + budgetMs;
  let processed = 0;
  while (Date.now() < deadlineAt) {
    const r = await runWorkerPass(sql, { deadlineAt, requestTimeoutMs: Math.min(30_000, Math.max(5_000, deadlineAt - Date.now())) });
    processed += r.processed;
    if (r.processed === 0) break;
  }
  return { processed };
}

/** Runs queued jobs after the current response is sent. Safe to call anywhere: a no-op outside a request. */
export function scheduleInlineRun(): void {
  if (!inlineWorkerEnabled()) return;
  void import("next/server").then(({ after }) => {
    try {
      after(async () => {
        try { await runJobsInline(); } catch (e) { console.error("[inline worker] failed", e); }
      });
    } catch {
      // Not inside a request (e.g. the scheduler): the cron endpoint or worker will pick the job up.
    }
  }).catch(() => {});
}
