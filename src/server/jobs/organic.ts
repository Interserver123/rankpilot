import type { Sql } from "../db";
import { audit } from "../audit";
import { ProviderError, type SerpProvider, type SerpRequest } from "../providers/types";
import { limiterFor } from "../providers/rate-limiter";
import { refreshProviderCredentials } from "../providers/credentials";
import { defaultSerpProvider, getSerpProvider } from "../providers/registry";
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

export interface ProcessOptions {
  workerId: string;
  requestTimeoutMs?: number;
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

  const limiter = limiterFor(provider.id, provider.limits().requestsPerMinute);
  let retryAfterMs = 0;
  let fatal: { code: string; message: string } | undefined;
  const queue = [...targets];

  const worker = async () => {
    for (;;) {
      if (fatal) return;
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

    await limiter.acquire();
    // Mark in flight before calling so a crash leaves an auditable "uncertain" record, not a silent retry.
    const claimed = await sql`
      update tracking_job_targets set status = 'in_flight', attempts = attempts + 1, updated_at = now()
      where id = ${t.target_row_id} and status = 'pending' returning id`;
    if (claimed.length === 0) return;

    try {
      const result = await provider.fetchRanking(req, AbortSignal.timeout(opts.requestTimeoutMs ?? 60_000));
      const collectedAt = now();
      await sql.begin(async (tx) => {
        const [obs] = await tx<{ id: string }[]>`
          insert into serp_observations (keyword_id, job_id, provider, requested_location, device, result_depth, collected_at,
            result_status, position, ranking_url, ranking_title, serp_features_json, result_metadata_json)
          values (${t.keyword_id}, ${job.id}, ${provider.id}, ${result.requestedLocation}, ${t.device}, ${result.depth}, ${collectedAt},
            ${result.position === null ? "not_found" : "ranked"}, ${result.position}, ${result.rankingUrl}, ${result.rankingTitle},
            ${tx.json(result.serpFeatures as never)}, ${tx.json({ ...result.metadata, provider_request_id: result.providerRequestId } as never)})
          on conflict (job_id, keyword_id) do nothing
          returning id`;
        if (obs && result.competitors.length) {
          await tx`insert into serp_competitor_observations ${tx(result.competitors.map((c) => ({
            observation_id: obs.id, competitor_id: c.id, position: c.position, ranking_url: c.url,
          })))}`;
        }
        await recordUsage(tx as unknown as Sql, job, provider, t.project_id, result.unitsConsumed, result.actualCost);
        await tx`update tracking_job_targets set status = 'succeeded', error_code = null, error_message = null,
          provider_request_id = ${result.providerRequestId}, updated_at = now() where id = ${t.target_row_id}`;
      });
    } catch (e) {
      const err = e instanceof ProviderError ? e
        // Unknown failure after the request may have been sent: treat as uncertain, never auto-retry.
        : new ProviderError("uncertain", "unexpected_error", e instanceof Error ? e.message : String(e));
      if (err.retryable) {
        if (err.retryAfterMs) { limiter.pause(err.retryAfterMs); retryAfterMs = Math.max(retryAfterMs, err.retryAfterMs); }
        await sql`update tracking_job_targets set status = 'pending', error_code = ${err.code}, error_message = ${err.message}, updated_at = now() where id = ${t.target_row_id}`;
        // Long provider back-off: stop this pass; the job is re-queued for later.
        if (err.kind === "rate_limited" && (err.retryAfterMs ?? 0) > 120_000) queue.length = 0;
      } else if (err.kind === "uncertain") {
        await recordUsage(sql, job, provider, t.project_id, provider.unitsPerRequest(depth), null);
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
  return finalizeJob(sql, job, { retryAfterMs, now: now(), fatalError: fatal });
}

async function recordUsage(sql: Sql, job: JobRow, provider: SerpProvider, projectId: string, units: number, actualCost: number | null) {
  const price = provider.pricePerUnit();
  await sql`
    insert into provider_usage (organization_id, project_id, job_id, provider, module, units_requested, units_consumed, estimated_cost, actual_cost, currency)
    values (${job.organization_id}, ${projectId}, ${job.id}, ${provider.id}, 'organic', ${units}, ${actualCost === null ? null : units},
      ${price === null ? null : price * units}, ${actualCost}, ${provider.currency()})`;
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

export async function organicEstimate(sql: Sql, projectId: string, keywordIds: string[] | null) {
  await refreshProviderCredentials(sql);
  const provider = defaultSerpProvider();
  const [{ n } = { n: 0 }] = await sql<{ n: number }[]>`
    select count(*)::int as n from keywords where project_id = ${projectId} and is_active
      ${keywordIds ? sql`and id = any(${keywordIds}::uuid[])` : sql``}`;
  const units = provider ? n * provider.unitsPerRequest(DEFAULT_RESULT_DEPTH) : 0;
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
  return enqueueJob(sql, {
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
    costPerTarget: price === null ? null : price * provider.unitsPerRequest(DEFAULT_RESULT_DEPTH),
    currency: provider.currency(),
    budgetOverride: input.budgetOverride,
  });
}
