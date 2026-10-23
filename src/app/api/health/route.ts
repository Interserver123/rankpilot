import { NextResponse, type NextRequest } from "next/server";
import { authMode } from "@/server/auth";
import { alternatePoolerUrl, databaseUrl, isCloudflareWorkers, sql } from "@/server/db";
import { probePostgres } from "@/server/db-probe";
import { classifyDbError, ensureSchema } from "@/server/schema";
import { MIGRATIONS } from "@/server/migrations.generated";
import { defaultSerpProvider } from "@/server/providers/registry";

export const dynamic = "force-dynamic";

/** Deployment self-check. Reports only configuration status, never secrets or connection strings. */
export async function GET(req: NextRequest) {
  // /api/health?probe=1 — step-by-step connection test (Workers only; spends a few outbound connections).
  let probe: Awaited<ReturnType<typeof probePostgres>>[] | undefined;
  const url = databaseUrl();
  if (req.nextUrl.searchParams.get("probe") === "1" && isCloudflareWorkers && url) {
    const alt = alternatePoolerUrl(url);
    probe = [await probePostgres(url), ...(alt ? [await probePostgres(alt)] : [])];
  }
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
    ...(probe ? { probe } : {}),
  }, { status: database.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
