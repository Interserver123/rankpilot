import postgres from "postgres";
import { cache } from "react";

declare global {
  // Reused across hot reloads in development.
  var __rankpilotSql: postgres.Sql | undefined;
}

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;
/** Either the pool or a transaction: repository functions accept both. */
export type Db = Sql | Tx;

/**
 * Cloudflare Workers forbid reusing a socket opened by one request in another request
 * ("Cannot perform I/O on behalf of a different request"), so a process-wide pool crashes
 * there. On Workers we open one small client per request instead (use Hyperdrive in front
 * of Postgres to keep that cheap). Node (dev server, `next start`, the job worker) keeps a pool.
 */
export const isCloudflareWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

export class DatabaseConfigError extends Error { override name = "DatabaseConfigError"; }

function create(perRequest = false): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new DatabaseConfigError("DATABASE_URL is not set");
  return postgres(url, {
    max: perRequest ? 1 : Number(process.env.DATABASE_POOL_SIZE ?? 10),
    idle_timeout: perRequest ? 5 : 30,
    connect_timeout: 10,
    onnotice: () => {},
    // Supabase's transaction pooler (port 6543) does not support prepared statements.
    prepare: !url.includes(":6543"),
    transform: { undefined: null },
    types: {
      // Return numeric as JS numbers (costs/usage are well within double precision).
      numeric: { to: 1700, from: [1700], serialize: (v: number) => String(v), parse: (v: string) => Number(v) },
    },
  });
}

/** One client per request on Workers (React `cache` is scoped to the current request). */
const requestSql = cache(() => create(true));

export function getSql(): postgres.Sql {
  if (isCloudflareWorkers) return requestSql();
  if (!globalThis.__rankpilotSql) globalThis.__rankpilotSql = create();
  return globalThis.__rankpilotSql;
}

/** Lazy proxy so importing this module never opens a connection by itself. */
export const sql: postgres.Sql = new Proxy(function () {} as unknown as postgres.Sql, {
  apply: (_t, _this, args) => (getSql() as unknown as (...a: unknown[]) => unknown)(...args),
  get: (_t, prop) => {
    const s = getSql() as unknown as Record<string | symbol, unknown>;
    const v = s[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(s) : v;
  },
});

export async function closeSql() {
  if (globalThis.__rankpilotSql) {
    await globalThis.__rankpilotSql.end({ timeout: 5 });
    globalThis.__rankpilotSql = undefined;
  }
}

/** A composable SQL fragment, e.g. a reusable WHERE clause. */
export type Fragment = postgres.PendingQuery<postgres.Row[]>;
