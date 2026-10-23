import { parseRetryAfter } from "@/lib/retry";
import { ProviderError, type SerpProvider, type SerpRequest, type SerpResult, type ProviderCapabilities } from "../types";
import { providerValue } from "../credentials";
import { findDomainPosition, type OrganicItem } from "./serp-parse";

/**
 * YepAPI Google SERP — POST https://api.yepapi.com/v1/serp/google (docs: https://docs.yepapi.com/llms.txt).
 * Auth: `x-api-key`. Billing: $0.01 per page of 10 results, failed requests are never charged.
 *
 * Targeting: country via `location` (country code); a city sends `location_name` as
 * "City,Region,Country". The API rejects unsupported options with a validation error rather than
 * ignoring them, so a rejected city name fails loudly instead of returning wrong-location ranks.
 */
const ENDPOINT = "https://api.yepapi.com/v1/serp/google";
export const YEPAPI_BALANCE_ENDPOINT = "https://api.yepapi.com/v1/account/balance";
const PAGE_SIZE = 10;
const DEFAULT_PRICE_PER_PAGE = 0.01;

const COUNTRY_NAMES: Record<string, string> = {
  US: "United States", GB: "United Kingdom", CA: "Canada", AU: "Australia", IN: "India",
  IE: "Ireland", NZ: "New Zealand", DE: "Germany", FR: "France", ES: "Spain", IT: "Italy",
  NL: "Netherlands", BD: "Bangladesh", AE: "United Arab Emirates", SG: "Singapore", ZA: "South Africa",
};

export function buildYepApiBody(req: SerpRequest): { body: Record<string, unknown>; requestedLocation: string } {
  const body: Record<string, unknown> = {
    query: req.keyword,
    depth: req.depth,
    device: req.device,
    language: req.language,
  };
  const cc = req.location.countryCode.toUpperCase();
  const country = COUNTRY_NAMES[cc];
  let requestedLocation: string;
  if (req.location.city && country) {
    const name = [req.location.city, req.location.region, country].filter(Boolean).join(",");
    body.location_name = name;
    requestedLocation = `city: ${name}`;
  } else {
    body.location = cc.toLowerCase();
    requestedLocation = `country: ${cc}`;
  }
  return { body, requestedLocation };
}

interface YepItem { position?: number; rank?: number; rankAbsolute?: number; rankGroup?: number; title?: string; url?: string; link?: string; domain?: string }

/** Field names are camelCase per the docs; a few aliases are tolerated so a naming difference never reads as "not ranking". */
export function normalizeYepItems(items: YepItem[] | undefined): OrganicItem[] {
  const out: OrganicItem[] = [];
  for (const i of items ?? []) {
    const position = i.position ?? i.rankGroup ?? i.rankAbsolute ?? i.rank;
    const url = i.url ?? i.link ?? (i.domain ? `https://${i.domain}/` : undefined);
    if (typeof position === "number" && typeof url === "string") out.push({ position, url, title: i.title ?? null });
  }
  return out;
}

/** Maps YepAPI error codes to retry policy. Branches on error.code, never on HTTP status alone. */
export function classifyYepApiError(code: string | undefined, message: string | undefined, retryAfterMs: number | null = null): ProviderError {
  const msg = message ?? "Unknown provider error";
  switch (code) {
    case "INVALID_API_KEY":
    case "REVOKED_API_KEY": return new ProviderError("auth", `yep_${code}`, msg);
    case "NO_CREDITS": return new ProviderError("insufficient_funds", "yep_NO_CREDITS", msg);
    case "VALIDATION_ERROR":
    case "NOT_FOUND": return new ProviderError("invalid_request", `yep_${code}`, msg);
    case "RATE_LIMITED_UPSTREAM": return new ProviderError("rate_limited", "yep_RATE_LIMITED", msg, retryAfterMs ?? 60_000);
    // Failed requests are never charged, so these are safe to retry.
    default: return new ProviderError("transient", `yep_${code ?? "unknown"}`, msg);
  }
}

export function parseYepApiResponse(body: unknown, req: SerpRequest, requestedLocation: string): SerpResult {
  const b = body as { ok?: boolean; data?: { items?: YepItem[]; totalResults?: number }; error?: { code?: string; message?: string } } | null;
  if (!b || typeof b !== "object") throw new ProviderError("uncertain", "yep_bad_json", "Provider returned an unreadable response");
  if (b.ok !== true) throw classifyYepApiError(b.error?.code, b.error?.message);
  const organic = normalizeYepItems(b.data?.items);
  // A successful response with no usable results is not evidence the site is absent: never record it as "not found".
  if (organic.length === 0) throw new ProviderError("uncertain", "yep_empty_results", "YepAPI returned no usable results for this search; check the location and keyword with Test a search");
  const match = findDomainPosition(organic, req.targetDomain);
  return {
    position: match?.position ?? null,
    rankingUrl: match?.url ?? null,
    rankingTitle: match?.title ?? null,
    serpFeatures: [],
    competitors: req.competitorDomains.map((c) => {
      const m = findDomainPosition(organic, c.domain);
      return { id: c.id, position: m?.position ?? null, url: m?.url ?? null };
    }),
    requestedLocation,
    depth: req.depth,
    providerRequestId: null,
    unitsConsumed: Math.ceil(req.depth / PAGE_SIZE),
    actualCost: null,
    metadata: { organic_results: organic.length, total_results: b.data?.totalResults ?? null, top_domains: organic.slice(0, 5).map((o) => { try { return new URL(o.url).hostname; } catch { return o.url; } }) },
    organic,
  };
}

export class YepApiProvider implements SerpProvider {
  readonly id = "yepapi";
  readonly displayName = "YepAPI";

  isConfigured() { return Boolean(providerValue("yepapi", "apiKey")); }

  capabilities(): ProviderCapabilities {
    return {
      devices: ["desktop", "mobile"],
      locationTargeting: ["country", "city"],
      maxDepth: 100,
      serpFeatures: false,
      competitorPositions: true,
      limitations: [
        "Country and city targeting only (no coordinates or postal codes yet).",
        "City names are sent as “City,Region,Country”; confirm results against a manual check before relying on them.",
        "SERP features are not collected.",
      ],
    };
  }

  validate(req: SerpRequest): string[] {
    const errs: string[] = [];
    if (!req.keyword.trim()) errs.push("Keyword is empty");
    if (req.depth < 1 || req.depth > this.capabilities().maxDepth) errs.push("Unsupported result depth");
    const cc = req.location.countryCode.toUpperCase();
    if (req.location.city && !COUNTRY_NAMES[cc]) errs.push(`City targeting for country ${cc} is not mapped for YepAPI`);
    if (!req.location.city && req.location.latitude != null && req.location.longitude != null && !/^[A-Z]{2}$/.test(cc)) errs.push("Location needs a 2-letter country code");
    return errs;
  }

  // Billed per page of 10 results.
  unitsPerRequest(depth: number) { return Math.ceil(depth / PAGE_SIZE); }

  pricePerUnit() {
    const v = providerValue("yepapi", "pricePerPage");
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_PRICE_PER_PAGE;
  }

  currency() { return "USD"; }

  // Not published by YepAPI: conservative defaults, adjustable via env.
  limits() {
    return {
      maxConcurrency: Number(process.env.YEPAPI_MAX_CONCURRENCY ?? 3),
      requestsPerMinute: Number(process.env.YEPAPI_REQUESTS_PER_MINUTE ?? 60),
    };
  }

  async fetchRanking(req: SerpRequest, signal: AbortSignal): Promise<SerpResult> {
    const key = providerValue("yepapi", "apiKey");
    if (!key) throw new ProviderError("auth", "not_configured", "YepAPI key is not configured");
    const { body, requestedLocation } = buildYepApiBody(req);
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "x-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (signal.aborted) throw new ProviderError("uncertain", "timeout", "Provider request timed out; it may have been billed");
      throw new ProviderError("transient", "network", e instanceof Error ? e.message : "Network error");
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      if (res.status >= 500) throw new ProviderError("transient", `http_${res.status}`, `Provider server error ${res.status}`);
      throw new ProviderError("uncertain", "yep_bad_json", "Provider returned an unreadable response");
    }
    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
      throw classifyYepApiError(err?.code, err?.message ?? `HTTP ${res.status}`, parseRetryAfter(res.headers.get("retry-after")));
    }
    return parseYepApiResponse(json, req, requestedLocation);
  }
}
