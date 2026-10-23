import type { Sql } from "../db";
import { audit } from "../audit";
import { ProviderError, type SerpProvider, type SerpRequest, type SerpResult } from "../providers/types";
import { cacheKey, readSerpCache, resultFromCache, writeSerpCache } from "../providers/serp-cache";
import { DEFAULT_DEPTH_OPTIONS, planDepth, type DepthPlan } from "@/lib/depth-plan";
import { limiterFor } from "../providers/rate-limiter";
import { providerValue, refreshProviderCredentials } from "../providers/credentials";
import { defaultSerpProvider, getSerpProvider } from "../providers/registry";
import { scheduleInlineRun } from "./inline";
import { enqueueJob, finalizeJob, heartbeat, type EnqueueResult, type JobRow, type JobStatus } from "./queue";

export const DEFAULT_RESULT_DEPTH = 100;
const PERMANENT_STOP: ProviderError["kind"][] = ["auth", "insufficient_funds"];

interface KeywordTargetRow {
  target_row_id: string;
  keyword_id: string;
  keyword: string;
  language: string;
  device: "desktop" | "mobile";
  is_active: boolean;
  country_code: string;
  region: string | null;
  city: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  google_domain: string;
  domain: string;
  project_id: string;
  organization_id: string;
}

const COMPETITOR_MIN_DEPTH = 30;

/** Adaptive depth only helps providers that bill by result depth (cost grows with depth). */
export function adaptiveDepthSupported(provider: SerpProvider, maxDepth: number): boolean {
  return provider.unitsPerRequest(DEFAULT_DEPTH_OPTIONS.pageSize) < provider.unitsPerRequest(maxDepth);
}

function intSetting(providerId: string, key: string, fallback: number, min: number, max: number): number {
  const n = Number(providerValue(providerId, key));
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
}

/** Depth to request first for each keyword, from its previous observations. */
export async function loadDepthPlans(sql: Sql, provider: SerpProvider, keywordIds: string[], maxDepth: number, hasCompetitors: boolean, now: Date): Promise<Map<string, DepthPlan>> {
  const plans = new Map<string, DepthPlan>();
  if (!keywordIds.length) return plans;
  const prev = await sql<{ keyword_id: string; result_status: "ranked" | "not_found"; position: number | null }[]>`
    select distinct on (keyword_id) keyword_id, result_status, position from serp_observations
    where keyword_id = any(${keywordIds}::uuid[]) order by keyword_id, collected_at desc`;
  const full = await sql<{ keyword_id: string; at: Date }[]>`
    select keyword_id, max(collected_at) as at from serp_observations
    where keyword_id = any(${keywordIds}::uuid[]) and result_depth >= ${maxDepth} group by keyword_id`;
  const prevBy = new Map(prev.map((r) => [r.keyword_id, r]));
  const fullBy = new Map(full.map((r) => [r.keyword_id, r.at]));
  const options = {
    maxDepth,
    pageSize: DEFAULT_DEPTH_OPTIONS.pageSize,
    probeDepth: intSetting(provider.id, "probeDepth", DEFAULT_DEPTH_OPTIONS.probeDepth, 10, maxDepth),
    fullCheckDays: intSetting(provider.id, "fullCheckDays", DEFAULT_DEPTH_OPTIONS.fullCheckDays, 1, 365),
    bufferRanks: DEFAULT_DEPTH_OPTIONS.bufferRanks,
    competitorFloor: hasCompetitors ? COMPETITOR_MIN_DEPTH : null,
    now,
  };
  for (const id of keywordIds) {
    const p = prevBy.get(id);
    plans.set(id, planDepth(p ? { status: p.result_status, position: p.position } : null, fullBy.get(id) ?? null, options));
  }
  return plans;
}

export interface ProcessOptions {
  workerId: string;
  requestTimeoutMs?: number;
  /** Epoch ms after which no new keyword is started (serverless time limit). Unstarted keywords stay pending. */
  deadlineAt?: number;
  targetConcurrency?: number;
  now?: () => Date;
}

/**
 * Collects organic rankings for every pending keyword target of a claimed job.
 * Each target is persisted independently, so a partially failed batch keeps its successes.
 */
export async function processSerpJob(sql: Sql, job: JobRow, opts: ProcessOptions): Promise<JobStatus> {
  const now = opts.now ?? (() => new Date());
  const provider = getSerpProvider(job.provider);
  if (!provider || !provider.isConfigured()) {
    return finalizeJob(sql, job, { retryAfterMs: 0, now: now(), fatalError: { code: "provider_not_configured", message: `Provider "${job.provider}" is not configured` } });
  }
  const depth = Number(job.payload_json.depth ?? DEFAULT_RESULT_DEPTH);

  const targets = await sql<KeywordTargetRow[]>`
    select t.id as target_row_id, k.id as keyword_id, k.keyword, k.language, k.device, k.is_active,
      l.country_code, l.region, l.city, l.postal_code, l.latitude, l.longitude, l.google_domain,
      p.domain, p.id as project_id, p.organization_id
    from tracking_job_targets t
    join keywords k on k.id = t.target_id
    join project_locations l on l.id = k.location_id
    join projects p on p.id = k.project_id
    where t.job_id = ${job.id} and t.status = 'pending' and t.target_type = 'keyword'
    order by k.keyword`;
  // Targets whose keyword was deleted since enqueue.
  await sql`
    update tracking_job_targets t set status = 'skipped', error_code = 'target_deleted', updated_at = now()
    where t.job_id = ${job.id} and t.status = 'pending' and not exists (select 1 from keywords k where k.id = t.target_id)`;

  const competitors = await sql<{ id: string; domain: string }[]>`
    select id, domain from competitors where project_id = ${job.project_id} and domain is not null`;

  const adaptive = adaptiveDepthSupported(provider, depth);
  const plans = adaptive ? await loadDepthPlans(sql, provider, targets.map((t) => t.keyword_id), depth, competitors.length > 0, now()) : new Map<string, DepthPlan>();
  const limiter = limiterFor(provider.id, provider.limits().requestsPerMinute);
  let retryAfterMs = 0;
  let fatal: { code: string; message: string } | undefined;
  let timedOut = false;
  const queue = [...targets];

  const worker = async () => {
    for (;;) {
      if (fatal) return;
      if (opts.deadlineAt && Date.now() > opts.deadlineAt) { timedOut = true; return; }
      const t = queue.shift();
      if (!t) return;
      await processTarget(t);
    }
  };

  const processTarget = async (t: KeywordTargetRow) => {
    if (!t.is_active && job.trigger !== "manual") {
      await sql`update tracking_job_targets set status = 'skipped', error_code = 'keyword_paused', updated_at = now() where id = ${t.target_row_id}`;
      return;
    }
    const req: SerpRequest = {
      keyword: t.keyword,
      language: t.language,
      device: t.device,
      location: { countryCode: t.country_code, region: t.region, city: t.city, postalCode: t.postal_code, latitude: t.latitude, longitude: t.longitude },
      googleDomain: t.google_domain,
      depth,
      targetDomain: t.domain,
      competitorDomains: competitors,
    };
    const problems = provider.validate(req);
    if (problems.length) {
      await sql`update tracking_job_targets set status = 'failed', error_code = 'invalid_request', error_message = ${problems.join("; ")}, updated_at = now() where id = ${t.target_row_id}`;
      return;
    }

    // Mark in flight before calling so a crash leaves an auditable "uncertain" record, not a silent retry.
    const claimed = await sql`
      update tracking_job_targets set status = 'in_flight', attempts = attempts + 1, updated_at = now()
      where id = ${t.target_row_id} and status = 'pending' returning id`;
    if (claimed.length === 0) return;

    const plan: DepthPlan = plans.get(t.keyword_id) ?? { depth, reason: "baseline", escalate: false };
    let spentUnits = 0; // units actually billed so far for this keyword (cache hits cost 0)
    let spentActual: number | null = 0;
    let currentDepth = plan.depth;
    const fetchAt = async (callDepth: number): Promise<{ result: SerpResult; collectedAt: Date; cached: boolean }> => {
      const callReq: SerpRequest = { ...req, depth: callDepth };
      const key = cacheKey(provider.id, callReq);
      const hit = await readSerpCache(sql, key, callDepth).catch(() => null);
      if (hit) return { result: resultFromCache(hit, callReq), collectedAt: hit.fetchedAt, cached: true };
      await limiter.acquire();
      currentDepth = callDepth;
      const result = await provider.fetchRanking(callReq, AbortSignal.timeout(opts.requestTimeoutMs ?? 60_000));
      spentUnits += result.unitsConsumed;
      spentActual = spentActual !== null && result.actualCost !== null ? spentActual + result.actualCost : null;
      await writeSerpCache(sql, key, provider.id, result).catch(() => {});
      return { result, collectedAt: now(), cached: false };
    };

    try {
      let got = await fetchAt(plan.depth);
      let escalated = false;
      if (plan.escalate && got.result.position === null && plan.depth < depth) {
        escalated = true;
        got = await fetchAt(depth);
      }
      const { result, collectedAt, cached } = got;
      const savedUnits = Math.max(0, provider.unitsPerRequest(depth) - spentUnits);
      await sql.begin(async (tx) => {
        const [obs] = await tx<{ id: string }[]>`
          insert into serp_observations (keyword_id, job_id, provider, requested_location, device, result_depth, collected_at,
            result_status, position, ranking_url, ranking_title, serp_features_json, result_metadata_json)
          values (${t.keyword_id}, ${job.id}, ${provider.id}, ${result.requestedLocation}, ${t.device}, ${result.depth}, ${collectedAt},
            ${result.position === null ? "not_found" : "ranked"}, ${result.position}, ${result.rankingUrl}, ${result.rankingTitle},
            ${tx.json(result.serpFeatures as never)}, ${tx.json({
              ...result.metadata, provider_request_id: result.providerRequestId,
              ...(cached ? { served_from_cache: true, cache_fetched_at: collectedAt.toISOString() } : {}),
              ...(adaptive ? { depth_plan: plan.reason, escalated } : {}),
            } as never)})
          on conflict (job_id, keyword_id) do nothing
          returning id`;
        if (obs && result.competitors.length) {
          await tx`insert into serp_competitor_observations ${tx(result.competitors.map((c) => ({
            observation_id: obs.id, competitor_id: c.id, position: c.position, ranking_url: c.url,
          })))}`;
        }
        await recordUsage(tx as unknown as Sql, job, provider, t.project_id, spentUnits, spentActual, savedUnits);
        await tx`update tracking_job_targets set status = 'succeeded', error_code = null, error_message = null,
          provider_request_id = ${result.providerRequestId}, updated_at = now() where id = ${t.target_row_id}`;
      });
    } catch (e) {
      const err = e instanceof ProviderError ? e
        // Unknown failure after the request was sent: treat as uncertain, never auto-retry.
        : new ProviderError("uncertain", "unexpected_error", e instanceof Error ? e.message : String(e));
      if (err.kind === "uncertain") {
        // The in-flight request may have been billed, on top of anything already spent on this keyword.
        await recordUsage(sql, job, provider, t.project_id, spentUnits + provider.unitsPerRequest(currentDepth), null, 0);
      } else if (spentUnits > 0) {
        await recordUsage(sql, job, provider, t.project_id, spentUnits, spentActual, 0);
      }
      if (err.retryable) {
        if (err.retryAfterMs) { limiter.pause(err.retryAfterMs); retryAfterMs = Math.max(retryAfterMs, err.retryAfterMs); }
        await sql`update tracking_job_targets set status = 'pending', error_code = ${err.code}, error_message = ${err.message}, updated_at = now() where id = ${t.target_row_id}`;
        // Long provider back-off: stop this pass; the job is re-queued for later.
        if (err.kind === "rate_limited" && (err.retryAfterMs ?? 0) > 120_000) queue.length = 0;
      } else if (err.kind === "uncertain") {
        await sql`update tracking_job_targets set status = 'uncertain', error_code = ${err.code}, error_message = ${err.message}, updated_at = now() where id = ${t.target_row_id}`;
      } else {
        await sql`update tracking_job_targets set status = 'failed', error_code = ${err.code}, error_message = ${err.message}, updated_at = now() where id = ${t.target_row_id}`;
        if (PERMANENT_STOP.includes(err.kind)) fatal = { code: err.code, message: err.message };
      }
    }
    await heartbeat(sql, job.id, opts.workerId);
  };

  const concurrency = Math.max(1, Math.min(opts.targetConcurrency ?? 3, provider.limits().maxConcurrency));
  await Promise.all(Array.from({ length: concurrency }, worker));
  // Stopped for time, not failure: hand the job back without using up one of its attempts.
  if (timedOut) await sql`update tracking_jobs set attempts = greatest(attempts - 1, 0) where id = ${job.id}`;
  return finalizeJob(sql, job, { retryAfterMs, now: now(), fatalError: fatal });
}

async function recordUsage(sql: Sql, job: JobRow, provider: SerpProvider, projectId: string, units: number, actualCost: number | null, savedUnits: number) {
  const price = provider.pricePerUnit();
  await sql`
    insert into provider_usage (organization_id, project_id, job_id, provider, module, units_requested, units_consumed, estimated_cost, actual_cost, currency, saved_units, saved_cost)
    values (${job.organization_id}, ${projectId}, ${job.id}, ${provider.id}, 'organic', ${units}, ${actualCost === null ? null : units},
      ${price === null ? null : price * units}, ${actualCost}, ${provider.currency()}, ${savedUnits}, ${price === null ? 0 : price * savedUnits})`;
}

// ---------------------------------------------------------------------------
// Enqueue helpers
// ---------------------------------------------------------------------------

export interface OrganicEnqueueInput {
  projectId: string;
  /** Specific keyword ids, or null for every active keyword in the project. */
  keywordIds: string[] | null;
  /** Restrict to keywords carrying this tag (used by tag-scoped tracking configs). */
  tag?: string | null;
  trigger: JobRow["trigger"];
  requestedByUserId?: string | null;
  trackingConfigId?: string | null;
  budgetOverride?: boolean;
}

/** Expected billable units: the first request per keyword at its planned depth (misses may add a deeper repeat). */
async function plannedUnits(sql: Sql, provider: SerpProvider, projectId: string, keywordIds: string[]): Promise<number> {
  if (!adaptiveDepthSupported(provider, DEFAULT_RESULT_DEPTH)) return keywordIds.length * provider.unitsPerRequest(DEFAULT_RESULT_DEPTH);
  const [c] = await sql<{ has: boolean }[]>`select exists(select 1 from competitors where project_id = ${projectId} and domain is not null) as has`;
  const plans = await loadDepthPlans(sql, provider, keywordIds, DEFAULT_RESULT_DEPTH, c?.has ?? false, new Date());
  let units = 0;
  for (const id of keywordIds) units += provider.unitsPerRequest(plans.get(id)?.depth ?? DEFAULT_RESULT_DEPTH);
  return units;
}

export async function organicEstimate(sql: Sql, projectId: string, keywordIds: string[] | null) {
  await refreshProviderCredentials(sql);
  const provider = defaultSerpProvider();
  const ids = (await sql<{ id: string }[]>`
    select id from keywords where project_id = ${projectId} and is_active
      ${keywordIds ? sql`and id = any(${keywordIds}::uuid[])` : sql``}`).map((r) => r.id);
  const n = ids.length;
  const units = provider ? await plannedUnits(sql, provider, projectId, ids) : 0;
  const price = provider?.pricePerUnit() ?? null;
  return {
    provider: provider ? { id: provider.id, name: provider.displayName } : null,
    keywords: n,
    units,
    amount: price === null ? null : Math.round(units * price * 10000) / 10000,
    currency: provider?.currency() ?? "USD",
  };
}

export async function enqueueOrganic(sql: Sql, input: OrganicEnqueueInput): Promise<EnqueueResult | { kind: "no_provider" }> {
  await refreshProviderCredentials(sql);
  const [project] = await sql<{ organization_id: string; status: string }[]>`
    select organization_id, status from projects where id = ${input.projectId}`;
  if (!project) throw new Error("Project not found");
  if (project.status !== "active") return { kind: "nothing_to_do" };

  const rows = await sql<{ id: string }[]>`
    select id from keywords where project_id = ${input.projectId}
      ${input.keywordIds ? sql`and id = any(${input.keywordIds}::uuid[])` : sql`and is_active`}
      ${input.tag ? sql`and ${input.tag} = any(tags)` : sql``}`;
  const provider = defaultSerpProvider();
  if (!provider) {
    await audit(sql, { organizationId: project.organization_id, actorUserId: input.requestedByUserId ?? null, action: "job.no_provider", entityType: "project", entityId: input.projectId });
    return { kind: "no_provider" };
  }
  const price = provider.pricePerUnit();
  const expectedUnits = rows.length ? (await plannedUnits(sql, provider, input.projectId, rows.map((r) => r.id))) / rows.length : provider.unitsPerRequest(DEFAULT_RESULT_DEPTH);
  const queued = await enqueueJob(sql, {
    organizationId: project.organization_id,
    projectId: input.projectId,
    trackingConfigId: input.trackingConfigId ?? null,
    module: "organic",
    jobType: "serp_collection",
    provider: provider.id,
    trigger: input.trigger,
    requestedByUserId: input.requestedByUserId ?? null,
    // Manual refreshes are served ahead of scheduled runs.
    priority: input.trigger === "manual" ? 50 : 100,
    payload: { depth: DEFAULT_RESULT_DEPTH },
    targetType: "keyword",
    targetIds: rows.map((r) => r.id),
    costPerTarget: price === null ? null : price * expectedUnits,
    currency: provider.currency(),
    budgetOverride: input.budgetOverride,
  });
  // Hosts without a background worker (Vercel) process the job right after the response.
  if (queued.kind === "queued") scheduleInlineRun();
  return queued;
}
