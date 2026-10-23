import { dedupeKeywordConfigs, normalizeKeyword, normalizeTags } from "@/lib/keywords";
import { advanceSchedule, firstRunAt, type IntervalUnit } from "@/lib/schedule";
import type { LocationInput, ProjectWizardData, ScheduleInput, TrackedModule } from "@/lib/validation";
import { MODULES } from "@/lib/validation";
import type { Db, Sql } from "../db";
import { audit } from "../audit";
import { enqueueOrganic } from "../jobs/organic";

export interface Actor { id: string; organizationId: string }

export async function createProject(sql: Sql, actor: Actor, data: ProjectWizardData, now = new Date()) {
  const projectId = await sql.begin(async (tx) => {
    const [existingClient] = await tx<{ id: string }[]>`
      select id from clients where organization_id = ${actor.organizationId} and lower(name) = lower(${data.project.clientName}) limit 1`;
    const clientId = existingClient?.id ?? (await tx<{ id: string }[]>`
      insert into clients (organization_id, name) values (${actor.organizationId}, ${data.project.clientName}) returning id`)[0]!.id;

    const [project] = await tx<{ id: string }[]>`
      insert into projects (organization_id, client_id, name, domain, business_category, timezone, country, language, notes)
      values (${actor.organizationId}, ${clientId}, ${data.project.name}, ${data.project.domain}, ${data.project.businessCategory},
        ${data.project.timezone}, ${data.project.country}, ${data.project.language}, ${data.project.notes ?? null})
      returning id`;
    const pid = project!.id;

    const locationIds: string[] = [];
    for (const [i, loc] of data.locations.entries()) {
      locationIds.push(await insertLocation(tx, pid, loc, i === 0));
    }

    for (const c of data.competitors) {
      await tx`insert into competitors (project_id, name, domain) values (${pid}, ${c.name}, ${c.domain ?? null}) on conflict do nothing`;
    }

    const keywordRows = data.keywords
      .filter((k) => k.locationIndex < locationIds.length)
      .map((k) => ({
        keyword: k.keyword.trim().replace(/\s+/g, " "),
        locationId: locationIds[k.locationIndex]!,
        searchEngine: "google",
        language: data.project.language,
        device: k.device,
        targetUrl: k.targetUrl ?? null,
        tags: normalizeTags(k.tags),
      }));
    await insertKeywords(tx, pid, keywordRows);

    for (const module of MODULES) {
      const s = data.schedules[module];
      const nextRunAt = s.enabled
        ? firstRunAt({ intervalValue: s.intervalValue, intervalUnit: s.intervalUnit, preferredRunTime: s.preferredRunTime, timezone: data.project.timezone }, now)
        : null;
      await tx`
        insert into tracking_configs (project_id, module, enabled, interval_value, interval_unit, preferred_run_time, timezone, next_run_at)
        values (${pid}, ${module}, ${s.enabled}, ${s.intervalValue}, ${s.intervalUnit}, ${s.preferredRunTime}, ${data.project.timezone}, ${nextRunAt})`;
    }

    await audit(tx, { organizationId: actor.organizationId, actorUserId: actor.id, action: "project.created", entityType: "project", entityId: pid,
      metadata: { keywords: keywordRows.length, locations: locationIds.length } });
    return pid;
  });

  let initialJob: Awaited<ReturnType<typeof enqueueOrganic>> | null = null;
  if (data.activate && data.schedules.organic.enabled && data.keywords.length > 0) {
    const [cfg] = await sql<{ id: string }[]>`select id from tracking_configs where project_id = ${projectId} and module = 'organic' and target_type = 'project'`;
    initialJob = await enqueueOrganic(sql, { projectId, keywordIds: null, trigger: "initial", requestedByUserId: actor.id, trackingConfigId: cfg?.id });
  }
  return { projectId, initialJob };
}

export async function insertLocation(db: Db, projectId: string, loc: LocationInput, isPrimary: boolean): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    insert into project_locations (project_id, name, business_name, address, phone, country_code, region, city, postal_code,
      latitude, longitude, google_domain, google_business_profile_reference, is_primary)
    values (${projectId}, ${loc.name}, ${loc.businessName ?? null}, ${loc.address ?? null}, ${loc.phone ?? null}, ${loc.countryCode},
      ${loc.region ?? null}, ${loc.city ?? null}, ${loc.postalCode ?? null}, ${loc.latitude ?? null}, ${loc.longitude ?? null},
      ${loc.googleDomain}, ${loc.googleBusinessProfileReference ?? null}, ${isPrimary})
    returning id`;
  return row!.id;
}

export interface NewKeyword {
  keyword: string;
  locationId: string;
  searchEngine: string;
  language: string;
  device: "desktop" | "mobile";
  targetUrl: string | null;
  tags: string[];
}

/** Inserts keywords, skipping duplicates within the batch and against existing configurations. */
export async function insertKeywords(db: Db, projectId: string, rows: NewKeyword[]): Promise<{ inserted: number; duplicates: number }> {
  if (rows.length === 0) return { inserted: 0, duplicates: 0 };
  const { unique, duplicates } = dedupeKeywordConfigs(rows);
  let inserted = 0;
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500).map((k) => ({
      project_id: projectId,
      keyword: k.keyword,
      keyword_normalized: normalizeKeyword(k.keyword),
      location_id: k.locationId,
      search_engine: k.searchEngine,
      language: k.language.toLowerCase(),
      device: k.device,
      target_url: k.targetUrl,
      tags: k.tags,
    }));
    const res = await db`
      insert into keywords ${db(chunk, "project_id", "keyword", "keyword_normalized", "location_id", "search_engine", "language", "device", "target_url", "tags")}
      on conflict (project_id, keyword_normalized, location_id, search_engine, language, device) do nothing
      returning id`;
    inserted += res.length;
  }
  return { inserted, duplicates: rows.length - inserted };
}

export async function updateSchedule(sql: Sql, actor: Actor, projectId: string, module: TrackedModule, input: ScheduleInput, now = new Date()) {
  return sql.begin(async (tx) => {
    const [cfg] = await tx<{ id: string; enabled: boolean; interval_value: number; interval_unit: IntervalUnit; preferred_run_time: string; timezone: string; last_run_at: Date | null; next_run_at: Date | null }[]>`
      select c.id, c.enabled, c.interval_value, c.interval_unit, c.preferred_run_time::text as preferred_run_time, c.timezone, c.last_run_at, c.next_run_at
      from tracking_configs c where c.project_id = ${projectId} and c.module = ${module} and c.target_type = 'project' for update`;
    if (!cfg) throw new Error("Tracking configuration not found");
    const spec = { intervalValue: input.intervalValue, intervalUnit: input.intervalUnit, preferredRunTime: input.preferredRunTime, timezone: cfg.timezone };
    // Keep cadence relative to the last run when there is one; otherwise start at the next preferred time.
    const nextRunAt = !input.enabled ? null
      : cfg.last_run_at ? advanceSchedule(spec, cfg.last_run_at, now).nextRunAt
      : firstRunAt(spec, now);
    await tx`
      update tracking_configs set enabled = ${input.enabled}, interval_value = ${input.intervalValue}, interval_unit = ${input.intervalUnit},
        preferred_run_time = ${input.preferredRunTime}, next_run_at = ${nextRunAt}, updated_at = now()
      where id = ${cfg.id}`;
    await audit(tx, { organizationId: actor.organizationId, actorUserId: actor.id, action: "schedule.updated", entityType: "tracking_config", entityId: cfg.id,
      metadata: {
        module,
        before: { enabled: cfg.enabled, interval: `${cfg.interval_value} ${cfg.interval_unit}`, time: cfg.preferred_run_time.slice(0, 5) },
        after: { enabled: input.enabled, interval: `${input.intervalValue} ${input.intervalUnit}`, time: input.preferredRunTime },
      } });
    return { nextRunAt };
  });
}

export async function setProjectStatus(sql: Sql, actor: Actor, projectId: string, status: "active" | "paused" | "archived") {
  await sql.begin(async (tx) => {
    await tx`update projects set status = ${status}, updated_at = now() where id = ${projectId} and organization_id = ${actor.organizationId}`;
    if (status !== "active") {
      // Waiting jobs stop; running jobs finish their current pass. History is never deleted.
      const cancelled = await tx<{ id: string }[]>`
        update tracking_jobs set status = 'cancelled', completed_at = now(), error_code = 'project_' || ${status}
        where project_id = ${projectId} and status in ('queued', 'awaiting_approval') returning id`;
      if (cancelled.length) {
        await tx`update tracking_job_targets set status = 'skipped', updated_at = now()
          where job_id = any(${cancelled.map((c) => c.id)}::uuid[]) and status = 'pending'`;
      }
    }
    await audit(tx, { organizationId: actor.organizationId, actorUserId: actor.id, action: `project.${status}`, entityType: "project", entityId: projectId });
  });
}
