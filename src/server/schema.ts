import type { Sql } from "./db";
import { MIGRATIONS } from "./migrations.generated";

let ensured = false;

/**
 * Applies any bundled migrations that the database has not recorded yet. Serialized with an
 * advisory lock so concurrent cold starts cannot apply the same migration twice.
 */
export async function ensureSchema(sql: Sql): Promise<{ applied: string[] }> {
  if (ensured) return { applied: [] };
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
  return { kind: "unknown", detail: `Database error${code ? ` ${code}` : ""}.` };
}
