import { NextResponse } from "next/server";
import { authMode } from "@/server/auth";
import { isCloudflareWorkers, sql } from "@/server/db";
import { classifyDbError, ensureSchema } from "@/server/schema";
import { MIGRATIONS } from "@/server/migrations.generated";
import { defaultSerpProvider } from "@/server/providers/registry";

export const dynamic = "force-dynamic";

/** Deployment self-check. Reports only configuration status, never secrets or connection strings. */
export async function GET() {
  let database: { ok: boolean; problem?: string; migrationsApplied?: number; migrationsBundled: number } = { ok: false, migrationsBundled: MIGRATIONS.length };
  try {
    await ensureSchema(sql);
    const [r] = await sql<{ n: number }[]>`select count(*)::int as n from schema_migrations`;
    database = { ok: true, migrationsApplied: r?.n ?? 0, migrationsBundled: MIGRATIONS.length };
  } catch (e) {
    console.error("[health] database check failed", e);
    database = { ok: false, problem: classifyDbError(e).detail, migrationsBundled: MIGRATIONS.length };
  }
  return NextResponse.json({
    status: database.ok ? "ok" : "degraded",
    runtime: isCloudflareWorkers ? "cloudflare-workers" : "node",
    auth: authMode(),
    database,
    serpProviderConfigured: Boolean(defaultSerpProvider()),
  }, { status: database.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
