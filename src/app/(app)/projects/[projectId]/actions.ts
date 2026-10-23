"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { normalizeTags, parseKeywordCsv } from "@/lib/keywords";
import { normalizeDomain } from "@/lib/domain";
import { competitorSchema, locationSchema, MODULES, scheduleSchema } from "@/lib/validation";
import { isValidTimezone } from "@/lib/schedule";
import { requireProjectAccess } from "@/server/authz";
import { sql } from "@/server/db";
import { audit } from "@/server/audit";
import { rateLimit } from "@/server/rate-limit";
import { insertKeywords, insertLocation, setProjectStatus, updateSchedule } from "@/server/services/projects";
import { requestOrganicRefresh, type RefreshResult } from "@/server/services/refresh";
import { setAssignment } from "@/server/services/admin";

export interface ActionState { ok?: boolean; error?: string; message?: string }

const uuid = z.string().uuid();
const uuids = z.array(uuid).max(5000);

async function staffActor(projectId: string, action: Parameters<typeof requireProjectAccess>[1]) {
  const { user, organizationId } = await requireProjectAccess(uuid.parse(projectId), action);
  return { id: user.id, organizationId };
}

export async function refreshAction(projectId: string, keywordIds: string[] | null, confirmed: boolean): Promise<RefreshResult | { kind: "rate_limited" }> {
  const actor = await staffActor(projectId, "scan.manual");
  if (!rateLimit(`refresh:${actor.id}`, 20, 60_000).ok) return { kind: "rate_limited" };
  const ids = keywordIds === null ? null : uuids.parse(keywordIds);
  const result = await requestOrganicRefresh(sql, actor, projectId, ids, { confirmed });
  revalidatePath(`/projects/${projectId}`, "layout");
  return result;
}

export async function addKeywordsAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const actor = await staffActor(projectId, "keyword.manage");
  const locationId = uuid.safeParse(form.get("locationId"));
  if (!locationId.success) return { error: "Choose a location" };
  const [loc] = await sql`select 1 from project_locations where id = ${locationId.data} and project_id = ${projectId}`;
  if (!loc) return { error: "Unknown location" };
  const [project] = await sql<{ language: string }[]>`select language from projects where id = ${projectId}`;

  const deviceChoice = String(form.get("device") ?? "desktop");
  const devices: ("desktop" | "mobile")[] = deviceChoice === "both" ? ["desktop", "mobile"] : deviceChoice === "mobile" ? ["mobile"] : ["desktop"];
  const extraTags = normalizeTags(String(form.get("tags") ?? "").split(","));
  let text = String(form.get("keywords") ?? "");
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 2_000_000) return { error: "CSV file too large (max 2 MB)" };
    text = await file.text();
  }
  const { rows, errors } = parseKeywordCsv(text);
  if (rows.length === 0) return { error: errors[0] ? `Row ${errors[0].row}: ${errors[0].message}` : "Enter at least one keyword" };

  const locations = await sql<{ id: string; name: string }[]>`select id, name from project_locations where project_id = ${projectId}`;
  const items = rows.flatMap((r) => {
    const named = r.location ? locations.find((l) => l.name.toLowerCase() === r.location!.toLowerCase()) : undefined;
    return (r.device ? [r.device] : devices).map((device) => ({
      keyword: r.keyword.trim().replace(/\s+/g, " "),
      locationId: named?.id ?? locationId.data,
      searchEngine: "google",
      language: r.language ?? project!.language,
      device,
      targetUrl: r.targetUrl ?? null,
      tags: normalizeTags([...r.tags, ...extraTags]),
    }));
  });
  const res = await insertKeywords(sql, projectId, items);
  await audit(sql, { organizationId: actor.organizationId, actorUserId: actor.id, action: "keywords.added", entityType: "project", entityId: projectId, metadata: { inserted: res.inserted, duplicates: res.duplicates } });
  revalidatePath(`/projects/${projectId}`, "layout");
  const errNote = errors.length ? ` ${errors.length} row(s) rejected (first: row ${errors[0]!.row}, ${errors[0]!.message}).` : "";
  return { ok: true, message: `${res.inserted} keyword configuration(s) added, ${res.duplicates} duplicate(s) skipped.${errNote}` };
}

const bulkSchema = z.object({
  ids: uuids.min(1, "Select at least one keyword"),
  op: z.enum(["pause", "resume", "delete", "tag", "untag"]),
  tag: z.string().optional(),
});

export async function bulkKeywordAction(projectId: string, input: z.input<typeof bulkSchema>): Promise<ActionState> {
  const actor = await staffActor(projectId, "keyword.manage");
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { ids, op } = parsed.data;
  const tag = normalizeTags([parsed.data.tag ?? ""])[0];
  let n = 0;
  if (op === "pause" || op === "resume") {
    n = (await sql`update keywords set is_active = ${op === "resume"} where project_id = ${projectId} and id = any(${ids}::uuid[]) returning id`).length;
  } else if (op === "delete") {
    n = (await sql`delete from keywords where project_id = ${projectId} and id = any(${ids}::uuid[]) returning id`).length;
  } else {
    if (!tag) return { error: "Enter a tag" };
    n = op === "tag"
      ? (await sql`update keywords set tags = array_append(tags, ${tag}) where project_id = ${projectId} and id = any(${ids}::uuid[]) and not (${tag} = any(tags)) returning id`).length
      : (await sql`update keywords set tags = array_remove(tags, ${tag}) where project_id = ${projectId} and id = any(${ids}::uuid[]) returning id`).length;
  }
  await audit(sql, { organizationId: actor.organizationId, actorUserId: actor.id, action: `keywords.${op}`, entityType: "project", entityId: projectId, metadata: { count: n, tag } });
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true, message: `${n} keyword(s) updated.` };
}

export async function updateScheduleAction(projectId: string, module: string, input: z.input<typeof scheduleSchema>): Promise<ActionState> {
  const actor = await staffActor(projectId, "schedule.update");
  const m = z.enum(MODULES).safeParse(module);
  const s = scheduleSchema.safeParse(input);
  if (!m.success || !s.success) return { error: s.error?.issues[0]?.message ?? "Invalid module" };
  await updateSchedule(sql, actor, projectId, m.data, s.data);
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true, message: "Schedule saved." };
}

const detailsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  domain: z.string().trim().min(1).transform(normalizeDomain).refine((d) => /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d), "Invalid domain"),
  businessCategory: z.string().trim().max(120),
  timezone: z.string().refine(isValidTimezone, "Unknown time zone"),
  language: z.string().trim().min(2).max(10),
  notes: z.string().max(5000),
});

export async function updateProjectAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const actor = await staffActor(projectId, "project.update");
  const p = detailsSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  await sql.begin(async (tx) => {
    await tx`update projects set name = ${p.data.name}, domain = ${p.data.domain}, business_category = ${p.data.businessCategory || null},
      timezone = ${p.data.timezone}, language = ${p.data.language}, notes = ${p.data.notes || null}, updated_at = now() where id = ${projectId}`;
    // Schedules follow the project time zone.
    await tx`update tracking_configs set timezone = ${p.data.timezone} where project_id = ${projectId}`;
    await audit(tx, { organizationId: actor.organizationId, actorUserId: actor.id, action: "project.updated", entityType: "project", entityId: projectId, metadata: p.data });
  });
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true, message: "Project saved." };
}

function locationFromForm(form: FormData) {
  const raw = Object.fromEntries(form) as Record<string, string>;
  return locationSchema.safeParse({ ...raw, latitude: raw.latitude ?? "", longitude: raw.longitude ?? "" });
}

export async function addLocationAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const actor = await staffActor(projectId, "project.update");
  const loc = locationFromForm(form);
  if (!loc.success) return { error: loc.error.issues[0]?.message };
  const id = await insertLocation(sql, projectId, loc.data, false);
  await audit(sql, { organizationId: actor.organizationId, actorUserId: actor.id, action: "location.added", entityType: "project_location", entityId: id });
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true, message: "Location added." };
}

export async function updateLocationAction(projectId: string, locationId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const actor = await staffActor(projectId, "project.update");
  const loc = locationFromForm(form);
  if (!loc.success) return { error: loc.error.issues[0]?.message };
  const l = loc.data;
  await sql`update project_locations set name = ${l.name}, business_name = ${l.businessName ?? null}, address = ${l.address ?? null}, phone = ${l.phone ?? null},
    country_code = ${l.countryCode}, region = ${l.region ?? null}, city = ${l.city ?? null}, postal_code = ${l.postalCode ?? null},
    latitude = ${l.latitude ?? null}, longitude = ${l.longitude ?? null}, google_domain = ${l.googleDomain},
    google_business_profile_reference = ${l.googleBusinessProfileReference ?? null}
    where id = ${uuid.parse(locationId)} and project_id = ${projectId}`;
  await audit(sql, { organizationId: actor.organizationId, actorUserId: actor.id, action: "location.updated", entityType: "project_location", entityId: locationId, metadata: l });
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true, message: "Location saved. New targeting applies to future collections only." };
}

export async function deleteLocationAction(projectId: string, locationId: string): Promise<ActionState> {
  const actor = await staffActor(projectId, "project.update");
  const [loc] = await sql<{ is_primary: boolean; n: number }[]>`
    select is_primary, (select count(*)::int from keywords where location_id = l.id) as n from project_locations l where id = ${uuid.parse(locationId)} and project_id = ${projectId}`;
  if (!loc) return { error: "Location not found" };
  if (loc.is_primary) return { error: "The primary location cannot be removed." };
  if (loc.n > 0) return { error: `${loc.n} keyword(s) use this location. Delete or move them first.` };
  await sql`delete from project_locations where id = ${locationId}`;
  await audit(sql, { organizationId: actor.organizationId, actorUserId: actor.id, action: "location.deleted", entityType: "project_location", entityId: locationId });
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

export async function addCompetitorAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const actor = await staffActor(projectId, "project.update");
  const c = competitorSchema.safeParse({ name: form.get("name"), domain: form.get("domain") || undefined });
  if (!c.success) return { error: c.error.issues[0]?.message };
  const rows = await sql`insert into competitors (project_id, name, domain) values (${projectId}, ${c.data.name}, ${c.data.domain ?? null}) on conflict do nothing returning id`;
  if (rows.length === 0) return { error: "That competitor domain is already tracked." };
  await audit(sql, { organizationId: actor.organizationId, actorUserId: actor.id, action: "competitor.added", entityType: "competitor", entityId: rows[0]!.id as string });
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true, message: "Competitor added. Positions are captured from the next collection." };
}

export async function deleteCompetitorAction(projectId: string, competitorId: string): Promise<ActionState> {
  const actor = await staffActor(projectId, "project.update");
  await sql`delete from competitors where id = ${uuid.parse(competitorId)} and project_id = ${projectId}`;
  await audit(sql, { organizationId: actor.organizationId, actorUserId: actor.id, action: "competitor.deleted", entityType: "competitor", entityId: competitorId });
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

export async function setStatusAction(projectId: string, status: "active" | "paused" | "archived"): Promise<void> {
  const actor = await staffActor(projectId, status === "archived" ? "project.archive" : "project.update");
  await setProjectStatus(sql, actor, projectId, z.enum(["active", "paused", "archived"]).parse(status));
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`, "layout");
  if (status === "archived") redirect("/projects");
}

export async function setAssignmentAction(projectId: string, userId: string, assigned: boolean): Promise<ActionState> {
  const actor = await staffActor(projectId, "member.manage");
  await setAssignment(sql, actor, projectId, uuid.parse(userId), assigned);
  revalidatePath(`/projects/${projectId}/settings`);
  return { ok: true };
}
