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

/**
 * Connection options derived from the URL. Supabase requires TLS; its transaction pooler
 * (port 6543) does not support prepared statements.
 */
export function connectionOptions(url: string): { ssl: "require" | false; prepare: boolean } {
  let host = "", port = "", sslmode: string | null = null;
  try {
    const u = new URL(url);
    host = u.hostname; port = u.port; sslmode = u.searchParams.get("sslmode");
  } catch {
    throw new DatabaseConfigError("DATABASE_URL is not a valid connection string");
  }
  const supabase = /\.supabase\.(co|com)$/.test(host);
  return {
    ssl: sslmode === "disable" ? false : supabase || (sslmode !== null && sslmode !== "prefer" && sslmode !== "allow") ? "require" : false,
    prepare: port !== "6543",
  };
}

/** Set when the alternate Supabase pooler cluster turned out to be the right one. */
let urlOverride: string | null = null;

export function databaseUrl(): string | null {
  return urlOverride ?? (process.env.DATABASE_URL?.trim() || null);
}

/** Supabase pooler hosts live on aws-0-… or aws-1-… clusters; returns the other one. */
export function alternatePoolerUrl(url: string): string | null {
  if (/aws-0-[a-z0-9-]+\.pooler\.supabase\.com/.test(url)) return url.replace("aws-0-", "aws-1-");
  if (/aws-1-[a-z0-9-]+\.pooler\.supabase\.com/.test(url)) return url.replace("aws-1-", "aws-0-");
  return null;
}

/** Switch to the alternate pooler cluster for the rest of this process. */
export async function useAlternatePooler(): Promise<boolean> {
  const current = databaseUrl();
  const alt = current ? alternatePoolerUrl(current) : null;
  if (!alt || urlOverride === alt) return false;
  urlOverride = alt;
  if (globalThis.__rankpilotSql) { await globalThis.__rankpilotSql.end({ timeout: 1 }).catch(() => {}); globalThis.__rankpilotSql = undefined; }
  return true;
}

function create(perRequestClient = false): postgres.Sql {
  const url = databaseUrl();
  if (!url) throw new DatabaseConfigError("DATABASE_URL is not set");
  const opts = connectionOptions(url);
  return postgres(url, {
    ssl: opts.ssl,
    // Serverless hosts (Vercel) run many instances at once: keep each one small.
    max: perRequestClient ? 3 : Number(process.env.DATABASE_POOL_SIZE ?? (process.env.VERCEL ? 3 : 10)),
    idle_timeout: perRequestClient ? 5 : 30,
    connect_timeout: 10,
    onnotice: () => {},
    prepare: opts.prepare,
    transform: { undefined: null },
    types: {
      // Return numeric as JS numbers (costs/usage are well within double precision).
      numeric: { to: 1700, from: [1700], serialize: (v: number) => String(v), parse: (v: string) => Number(v) },
    },
  });
}

/**
 * One client per request on Workers. Cloudflare's free plan allows ~50 outbound connections per
 * request, so every query in a request must share a small client instead of dialing anew.
 * OpenNext exposes the current request's ExecutionContext (unique per request) on a global symbol;
 * React `cache` is the fallback where that is unavailable (it is only request-scoped during rendering).
 */
const perRequest = new WeakMap<object, postgres.Sql>();
const reactScoped = cache((_url: string | null) => create(true));

function requestClient(): postgres.Sql {
  const cf = (globalThis as Record<symbol, { ctx?: object } | undefined>)[Symbol.for("__cloudflare-context__")];
  const key = cf?.ctx;
  if (!key) return reactScoped(databaseUrl());
  let client = perRequest.get(key);
  if (!client) { client = create(true); perRequest.set(key, client); }
  return client;
}

export function getSql(): postgres.Sql {
  if (isCloudflareWorkers) return requestClient();
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
