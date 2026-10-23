import { hostname } from "node:os";
import type { Sql } from "../db";
import { refreshProviderCredentials } from "../providers/credentials";
import { listSerpProviders } from "../providers/registry";
import { claimJob, finalizeJob, reapStaleJobs, type JobStatus } from "./queue";
import { processSerpJob } from "./organic";
import { runSchedulerTick } from "./scheduler";

export const workerId = `${hostname()}:${process.pid}`;
const STALE_AFTER_MS = 10 * 60_000;

/**
 * One worker pass: recover stale jobs, then claim and process jobs for each configured provider
 * up to its concurrency limit. Returns the number of jobs processed.
 */
export async function runWorkerPass(sql: Sql, opts: { requestTimeoutMs?: number; deadlineAt?: number } = {}): Promise<{ processed: number; statuses: JobStatus[] }> {
  await refreshProviderCredentials(sql);
  await reapStaleJobs(sql, STALE_AFTER_MS);
  const statuses: JobStatus[] = [];
  const running: Promise<void>[] = [];
  for (const provider of listSerpProviders().filter((p) => p.isConfigured())) {
    const { maxConcurrency } = provider.limits();
    for (let i = 0; i < maxConcurrency; i++) {
      const job = await claimJob(sql, provider.id, maxConcurrency, workerId);
      if (!job) break;
      running.push((async () => {
        try {
          statuses.push(await processSerpJob(sql, job, { workerId, requestTimeoutMs: opts.requestTimeoutMs, deadlineAt: opts.deadlineAt }));
        } catch (e) {
          // Bookkeeping failure: settle the job so it is not left running forever.
          console.error(`job ${job.id} crashed`, e);
          statuses.push(await finalizeJob(sql, job, { retryAfterMs: 0, now: new Date(), fatalError: { code: "worker_error", message: e instanceof Error ? e.message : String(e) } }));
        }
      })());
    }
  }
  await Promise.all(running);
  return { processed: statuses.length, statuses };
}

export async function runWorkerLoop(sql: Sql, opts: { pollMs: number; schedulerMs: number; signal: AbortSignal }) {
  let lastSchedule = 0;
  console.log(`[worker ${workerId}] started`);
  while (!opts.signal.aborted) {
    try {
      if (Date.now() - lastSchedule >= opts.schedulerMs) {
        const r = await runSchedulerTick(sql);
        if (r.enqueued || r.skipped) console.log(`[scheduler] enqueued=${r.enqueued} skipped=${r.skipped}`);
        lastSchedule = Date.now();
      }
      const { processed } = await runWorkerPass(sql);
      if (processed) console.log(`[worker] processed ${processed} job(s)`);
      if (processed) continue;
    } catch (e) {
      console.error("[worker] pass failed", e);
    }
    await new Promise((r) => setTimeout(r, opts.pollMs));
  }
  console.log(`[worker ${workerId}] stopped`);
}
