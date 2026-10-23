import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/server/db";
import { runSchedulerTick } from "@/server/jobs/scheduler";
import { inlineWorkerEnabled, runJobsInline } from "@/server/jobs/inline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Enqueues due scheduled jobs (fast; never calls providers). For platforms with HTTP cron
 * (e.g. Vercel Cron, GitHub Actions) as an alternative to the worker's built-in scheduler loop.
 * Also processes queued jobs when no dedicated worker is used (INLINE_WORKER).
 * Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runSchedulerTick(sql);
  // Hosts without a background worker (Vercel) collect rankings here, within the function time limit.
  const worked = inlineWorkerEnabled() ? await runJobsInline() : null;
  return NextResponse.json({ ...result, ...(worked ? { processed: worked.processed } : {}) });
}
