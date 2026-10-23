import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Sql } from "../db";

/**
 * Provider credentials: a value saved by an admin in the dashboard (encrypted in the database)
 * wins over the server environment variable. Provider adapters read them synchronously from a
 * small per-process cache that web requests, cron and the worker refresh from the database.
 */
export interface ProviderField {
  key: string;
  label: string;
  /** Secret fields are encrypted, write-only, and only their last 4 characters are ever shown. */
  secret: boolean;
  env: string;
  placeholder?: string;
  help?: string;
}

export interface ProviderSpec { id: string; name: string; fields: ProviderField[]; website: string; dashboardHint: string }

export const PROVIDER_SPECS: ProviderSpec[] = [
  {
    id: "yepapi",
    name: "YepAPI",
    website: "https://yepapi.com",
    dashboardHint: "yepapi.com/dashboard/api-keys",
    fields: [
      { key: "apiKey", label: "API key", secret: true, env: "YEPAPI_API_KEY", placeholder: "yep_sk_…" },
      { key: "pricePerPage", label: "Price per 10 results (USD)", secret: false, env: "YEPAPI_PRICE_PER_PAGE", placeholder: "0.01", help: "Google SERP is billed per page of 10 results. Default 0.01." },
      { key: "baselineDepth", label: "Search depth for a keyword's first check (results)", secret: false, env: "YEPAPI_BASELINE_DEPTH", placeholder: "30", help: "First check of each keyword: 30 = 3 pages ($0.03). Set 100 for a full first check ($0.10)." },
      { key: "probeDepth", label: "Search depth for keywords not ranking (results)", secret: false, env: "YEPAPI_PROBE_DEPTH", placeholder: "30", help: "Keywords not found last time are checked this deep (30 = 3 pages) instead of 100. Set 100 to always check fully." },
      { key: "fullCheckDays", label: "Full-depth re-check every (days)", secret: false, env: "YEPAPI_FULL_CHECK_DAYS", placeholder: "28", help: "Keywords not ranking get a full-depth check at least this often." },
    ],
  },
  {
    id: "dataforseo",
    name: "DataForSEO",
    website: "https://dataforseo.com",
    dashboardHint: "app.dataforseo.com → API Access",
    fields: [
      { key: "login", label: "API login", secret: true, env: "DATAFORSEO_LOGIN" },
      { key: "password", label: "API password", secret: true, env: "DATAFORSEO_PASSWORD", help: "The API password, not your website password." },
      { key: "costPerRequest", label: "Price per request (USD)", secret: false, env: "DATAFORSEO_COST_PER_REQUEST", placeholder: "from your plan", help: "Leave blank if unknown; estimates then show as unknown." },
    ],
  },
];

export function providerSpec(id: string): ProviderSpec | undefined {
  return PROVIDER_SPECS.find((p) => p.id === id);
}

// ---------- encryption ----------

function rawKey(): string | null {
  const k = process.env.APP_ENCRYPTION_KEY || process.env.AUTH_SECRET;
  return k && k.length >= 16 ? k : null;
}

export function encryptionConfigured(): boolean { return rawKey() !== null; }

function key(): Buffer {
  const k = rawKey();
  if (!k) throw new Error("APP_ENCRYPTION_KEY is not set");
  return createHash("sha256").update(`rankpilot:provider-credentials:${k}`).digest();
}

export function encryptSecrets(values: Record<string, string>): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(values), "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function decryptSecrets(blob: string): Record<string, string> {
  const [v, iv, tag, body] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("Unknown credential format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8")) as Record<string, string>;
}

// ---------- cache ----------

interface Entry { secrets: Record<string, string>; settings: Record<string, string>; hints: Record<string, string>; unreadable: boolean; updatedAt: string }
let cache = new Map<string, Entry>();
let loadedAt = 0;
const TTL_MS = 10_000;

/** Loads saved credentials into the process cache. Never throws: env variables remain the fallback. */
export async function refreshProviderCredentials(sql: Sql, force = false): Promise<void> {
  if (!force && Date.now() - loadedAt < TTL_MS) return;
  try {
    const rows = await sql<{ provider_id: string; secrets_enc: string | null; hints_json: Record<string, string>; settings_json: Record<string, string>; updated_at: Date }[]>`
      select provider_id, secrets_enc, hints_json, settings_json, updated_at from provider_credentials`;
    const next = new Map<string, Entry>();
    for (const r of rows) {
      let secrets: Record<string, string> = {};
      let unreadable = false;
      if (r.secrets_enc) {
        try { secrets = decryptSecrets(r.secrets_enc); } catch { unreadable = true; }
      }
      next.set(r.provider_id, { secrets, settings: r.settings_json ?? {}, hints: r.hints_json ?? {}, unreadable, updatedAt: r.updated_at.toISOString() });
    }
    cache = next;
    loadedAt = Date.now();
  } catch (e) {
    // Table not created yet or database briefly unavailable.
    if (cache.size === 0) loadedAt = Date.now() - TTL_MS + 2_000;
    console.error("[providers] could not load saved credentials", e instanceof Error ? e.message : e);
  }
}

export function clearCredentialCache() { cache = new Map(); loadedAt = 0; }

function envValue(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/** Saved value first, then the environment variable. */
export function providerValue(providerId: string, fieldKey: string): string | undefined {
  const spec = providerSpec(providerId)?.fields.find((f) => f.key === fieldKey);
  const e = cache.get(providerId);
  const saved = spec?.secret ? e?.secrets[fieldKey] : e?.settings[fieldKey];
  if (saved && saved.trim()) return saved.trim();
  return spec ? envValue(spec.env) : undefined;
}

export type CredentialSource = "dashboard" | "environment" | "none";

export interface ProviderCredentialStatus {
  source: CredentialSource;
  unreadable: boolean;
  updatedAt: string | null;
  fields: { key: string; secret: boolean; hasValue: boolean; hint: string | null; value: string | null; source: CredentialSource }[];
}

/** Credential-free status for the UI: secrets expose only whether set and their last 4 characters. */
export function credentialStatus(providerId: string): ProviderCredentialStatus {
  const spec = providerSpec(providerId);
  const e = cache.get(providerId);
  const fields = (spec?.fields ?? []).map((f) => {
    const saved = f.secret ? e?.secrets[f.key] : e?.settings[f.key];
    const fromEnv = envValue(f.env);
    const source: CredentialSource = saved ? "dashboard" : fromEnv ? "environment" : "none";
    return {
      key: f.key,
      secret: f.secret,
      hasValue: source !== "none",
      hint: f.secret ? (saved ? e?.hints[f.key] ?? null : fromEnv ? fromEnv.slice(-4) : null) : null,
      value: f.secret ? null : (saved ?? fromEnv ?? null),
      source,
    };
  });
  const secretFields = fields.filter((f) => f.secret && f.hasValue);
  const source: CredentialSource = secretFields.some((f) => f.source === "dashboard") ? "dashboard" : secretFields.length ? "environment" : "none";
  return { source, unreadable: e?.unreadable ?? false, updatedAt: e?.updatedAt ?? null, fields };
}

// ---------- save / remove ----------

const last4 = (v: string) => (v.length > 4 ? v.slice(-4) : "••••");

/**
 * Saves submitted fields. Blank secret fields keep the existing value; blank settings are cleared.
 * Requires an encryption key so a secret is never stored in plaintext.
 */
export async function saveProviderCredentials(sql: Sql, providerId: string, userId: string, submitted: Record<string, string>): Promise<void> {
  const spec = providerSpec(providerId);
  if (!spec) throw new Error("Unknown provider");
  if (!encryptionConfigured()) throw new Error("Set APP_ENCRYPTION_KEY on the server before saving keys.");
  const [row] = await sql<{ secrets_enc: string | null; hints_json: Record<string, string>; settings_json: Record<string, string> }[]>`
    select secrets_enc, hints_json, settings_json from provider_credentials where provider_id = ${providerId}`;
  let secrets: Record<string, string> = {};
  if (row?.secrets_enc) {
    try { secrets = decryptSecrets(row.secrets_enc); } catch { secrets = {}; } // unreadable old data is replaced
  }
  const hints = { ...(row?.hints_json ?? {}) };
  const settings = { ...(row?.settings_json ?? {}) };
  for (const f of spec.fields) {
    const raw = (submitted[f.key] ?? "").trim();
    if (f.secret) {
      if (!raw) continue;
      if (raw.length > 512 || /[\r\n]/.test(raw)) throw new Error(`${f.label} is not valid`);
      secrets[f.key] = raw;
      hints[f.key] = last4(raw);
    } else if (!raw) {
      delete settings[f.key];
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 1000) throw new Error(`${f.label} must be a number`);
      settings[f.key] = String(n);
    }
  }
  const enc = Object.keys(secrets).length ? encryptSecrets(secrets) : null;
  await sql`
    insert into provider_credentials (provider_id, secrets_enc, hints_json, settings_json, updated_by, updated_at)
    values (${providerId}, ${enc}, ${sql.json(hints as never)}, ${sql.json(settings as never)}, ${userId}, now())
    on conflict (provider_id) do update set secrets_enc = excluded.secrets_enc, hints_json = excluded.hints_json,
      settings_json = excluded.settings_json, updated_by = excluded.updated_by, updated_at = now()`;
  await refreshProviderCredentials(sql, true);
}

export async function removeProviderCredentials(sql: Sql, providerId: string): Promise<boolean> {
  const rows = await sql`delete from provider_credentials where provider_id = ${providerId} returning provider_id`;
  await refreshProviderCredentials(sql, true);
  return rows.length > 0;
}
