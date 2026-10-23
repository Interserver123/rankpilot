import { useAlternatePooler, type Sql } from "./db";
import { MIGRATIONS } from "./migrations.generated";

let ensured = false;

/**
 * Applies any bundled migrations that the database has not recorded yet. Serialized with an
 * advisory lock so concurrent cold starts cannot apply the same migration twice.
 */
export async function ensureSchema(sql: Sql): Promise<{ applied: string[] }> {
  if (ensured) return { applied: [] };
  try {
    return await applyPending(sql);
  } catch (e) {
    // Wrong Supabase pooler cluster (aws-0 vs aws-1): retry once on the other one.
    const err = e as { code?: string; message?: string };
    const connectionClass = /Tenant or user not found|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|CONNECT_TIMEOUT|CONNECTION_|socket|tls|ssl|closed|timed? ?out|network/i;
    if ((connectionClass.test(`${err.code ?? ""} ${err.message ?? ""}`)) && (await useAlternatePooler())) {
      console.warn("[db] retrying on the alternate Supabase pooler cluster");
      return applyPending(sql);
    }
    throw e;
  }
}

async function applyPending(sql: Sql): Promise<{ applied: string[] }> {
  const applied: string[] = [];
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('rankpilot-migrations'))`;
    await tx`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const done = new Set((await tx<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
    for (const m of MIGRATIONS) {
      if (done.has(m.name)) continue;
      await tx.unsafe(m.sql);
      await tx`insert into schema_migrations (name) values (${m.name})`;
      applied.push(m.name);
    }
  });
  ensured = true;
  return { applied };
}

export type SetupProblem = { kind: "no_database_url" | "cannot_connect" | "schema" | "unknown"; detail: string };

/** Classifies a database failure into a safe, actionable message (never includes credentials). */
export function classifyDbError(e: unknown): SetupProblem {
  const err = e as { name?: string; code?: string; message?: string };
  if (err?.name === "DatabaseConfigError") return { kind: "no_database_url", detail: "DATABASE_URL is not set for this deployment." };
  const code = err?.code ?? "";
  if (/Tenant or user not found/i.test(err?.message ?? "")) {
    return { kind: "cannot_connect", detail: "Supabase rejected the database user. Copy the connection string again from Supabase (user looks like postgres.<project-ref>)." };
  }
  if (code === "ENETUNREACH" || code === "EHOSTUNREACH") {
    return { kind: "cannot_connect", detail: `The database host is unreachable (${code}). With Supabase, use the pooler connection string (…pooler.supabase.com), not the direct db.<ref>.supabase.co host.` };
  }
  if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "CONNECT_TIMEOUT", "28P01", "28000", "3D000", "ECONNRESET"].includes(code)) {
    const why = code === "28P01" || code === "28000" ? "the username or password was rejected"
      : code === "3D000" ? "the database name does not exist"
      : code === "ENOTFOUND" ? "the host name could not be resolved"
      : "the server could not be reached";
    return { kind: "cannot_connect", detail: `Could not connect to the database: ${why} (${code}).` };
  }
  if (/^42/.test(code)) return { kind: "schema", detail: `The database schema is incomplete (${code}). Run the migrations.` };
  return { kind: "unknown", detail: `Database error${code ? ` ${code}` : ""}: ${safeMessage(err?.message)}` };
}

/** Error text with anything credential-like removed, shortened for display. */
export function safeMessage(message: string | undefined): string {
  const m = (message ?? "no details").replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]").replace(/\b[0-9a-f]{24,}\b/gi, "[secret]").replace(/\s+/g, " ").trim();
  return m.slice(0, 200) || "no details";
}
