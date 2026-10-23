import { parseRetryAfter } from "@/lib/retry";
import { ProviderError, type SerpProvider, type SerpRequest, type SerpResult, type ProviderCapabilities } from "../types";
import { providerValue } from "../credentials";
import { findDomainPosition, type OrganicItem } from "./serp-parse";

/**
 * DataForSEO SERP API — Google Organic "Live Advanced" endpoint.
 * Docs: https://docs.dataforseo.com/v3/serp/google/organic/live/advanced/
 *
 * Targeting: coordinates (location_coordinate "lat,lng,zoom") when the location has them,
 * otherwise location_name built from city/region/country. City-level targeting is a provider
 * region, not an exact physical search point; `requestedLocation` records which was used.
 */
const ENDPOINT = "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";

const COUNTRY_NAMES: Record<string, string> = {
  US: "United States", GB: "United Kingdom", CA: "Canada", AU: "Australia", IN: "India",
  IE: "Ireland", NZ: "New Zealand", DE: "Germany", FR: "France", ES: "Spain", IT: "Italy",
  NL: "Netherlands", BD: "Bangladesh", AE: "United Arab Emirates", SG: "Singapore", ZA: "South Africa",
};

export function buildDataForSeoTask(req: SerpRequest): { task: Record<string, unknown>; requestedLocation: string } {
  const task: Record<string, unknown> = {
    keyword: req.keyword,
    language_code: req.language,
    device: req.device,
    depth: req.depth,
    se_domain: req.googleDomain,
  };
  const loc = req.location;
  let requestedLocation: string;
  if (loc.latitude != null && loc.longitude != null) {
    task.location_coordinate = `${loc.latitude},${loc.longitude}`;
    requestedLocation = `coordinates: ${loc.latitude},${loc.longitude}`;
  } else {
    const country = COUNTRY_NAMES[loc.countryCode.toUpperCase()];
    if (loc.city && country) {
      const name = [loc.city, loc.region, country].filter(Boolean).join(",");
      task.location_name = name;
      requestedLocation = `city: ${name}`;
    } else {
      task.location_name = country ?? loc.countryCode.toUpperCase();
      requestedLocation = `country: ${task.location_name}`;
    }
  }
  return { task, requestedLocation };
}

interface DfsItem { type?: string; rank_group?: number; url?: string; title?: string }

export function parseDataForSeoResponse(body: unknown, req: SerpRequest, requestedLocation: string): SerpResult {
  const b = body as {
    status_code?: number; status_message?: string; cost?: number;
    tasks?: { id?: string; status_code?: number; status_message?: string; cost?: number;
      result?: { item_types?: string[]; items?: DfsItem[]; check_url?: string; datetime?: string }[] | null }[];
  };
  if (b.status_code !== 20000) throw classifyStatus(b.status_code, b.status_message);
  const task = b.tasks?.[0];
  if (!task) throw new ProviderError("uncertain", "dfs_no_task", "Provider returned no task");
  if (task.status_code !== 20000) throw classifyStatus(task.status_code, task.status_message);
  const result = task.result?.[0];
  if (!result) throw new ProviderError("transient", "dfs_empty_result", "Provider returned an empty result");

  const organic: OrganicItem[] = (result.items ?? [])
    .filter((i) => i.type === "organic" && typeof i.rank_group === "number" && typeof i.url === "string")
    .map((i) => ({ position: i.rank_group!, url: i.url!, title: i.title ?? null }));

  const match = findDomainPosition(organic, req.targetDomain);
  return {
    position: match?.position ?? null,
    rankingUrl: match?.url ?? null,
    rankingTitle: match?.title ?? null,
    serpFeatures: (result.item_types ?? []).filter((t) => t !== "organic"),
    competitors: req.competitorDomains.map((c) => {
      const m = findDomainPosition(organic, c.domain);
      return { id: c.id, position: m?.position ?? null, url: m?.url ?? null };
    }),
    requestedLocation,
    depth: req.depth,
    providerRequestId: task.id ?? null,
    unitsConsumed: Math.ceil(req.depth / 10),
    actualCost: typeof task.cost === "number" ? task.cost : null,
    organic,
    metadata: { check_url: result.check_url ?? null, provider_datetime: result.datetime ?? null, organic_results: organic.length },
  };
}

/** DataForSEO status codes: 40100/40101 auth, 40200/40210 balance, 40202 rate limit, 40501+ invalid, 50000 internal. */
export function classifyStatus(code: number | undefined, message: string | undefined): ProviderError {
  const msg = message ?? "Unknown provider error";
  const c = code ?? 0;
  if (c === 40100 || c === 40101 || c === 40104) return new ProviderError("auth", `dfs_${c}`, msg);
  if (c === 40200 || c === 40210) return new ProviderError("insufficient_funds", `dfs_${c}`, msg);
  if (c === 40202 || c === 40209) return new ProviderError("rate_limited", `dfs_${c}`, msg, 60_000);
  if (c >= 40400 && c < 50000) return new ProviderError("invalid_request", `dfs_${c}`, msg);
  return new ProviderError("transient", `dfs_${c || "unknown"}`, msg);
}

export class DataForSeoProvider implements SerpProvider {
  readonly id = "dataforseo";
  readonly displayName = "DataForSEO";

  isConfigured() { return Boolean(providerValue("dataforseo", "login") && providerValue("dataforseo", "password")); }

  capabilities(): ProviderCapabilities {
    return {
      devices: ["desktop", "mobile"],
      locationTargeting: ["country", "region", "city", "coordinates"],
      maxDepth: 200,
      serpFeatures: true,
      competitorPositions: true,
      limitations: [
        "City and country targeting use provider-defined regions, not an exact search point.",
        "Positions are organic rank_group values; ads and SERP features are not counted.",
      ],
    };
  }

  validate(req: SerpRequest): string[] {
    const errs: string[] = [];
    if (!req.keyword.trim()) errs.push("Keyword is empty");
    if (req.depth < 1 || req.depth > this.capabilities().maxDepth) errs.push("Unsupported result depth");
    const hasCoords = req.location.latitude != null && req.location.longitude != null;
    if (!hasCoords && !COUNTRY_NAMES[req.location.countryCode.toUpperCase()]) {
      errs.push(`Country ${req.location.countryCode} is not mapped for DataForSEO; add coordinates or extend COUNTRY_NAMES`);
    }
    return errs;
  }

  // Billed per SERP page of 10 results (dataforseo.com/pricing/google-serp), so depth 100 = 10 units.
  // Actual cost is taken from the provider response when present.
  unitsPerRequest(depth: number) { return Math.ceil(depth / 10); }

  // Live mode list price: $0.002 per 10 results. Override with your contracted price.
  pricePerUnit() {
    const v = providerValue("dataforseo", "costPerRequest");
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0.002;
  }

  currency() { return "USD"; }

  limits() {
    return {
      maxConcurrency: Number(process.env.DATAFORSEO_MAX_CONCURRENCY ?? 5),
      requestsPerMinute: Number(process.env.DATAFORSEO_REQUESTS_PER_MINUTE ?? 60),
    };
  }

  async fetchRanking(req: SerpRequest, signal: AbortSignal): Promise<SerpResult> {
    if (!this.isConfigured()) throw new ProviderError("auth", "not_configured", "DataForSEO credentials are not configured");
    const { task, requestedLocation } = buildDataForSeoTask(req);
    const auth = Buffer.from(`${providerValue("dataforseo", "login")}:${providerValue("dataforseo", "password")}`).toString("base64");
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify([task]),
        signal,
      });
    } catch (e) {
      // A timeout after the request was sent may still be billed: report as uncertain.
      if (signal.aborted) throw new ProviderError("uncertain", "timeout", "Provider request timed out; it may have been billed");
      throw new ProviderError("transient", "network", e instanceof Error ? e.message : "Network error");
    }
    if (res.status === 429) {
      throw new ProviderError("rate_limited", "http_429", "Rate limited by provider", parseRetryAfter(res.headers.get("retry-after")) ?? 60_000);
    }
    if (res.status === 401 || res.status === 403) throw new ProviderError("auth", `http_${res.status}`, "Provider rejected credentials");
    if (res.status >= 500) throw new ProviderError("transient", `http_${res.status}`, `Provider server error ${res.status}`);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ProviderError("uncertain", "bad_json", "Provider returned an unreadable response");
    }
    return parseDataForSeoResponse(body, req, requestedLocation);
  }
}
