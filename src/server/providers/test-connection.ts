import { providerValue } from "./credentials";
import { YEPAPI_BALANCE_ENDPOINT } from "./serp/yepapi";

export interface ConnectionTest { ok: boolean; message: string }

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
}

/** Free credential checks only: no search is run and nothing is billed. */
export async function testProviderConnection(providerId: string): Promise<ConnectionTest> {
  try {
    if (providerId === "yepapi") {
      const key = providerValue("yepapi", "apiKey");
      if (!key) return { ok: false, message: "No API key saved yet." };
      const res = await timedFetch(YEPAPI_BALANCE_ENDPOINT, { headers: { "x-api-key": key } });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; data?: { balanceUsd?: number | string }; error?: { code?: string; message?: string } } | null;
      if (j?.ok) return { ok: true, message: j.data?.balanceUsd !== undefined ? `Key works. Balance: $${Number(j.data.balanceUsd).toFixed(2)}.` : "Key works." };
      return { ok: false, message: j?.error?.message ?? `YepAPI rejected the request (HTTP ${res.status}).` };
    }
    if (providerId === "dataforseo") {
      const login = providerValue("dataforseo", "login");
      const password = providerValue("dataforseo", "password");
      if (!login || !password) return { ok: false, message: "Login and password are both needed." };
      const res = await timedFetch("https://api.dataforseo.com/v3/appendix/user_data", {
        headers: { Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}` },
      });
      const j = (await res.json().catch(() => null)) as { status_code?: number; status_message?: string; tasks?: { result?: { money?: { balance?: number } }[] }[] } | null;
      if (res.ok && j?.status_code === 20000) {
        const bal = j.tasks?.[0]?.result?.[0]?.money?.balance;
        return { ok: true, message: typeof bal === "number" ? `Login works. Balance: $${bal.toFixed(2)}.` : "Login works." };
      }
      return { ok: false, message: j?.status_message ?? `DataForSEO rejected the login (HTTP ${res.status}).` };
    }
    return { ok: false, message: "This provider has no connection test." };
  } catch (e) {
    return { ok: false, message: e instanceof Error && e.name === "TimeoutError" ? "The provider did not answer in 15 seconds." : "Could not reach the provider." };
  }
}

export interface SearchTestInput { keyword: string; countryCode: string; region: string; city: string; device: "desktop" | "mobile"; domain: string }

export interface SearchTestResult {
  ok: boolean;
  error?: string;
  requestBody?: Record<string, unknown>;
  status?: number;
  responseKeys?: string[];
  itemKeys?: string[];
  itemCount?: number;
  totalResults?: number | null;
  items?: { position: number | null; domain: string; url: string }[];
  matchedPosition?: number | null;
}

/** One real YepAPI search (10 results, about $0.01) that shows exactly what was sent and what came back. */
export async function testYepApiSearch(input: SearchTestInput): Promise<SearchTestResult> {
  const key = providerValue("yepapi", "apiKey");
  if (!key) return { ok: false, error: "Save a YepAPI key first." };
  const { buildYepApiBody, normalizeYepItems } = await import("./serp/yepapi");
  const { findDomainPosition } = await import("./serp/serp-parse");
  const { normalizeDomain } = await import("@/lib/domain");
  const { body } = buildYepApiBody({
    keyword: input.keyword, language: "en", device: input.device, depth: 10, googleDomain: "google.com",
    location: { countryCode: input.countryCode, region: input.region || null, city: input.city || null },
    targetDomain: input.domain, competitorDomains: [],
  });
  try {
    const res = await timedFetch("https://api.yepapi.com/v1/serp/google", { method: "POST", headers: { "x-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await res.json().catch(() => null)) as { ok?: boolean; data?: { items?: Record<string, unknown>[]; totalResults?: number }; error?: { message?: string } } | null;
    if (!j) return { ok: false, requestBody: body, status: res.status, error: "Unreadable response." };
    if (!j.ok) return { ok: false, requestBody: body, status: res.status, responseKeys: Object.keys(j), error: j.error?.message ?? "Request rejected." };
    const raw = j.data?.items ?? [];
    const norm = normalizeYepItems(raw as never);
    const match = input.domain ? findDomainPosition(norm, normalizeDomain(input.domain)) : null;
    return {
      ok: true, requestBody: body, status: res.status, responseKeys: Object.keys(j.data ?? {}), itemKeys: Object.keys(raw[0] ?? {}),
      itemCount: raw.length, totalResults: j.data?.totalResults ?? null,
      items: raw.slice(0, 10).map((i) => ({ position: typeof i.position === "number" ? i.position : null, domain: String(i.domain ?? "").slice(0, 80), url: String(i.url ?? i.link ?? "").slice(0, 120) })),
      matchedPosition: match?.position ?? null,
    };
  } catch (e) {
    return { ok: false, requestBody: body, error: e instanceof Error && e.name === "TimeoutError" ? "No answer in 15 seconds." : "Could not reach YepAPI." };
  }
}
