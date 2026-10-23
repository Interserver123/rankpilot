import type { Db, Fragment } from "./db";
import { monthStartUtc } from "./budget";

/* Read models for pages. Callers must already have authorized access to the ids they pass. */

export interface ProjectListRow {
  id: string; name: string; domain: string; status: string; client_name: string; timezone: string;
  keyword_count: number; last_success_at: Date | null; next_run_at: Date | null; active_jobs: number; created_at: Date;
}

export async function listProjects(db: Db, filter: Fragment, q?: string, status?: string) {
  const like = q ? `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
  return db<ProjectListRow[]>`
    select p.id, p.name, p.domain, p.status, c.name as client_name, p.timezone, p.created_at,
      (select count(*)::int from keywords k where k.project_id = p.id and k.is_active) as keyword_count,
      oc.last_success_at, oc.next_run_at,
      (select count(*)::int from tracking_jobs j where j.project_id = p.id and j.status in ('queued','running','awaiting_approval')) as active_jobs
    from projects p join clients c on c.id = p.client_id
    left join tracking_configs oc on oc.project_id = p.id and oc.module = 'organic' and oc.target_type = 'project'
    where ${filter}
      ${status ? db`and p.status = ${status}` : db`and p.status <> 'archived'`}
      ${like ? db`and (p.name ilike ${like} or p.domain ilike ${like} or c.name ilike ${like})` : db``}
    order by p.name`;
}

export interface ProjectDetail {
  id: string; organization_id: string; name: string; domain: string; status: string; timezone: string; country: string;
  language: string; business_category: string | null; notes: string | null; client_id: string; client_name: string; created_at: Date;
}

export async function getProject(db: Db, id: string) {
  const [p] = await db<ProjectDetail[]>`
    select p.*, c.name as client_name from projects p join clients c on c.id = p.client_id where p.id = ${id}`;
  return p ?? null;
}

export interface LocationRow {
  id: string; name: string; business_name: string | null; address: string | null; phone: string | null; country_code: string;
  region: string | null; city: string | null; postal_code: string | null; latitude: number | null; longitude: number | null;
  google_domain: string; google_business_profile_reference: string | null; is_primary: boolean;
}

export async function getLocations(db: Db, projectId: string) {
  return db<LocationRow[]>`select * from project_locations where project_id = ${projectId} order by is_primary desc, name`;
}

export async function getCompetitors(db: Db, projectId: string) {
  return db<{ id: string; name: string; domain: string | null; created_at: Date }[]>`
    select id, name, domain, created_at from competitors where project_id = ${projectId} order by name`;
}

export interface ConfigRow {
  id: string; module: string; enabled: boolean; interval_value: number; interval_unit: "day" | "week" | "month";
  preferred_run_time: string; timezone: string; next_run_at: Date | null; last_run_at: Date | null; last_success_at: Date | null;
}

export async function getTrackingConfigs(db: Db, projectId: string) {
  return db<ConfigRow[]>`
    select id, module, enabled, interval_value, interval_unit, to_char(preferred_run_time, 'HH24:MI') as preferred_run_time,
      timezone, next_run_at, last_run_at, last_success_at
    from tracking_configs where project_id = ${projectId} and target_type = 'project'`;
}

export interface KeywordRankRow {
  id: string; keyword: string; device: string; language: string; tags: string[]; is_active: boolean; target_url: string | null;
  location_id: string; location_name: string;
  cur_status: "ranked" | "not_found" | null; cur_pos: number | null; cur_depth: number | null; ranking_url: string | null;
  serp_features: string[] | null; collected_at: Date | null; provider: string | null; requested_location: string | null;
  prev_status: "ranked" | "not_found" | null; prev_pos: number | null; prev_depth: number | null;
  last_target_status: string | null; last_target_error: string | null; last_target_at: Date | null;
  total: number;
}

export interface RankFilters {
  q?: string; tag?: string; locationId?: string; device?: string; active?: "active" | "paused";
  sort?: "keyword" | "position" | "change" | "checked"; dir?: "asc" | "desc"; page?: number; pageSize?: number;
}

export async function keywordRankings(db: Db, projectId: string, f: RankFilters = {}) {
  const pageSize = f.pageSize ?? 50;
  const page = Math.max(1, f.page ?? 1);
  const like = f.q ? `%${f.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
  const dir = f.dir === "desc" ? db`desc` : db`asc`;
  const order =
    f.sort === "position" ? db`cur_pos ${dir} nulls last, keyword`
    : f.sort === "change" ? db`(prev_pos - cur_pos) ${dir} nulls last, keyword`
    : f.sort === "checked" ? db`collected_at ${dir} nulls last, keyword`
    : db`keyword ${dir}`;
  return db<KeywordRankRow[]>`
    with base as (
      select k.id, k.keyword, k.device, k.language, k.tags, k.is_active, k.target_url, k.location_id, l.name as location_name,
        o1.result_status as cur_status, o1.position as cur_pos, o1.result_depth as cur_depth, o1.ranking_url,
        o1.serp_features_json as serp_features, o1.collected_at, o1.provider, o1.requested_location,
        o2.result_status as prev_status, o2.position as prev_pos, o2.result_depth as prev_depth,
        lt.status as last_target_status, lt.error_message as last_target_error, lt.updated_at as last_target_at
      from keywords k
      join project_locations l on l.id = k.location_id
      left join lateral (select * from serp_observations o where o.keyword_id = k.id order by o.collected_at desc limit 1) o1 on true
      left join lateral (select * from serp_observations o where o.keyword_id = k.id and o.collected_at < o1.collected_at
                         order by o.collected_at desc limit 1) o2 on true
      left join lateral (select t.status, t.error_message, t.updated_at from tracking_job_targets t
                         where t.target_type = 'keyword' and t.target_id = k.id and t.status <> 'skipped'
                         order by t.updated_at desc limit 1) lt on true
      where k.project_id = ${projectId}
        ${like ? db`and k.keyword ilike ${like}` : db``}
        ${f.tag ? db`and ${f.tag} = any(k.tags)` : db``}
        ${f.locationId ? db`and k.location_id = ${f.locationId}` : db``}
        ${f.device ? db`and k.device = ${f.device}` : db``}
        ${f.active ? db`and k.is_active = ${f.active === "active"}` : db``}
    )
    select *, count(*) over ()::int as total from base
    order by ${order}
    limit ${pageSize} offset ${(page - 1) * pageSize}`;
}

/** Latest verified observation per active keyword (for distribution and averages). */
export async function latestRanks(db: Db, projectId: string) {
  return db<{ keyword_id: string; result_status: "ranked" | "not_found" | null; position: number | null; result_depth: number | null }[]>`
    select k.id as keyword_id, o.result_status, o.position, o.result_depth
    from keywords k
    left join lateral (select * from serp_observations o where o.keyword_id = k.id order by collected_at desc limit 1) o on true
    where k.project_id = ${projectId} and k.is_active`;
}

export async function projectTags(db: Db, projectId: string) {
  const rows = await db<{ tag: string }[]>`select distinct unnest(tags) as tag from keywords where project_id = ${projectId} order by 1`;
  return rows.map((r) => r.tag);
}

export async function keywordHistory(db: Db, keywordId: string) {
  return db<{ id: string; collected_at: Date; result_status: "ranked" | "not_found"; position: number | null; result_depth: number;
    ranking_url: string | null; ranking_title: string | null; provider: string; requested_location: string; serp_features_json: string[]; job_id: string }[]>`
    select id, collected_at, result_status, position, result_depth, ranking_url, ranking_title, provider, requested_location, serp_features_json, job_id
    from serp_observations where keyword_id = ${keywordId} order by collected_at desc limit 500`;
}

export async function competitorHistory(db: Db, keywordId: string) {
  return db<{ observation_id: string; competitor_id: string; name: string; domain: string; position: number | null }[]>`
    select co.observation_id, co.competitor_id, c.name, c.domain, co.position
    from serp_competitor_observations co join serp_observations o on o.id = co.observation_id
    join competitors c on c.id = co.competitor_id where o.keyword_id = ${keywordId}`;
}

/** Ranking movement over the last `days` per project, from consecutive observations. */
export async function rankMovements(db: Db, filter: Fragment, days = 7, limit = 10) {
  return db<{ project_id: string; project_name: string; keyword_id: string; keyword: string; cur_pos: number | null; prev_pos: number | null; collected_at: Date }[]>`
    with recent as (
      select o.keyword_id, o.position, o.result_status, o.collected_at,
        lag(o.position) over w as prev_pos, lag(o.result_status) over w as prev_status,
        row_number() over (partition by o.keyword_id order by o.collected_at desc) as rn
      from serp_observations o
      join keywords k on k.id = o.keyword_id join projects p on p.id = k.project_id
      where ${filter}
      window w as (partition by o.keyword_id order by o.collected_at)
    )
    select p.id as project_id, p.name as project_name, k.id as keyword_id, k.keyword, r.position as cur_pos, r.prev_pos, r.collected_at
    from recent r join keywords k on k.id = r.keyword_id join projects p on p.id = k.project_id
    where r.rn = 1 and r.collected_at > now() - make_interval(days => ${days})
      and r.prev_status is not null and coalesce(r.position, 0) <> coalesce(r.prev_pos, 0)
    order by abs(coalesce(r.prev_pos, 101) - coalesce(r.position, 101)) desc
    limit ${limit}`;
}

export interface JobListRow {
  id: string; project_id: string; project_name: string; module: string; job_type: string; provider: string; trigger: string;
  status: string; attempts: number; max_attempts: number; estimated_cost: number | null; actual_cost: number | null; currency: string;
  created_at: Date; started_at: Date | null; completed_at: Date | null; run_after: Date; error_code: string | null; error_message: string | null;
  requested_by_email: string | null; summary: Record<string, number>; total: number;
}

export interface JobFilters { projectId?: string; status?: string; provider?: string; module?: string; since?: Date; page?: number }

export async function listJobs(db: Db, filter: Fragment, f: JobFilters = {}) {
  const page = Math.max(1, f.page ?? 1);
  return db<JobListRow[]>`
    select j.id, j.project_id, p.name as project_name, j.module, j.job_type, j.provider, j.trigger, j.status, j.attempts, j.max_attempts,
      j.estimated_cost, j.actual_cost, j.currency, j.created_at, j.started_at, j.completed_at, j.run_after, j.error_code, j.error_message,
      u.email as requested_by_email, j.result_summary_json as summary, count(*) over ()::int as total
    from tracking_jobs j join projects p on p.id = j.project_id
    left join users u on u.id = j.requested_by_user_id
    where ${filter}
      ${f.projectId ? db`and j.project_id = ${f.projectId}` : db``}
      ${f.status ? db`and j.status = ${f.status}` : db``}
      ${f.provider ? db`and j.provider = ${f.provider}` : db``}
      ${f.module ? db`and j.module = ${f.module}` : db``}
      ${f.since ? db`and j.created_at >= ${f.since}` : db``}
    order by j.created_at desc
    limit 50 offset ${(page - 1) * 50}`;
}

export async function jobTargets(db: Db, jobId: string) {
  return db<{ id: string; status: string; attempts: number; error_code: string | null; error_message: string | null; updated_at: Date;
    keyword: string | null; keyword_id: string | null; provider_request_id: string | null }[]>`
    select t.id, t.status, t.attempts, t.error_code, t.error_message, t.updated_at, k.keyword, k.id as keyword_id, t.provider_request_id
    from tracking_job_targets t left join keywords k on k.id = t.target_id and t.target_type = 'keyword'
    where t.job_id = ${jobId}
    order by case t.status when 'failed' then 0 when 'uncertain' then 1 when 'in_flight' then 2 when 'pending' then 3 else 4 end, k.keyword`;
}

export async function jobStatusCounts(db: Db, filter: Fragment) {
  const rows = await db<{ status: string; n: number }[]>`
    select j.status, count(*)::int as n from tracking_jobs j join projects p on p.id = j.project_id
    where ${filter} and (j.status in ('queued','running','awaiting_approval') or j.created_at > now() - interval '7 days')
    group by j.status`;
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
}

export async function delayedJobs(db: Db, filter: Fragment) {
  const [r] = await db<{ n: number }[]>`
    select count(*)::int as n from tracking_jobs j join projects p on p.id = j.project_id
    where ${filter} and j.status = 'queued' and j.run_after < now() - interval '15 minutes'`;
  return r?.n ?? 0;
}

export async function usageSummary(db: Db, organizationId: string, now = new Date()) {
  const since = monthStartUtc(now);
  const byProvider = await db<{ provider: string; module: string; units: number; cost: number | null; unpriced: number; currency: string }[]>`
    select provider, module, sum(coalesce(units_consumed, units_requested))::float8 as units,
      sum(coalesce(actual_cost, estimated_cost))::float8 as cost,
      count(*) filter (where actual_cost is null and estimated_cost is null)::int as unpriced, min(currency) as currency
    from provider_usage where organization_id = ${organizationId} and recorded_at >= ${since}
    group by provider, module order by cost desc nulls last`;
  const byProject = await db<{ project_id: string; project_name: string; module: string; units: number; cost: number | null }[]>`
    select u.project_id, p.name as project_name, u.module, sum(coalesce(units_consumed, units_requested))::float8 as units,
      sum(coalesce(actual_cost, estimated_cost))::float8 as cost
    from provider_usage u join projects p on p.id = u.project_id
    where u.organization_id = ${organizationId} and u.recorded_at >= ${since}
    group by u.project_id, p.name, u.module order by cost desc nulls last`;
  const daily = await db<{ day: string; cost: number | null; units: number }[]>`
    select to_char(date_trunc('day', recorded_at), 'YYYY-MM-DD') as day, sum(coalesce(actual_cost, estimated_cost))::float8 as cost,
      sum(coalesce(units_consumed, units_requested))::float8 as units
    from provider_usage where organization_id = ${organizationId} and recorded_at >= ${since}
    group by 1 order by 1`;
  return { since, byProvider, byProject, daily };
}

export async function listBudgets(db: Db, organizationId: string) {
  return db<{ id: string; project_id: string | null; project_name: string | null; module: string | null; monthly_limit: number;
    currency: string; alert_threshold_pct: number; on_limit: string }[]>`
    select b.*, p.name as project_name from budgets b left join projects p on p.id = b.project_id
    where b.organization_id = ${organizationId} order by p.name nulls first, b.module nulls first`;
}

export async function auditTrail(db: Db, entityType: string, entityIds: string[], limit = 20) {
  return db<{ id: string; action: string; metadata_json: Record<string, unknown>; created_at: Date; actor_email: string | null }[]>`
    select a.id, a.action, a.metadata_json, a.created_at, u.email as actor_email
    from audit_logs a left join users u on u.id = a.actor_user_id
    where a.entity_type = ${entityType} and a.entity_id = any(${entityIds}::uuid[])
    order by a.created_at desc limit ${limit}`;
}

export async function globalSearch(db: Db, filter: Fragment, q: string) {
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const projects = await db<{ id: string; name: string; domain: string; client_name: string }[]>`
    select p.id, p.name, p.domain, c.name as client_name from projects p join clients c on c.id = p.client_id
    where ${filter} and (p.name ilike ${like} or p.domain ilike ${like} or c.name ilike ${like}) order by p.name limit 20`;
  const locations = await db<{ id: string; project_id: string; project_name: string; business_name: string | null; name: string }[]>`
    select l.id, l.project_id, p.name as project_name, l.business_name, l.name from project_locations l join projects p on p.id = l.project_id
    where ${filter} and (l.business_name ilike ${like} or l.name ilike ${like}) order by p.name limit 20`;
  const keywords = await db<{ id: string; keyword: string; project_id: string; project_name: string }[]>`
    select k.id, k.keyword, k.project_id, p.name as project_name from keywords k join projects p on p.id = k.project_id
    where ${filter} and k.keyword ilike ${like} order by k.keyword limit 50`;
  return { projects, locations, keywords };
}
