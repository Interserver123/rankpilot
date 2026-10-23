import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/server/db";
import { runSchedulerTick } from "@/server/jobs/scheduler";

export const dynamic = "force-dynamic";

/**
 * Enqueues due scheduled jobs (fast; never calls providers). For platforms with HTTP cron
 * (e.g. Vercel Cron) as an alternative to the worker's built-in scheduler loop.
 * Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runSchedulerTick(sql);
  return NextResponse.json(result);
}
