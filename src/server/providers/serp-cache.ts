import { createHash } from "node:crypto";
import type { Sql } from "../db";
import type { SerpRequest, SerpResult } from "./types";
import { findDomainPosition, type OrganicItem } from "./serp/serp-parse";

/** Minutes a fetched SERP may be reused. 0 disables the cache. */
export function cacheTtlMinutes(): number {
  const n = Number(process.env.SERP_CACHE_MINUTES ?? 30);
  return Number.isFinite(n) && n >= 0 ? n : 30;
}

/** Identical search = same engine settings, keyword, language, device and location. */
export function cacheKey(providerId: string, req: SerpRequest): string {
  const l = req.location;
  const parts = [providerId, req.keyword.trim().toLowerCase().replace(/\s+/g, " "), req.language, req.device, req.googleDomain,
    l.countryCode.toUpperCase(), l.region ?? "", l.city ?? "", l.postalCode ?? "", l.latitude ?? "", l.longitude ?? ""];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export interface CachedSerp { organic: OrganicItem[]; features: string[]; requestedLocation: string; depth: number; fetchedAt: Date }

/** A cached SERP satisfies a request when it is fresh and at least as deep. */
export async function readSerpCache(sql: Sql, key: string, minDepth: number, ttlMinutes = cacheTtlMinutes()): Promise<CachedSerp | null> {
  if (ttlMinutes <= 0) return null;
  const [r] = await sql<{ organic_json: OrganicItem[]; features_json: string[]; requested_location: string; depth: number; fetched_at: Date }[]>`
    select organic_json, features_json, requested_location, depth, fetched_at from serp_cache
    where cache_key = ${key} and depth >= ${minDepth} and fetched_at > now() - make_interval(mins => ${ttlMinutes})`;
  return r ? { organic: r.organic_json, features: r.features_json, requestedLocation: r.requested_location, depth: r.depth, fetchedAt: r.fetched_at } : null;
}

export async function writeSerpCache(sql: Sql, key: string, providerId: string, result: SerpResult, ttlMinutes = cacheTtlMinutes()): Promise<void> {
  if (ttlMinutes <= 0 || !result.organic) return;
  await sql`
    insert into serp_cache (cache_key, provider, depth, requested_location, organic_json, features_json, fetched_at)
    values (${key}, ${providerId}, ${result.depth}, ${result.requestedLocation}, ${sql.json(result.organic as never)}, ${sql.json(result.serpFeatures as never)}, now())
    on conflict (cache_key) do update set depth = excluded.depth, requested_location = excluded.requested_location,
      organic_json = excluded.organic_json, features_json = excluded.features_json, fetched_at = now()
    where excluded.depth >= serp_cache.depth or serp_cache.fetched_at < now() - make_interval(mins => ${ttlMinutes})`;
  if (Math.random() < 0.05) await sql`delete from serp_cache where fetched_at < now() - interval '1 day'`;
}

/** Rebuilds a result for this project's domain from a cached SERP, limited to the requested depth. */
export function resultFromCache(c: CachedSerp, req: SerpRequest): SerpResult {
  const organic = c.organic.filter((i) => i.position <= req.depth);
  const match = findDomainPosition(organic, req.targetDomain);
  return {
    position: match?.position ?? null,
    rankingUrl: match?.url ?? null,
    rankingTitle: match?.title ?? null,
    serpFeatures: c.features,
    competitors: req.competitorDomains.map((cd) => {
      const m = findDomainPosition(organic, cd.domain);
      return { id: cd.id, position: m?.position ?? null, url: m?.url ?? null };
    }),
    requestedLocation: c.requestedLocation,
    depth: req.depth,
    providerRequestId: null,
    unitsConsumed: 0,
    actualCost: null,
    metadata: { organic_results: organic.length },
  };
}
