import type { Device } from "@/lib/keywords";

/** Error classes drive retry policy. Never retry auth/invalid/unsupported automatically. */
export type ProviderErrorKind =
  | "transient" // network failure before/without a billable request, 5xx: retry with backoff
  | "rate_limited" // 429 / provider throttle: retry after Retry-After
  | "auth" // bad/revoked credentials: permanent
  | "invalid_request" // bad keyword/location: permanent
  | "unsupported" // provider cannot serve this configuration: permanent
  | "insufficient_funds" // provider account balance: permanent until topped up
  | "uncertain"; // request may have been billed but the outcome is unknown: do not auto-retry

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    public readonly code: string,
    message: string,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "ProviderError";
  }

  get retryable(): boolean {
    return this.kind === "transient" || this.kind === "rate_limited";
  }
}

export interface ProviderCapabilities {
  devices: Device[];
  locationTargeting: ("country" | "region" | "city" | "postal_code" | "coordinates")[];
  maxDepth: number;
  serpFeatures: boolean;
  competitorPositions: boolean;
  limitations: string[];
}

export interface SerpLocation {
  countryCode: string;
  region?: string | null;
  city?: string | null;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface SerpRequest {
  keyword: string;
  language: string;
  device: Device;
  location: SerpLocation;
  googleDomain: string;
  depth: number;
  targetDomain: string;
  competitorDomains: { id: string; domain: string }[];
}

export interface SerpResult {
  /** Null when the target domain was not found within `depth` results (verified absence). */
  position: number | null;
  rankingUrl: string | null;
  rankingTitle: string | null;
  serpFeatures: string[];
  competitors: { id: string; position: number | null; url: string | null }[];
  /** Human-readable description of exactly what targeting was sent. */
  requestedLocation: string;
  depth: number;
  providerRequestId: string | null;
  unitsConsumed: number;
  /** Cost reported by the provider, when it reports one. */
  actualCost: number | null;
  metadata: Record<string, unknown>;
  /** Every organic result returned (position, url, title), when available. Enables the shared SERP cache. */
  organic?: { position: number; url: string; title: string | null }[];
}

export interface SerpProvider {
  readonly id: string;
  readonly displayName: string;
  /** True when credentials are present server-side. */
  isConfigured(): boolean;
  capabilities(): ProviderCapabilities;
  /** Returns a list of human-readable problems; empty when valid. */
  validate(req: SerpRequest): string[];
  unitsPerRequest(depth: number): number;
  pricePerUnit(): number | null;
  currency(): string;
  limits(): { maxConcurrency: number; requestsPerMinute: number };
  fetchRanking(req: SerpRequest, signal: AbortSignal): Promise<SerpResult>;
}
