import { createHash } from "node:crypto";
import { ProviderError, type SerpProvider, type SerpRequest, type SerpResult } from "../types";

/**
 * Deterministic fake SERP provider for local development and automated tests.
 * Every observation it produces is stored with provider "mock", so it can never be
 * mistaken for collected data. Disabled unless PROVIDER_MOCK_ENABLED=true.
 *
 * Test hooks via keyword text: "fail-auth" → auth error, "fail-transient" → transient
 * error, "fail-invalid" → invalid request, "not-ranking" → verified absence.
 */
export class MockSerpProvider implements SerpProvider {
  readonly id = "mock";
  readonly displayName = "Mock provider (development only)";

  isConfigured() { return process.env.PROVIDER_MOCK_ENABLED === "true" && process.env.NODE_ENV !== "production"; }

  capabilities() {
    return {
      devices: ["desktop", "mobile"] as ("desktop" | "mobile")[],
      locationTargeting: ["country", "region", "city", "postal_code", "coordinates"] as ("country" | "region" | "city" | "postal_code" | "coordinates")[],
      maxDepth: 100,
      serpFeatures: true,
      competitorPositions: true,
      limitations: ["Synthetic data for development. Not real search results."],
    };
  }

  validate(req: SerpRequest) { return req.keyword.trim() ? [] : ["Keyword is empty"]; }
  unitsPerRequest() { return 1; }
  pricePerUnit() { return 0.002; }
  currency() { return "USD"; }
  limits() { return { maxConcurrency: 10, requestsPerMinute: 6000 }; }

  async fetchRanking(req: SerpRequest): Promise<SerpResult> {
    const k = req.keyword.toLowerCase();
    if (k.includes("fail-auth")) throw new ProviderError("auth", "mock_auth", "Mock auth failure");
    if (k.includes("fail-transient")) throw new ProviderError("transient", "mock_transient", "Mock transient failure");
    if (k.includes("fail-invalid")) throw new ProviderError("invalid_request", "mock_invalid", "Mock invalid request");

    // Seed on keyword + location + device + current day so results drift slowly over time.
    const day = new Date().toISOString().slice(0, 10);
    const seed = (s: string) => createHash("sha256").update(s).digest().readUInt32BE(0);
    const base = seed(`${k}|${req.location.city ?? req.location.countryCode}|${req.device}`);
    const drift = (seed(`${k}|${day}`) % 7) - 3;
    const notFound = k.includes("not-ranking") || base % 9 === 0;
    const position = notFound ? null : Math.max(1, Math.min(req.depth, (base % 40) + 1 + drift));
    const features = ["local_pack", "people_also_ask", "featured_snippet", "images", "video"].filter((_, i) => (base >> i) & 1);
    const loc = req.location.latitude != null ? `coordinates: ${req.location.latitude},${req.location.longitude}`
      : req.location.city ? `city: ${req.location.city}, ${req.location.countryCode}` : `country: ${req.location.countryCode}`;

    return {
      position,
      rankingUrl: position ? `https://${req.targetDomain}/${k.replace(/\s+/g, "-")}` : null,
      rankingTitle: position ? `${req.keyword} | ${req.targetDomain}` : null,
      serpFeatures: features,
      competitors: req.competitorDomains.map((c) => {
        const p = (seed(`${k}|${c.domain}`) % 50) + 1;
        return { id: c.id, position: p <= req.depth ? p : null, url: `https://${c.domain}/` };
      }),
      requestedLocation: loc,
      depth: req.depth,
      providerRequestId: `mock-${base.toString(16)}`,
      unitsConsumed: 1,
      actualCost: this.pricePerUnit(),
      metadata: { synthetic: true },
    };
  }
}
