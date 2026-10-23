import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { projectWizardSchema } from "@/lib/validation";
import { createProject, updateSchedule, setProjectStatus } from "@/server/services/projects";
import { requestOrganicRefresh } from "@/server/services/refresh";
import { upsertBudget } from "@/server/services/admin";
import { approveJob, claimJob, reapStaleJobs } from "@/server/jobs/queue";
import { processSerpJob } from "@/server/jobs/organic";
import { runWorkerPass } from "@/server/jobs/worker";
import { runSchedulerTick } from "@/server/jobs/scheduler";
import { projectRelation } from "@/server/relations";
import { provisionUser } from "@/server/users";
import { clearCredentialCache, credentialStatus, providerValue, refreshProviderCredentials, removeProviderCredentials, saveProviderCredentials } from "@/server/providers/credentials";
import { YepApiProvider } from "@/server/providers/serp/yepapi";
import { createOrgWithAdmin, hasTestDb, off, resetDatabase, teardown, weekly } from "./helpers/db";

const d = hasTestDb ? describe : describe.skip;

d("integration (requires DATABASE_URL_TEST)", () => {
  let sql: postgres.Sql;
  let actor: { id: string; organizationId: string };

  beforeAll(async () => { sql = await resetDatabase(); });
  afterAll(async () => { await teardown(); });
  beforeEach(async () => {
    await sql`truncate organizations, users cascade`;
    actor = await createOrgWithAdmin(sql);
  });

  async function newProject(keywords: string[], opts: { activate?: boolean; competitors?: boolean } = {}) {
    const data = projectWizardSchema.parse({
      project: { name: "Acme Plumbing", domain: "https://www.acmeplumbing.com", clientName: "Acme", businessCategory: "Plumber", country: "us", language: "en", timezone: "America/Chicago" },
      locations: [{ name: "Austin", countryCode: "US", city: "Austin", region: "Texas" }],
      competitors: opts.competitors ? [{ name: "Rival", domain: "rival.com" }] : [],
      keywords: keywords.map((k) => ({ keyword: k, locationIndex: 0, device: "desktop", tags: [] })),
      schedules: { organic: weekly, maps: off, llm: off, citations: off },
      activate: opts.activate ?? false,
    });
    return createProject(sql, actor, data);
  }

  async function jobStatus(id: string) {
    const [j] = await sql<{ status: string; error_code: string | null; attempts: number }[]>`select status, error_code, attempts from tracking_jobs where id = ${id}`;
    return j!;
  }

  it("creates a project with 7-day defaults, independent module configs and deduped keywords", async () => {
    const { projectId } = await newProject(["plumber austin", "Plumber  Austin", "emergency plumber"]);
    const configs = await sql`select module, enabled, interval_value, interval_unit, next_run_at from tracking_configs where project_id = ${projectId} order by module`;
    expect(configs.map((c) => c.module)).toEqual(["citations", "llm", "maps", "organic"]);
    expect(configs.every((c) => c.interval_value === 7 && c.interval_unit === "day")).toBe(true);
    expect(configs.find((c) => c.module === "organic")!.next_run_at).toBeInstanceOf(Date);
    expect(configs.find((c) => c.module === "maps")!.next_run_at).toBeNull();
    const kws = await sql`select keyword from keywords where project_id = ${projectId}`;
    expect(kws).toHaveLength(2);
    const [p] = await sql`select domain from projects where id = ${projectId}`;
    expect(p!.domain).toBe("acmeplumbing.com");
  });

  it("activation enqueues an initial job; repeated refreshes never duplicate active targets", async () => {
    const { projectId, initialJob } = await newProject(["a b", "c d"], { activate: true });
    expect(initialJob?.kind).toBe("queued");
    const again = await requestOrganicRefresh(sql, actor, projectId, null, { confirmed: true });
    expect(again.kind).toBe("duplicate");
    const jobs = await sql`select id from tracking_jobs where project_id = ${projectId}`;
    expect(jobs).toHaveLength(1);
  });

  it("processes a job: stores observations, usage, timestamps; manual refresh leaves the schedule alone", async () => {
    const { projectId } = await newProject(["plumber austin", "not-ranking plumber"], { competitors: true });
    const [before] = await sql<{ next_run_at: Date }[]>`select next_run_at from tracking_configs where project_id = ${projectId} and module = 'organic'`;
    const r = await requestOrganicRefresh(sql, actor, projectId, null, { confirmed: true });
    expect(r.kind).toBe("queued");

    const pass = await runWorkerPass(sql);
    expect(pass.statuses).toEqual(["completed"]);

    const obs = await sql`select o.*, k.keyword from serp_observations o join keywords k on k.id = o.keyword_id order by k.keyword`;
    expect(obs).toHaveLength(2);
    expect(obs.every((o) => o.provider === "mock" && o.collected_at instanceof Date && o.requested_location.startsWith("city:"))).toBe(true);
    const nr = obs.find((o) => o.keyword === "not-ranking plumber")!;
    expect(nr.result_status).toBe("not_found");
    expect(nr.position).toBeNull();
    expect(await sql`select * from serp_competitor_observations`).toHaveLength(2);

    const [usage] = await sql<{ n: number; cost: number }[]>`select count(*)::int as n, sum(actual_cost)::float8 as cost from provider_usage where project_id = ${projectId}`;
    expect(usage!.n).toBe(2);
    expect(usage!.cost).toBeCloseTo(0.004);

    const [after] = await sql<{ next_run_at: Date }[]>`select next_run_at from tracking_configs where project_id = ${projectId} and module = 'organic'`;
    expect(after!.next_run_at.getTime()).toBe(before!.next_run_at.getTime());
  });

  it("keeps successes from a partially failed batch and never records failures as rankings", async () => {
    const { projectId } = await newProject(["good keyword", "fail-invalid keyword"]);
    const r = await requestOrganicRefresh(sql, actor, projectId, null, { confirmed: true });
    if (r.kind !== "queued") throw new Error(r.kind);
    await runWorkerPass(sql);
    expect((await jobStatus(r.jobId)).status).toBe("partial");
    const targets = await sql`select status, error_code from tracking_job_targets where job_id = ${r.jobId} order by status`;
    expect(targets.map((t) => t.status)).toEqual(["failed", "succeeded"]);
    expect(await sql`select * from serp_observations`).toHaveLength(1);
  });

  it("retries transient errors with backoff, then gives up after max attempts", async () => {
    const { projectId } = await newProject(["fail-transient kw"]);
    const r = await requestOrganicRefresh(sql, actor, projectId, null, { confirmed: true });
    if (r.kind !== "queued") throw new Error(r.kind);
    await runWorkerPass(sql);
    const [j] = await sql<{ status: string; run_after: Date }[]>`select status, run_after from tracking_jobs where id = ${r.jobId}`;
    expect(j!.status).toBe("queued");
    expect(j!.run_after.getTime()).toBeGreaterThan(Date.now());
    for (let i = 0; i < 3; i++) {
      await sql`update tracking_jobs set run_after = now() where id = ${r.jobId}`;
      await runWorkerPass(sql);
    }
    expect(await jobStatus(r.jobId)).toMatchObject({ status: "failed", attempts: 4 });
  });

  it("stops the batch on authorization errors instead of retrying", async () => {
    const { projectId } = await newProject(["fail-auth kw", "zz other keyword"]);
    const r = await requestOrganicRefresh(sql, actor, projectId, null, { confirmed: true });
    if (r.kind !== "queued") throw new Error(r.kind);
    const job = (await claimJob(sql, "mock", 10, "test"))!;
    await processSerpJob(sql, job, { workerId: "test", targetConcurrency: 1 });
    expect(await jobStatus(r.jobId)).toMatchObject({ status: "failed", error_code: "mock_auth" });
  });

  it("marks in-flight targets of a dead worker as uncertain and does not re-send them", async () => {
    const { projectId } = await newProject(["k1", "k2"]);
    const r = await requestOrganicRefresh(sql, actor, projectId, null, { confirmed: true });
    if (r.kind !== "queued") throw new Error(r.kind);
    await claimJob(sql, "mock", 10, "dead-worker");
    await sql`update tracking_job_targets set status = 'in_flight' where id = (select id from tracking_job_targets where job_id = ${r.jobId} limit 1)`;
    await sql`update tracking_jobs set locked_at = now() - interval '1 hour' where id = ${r.jobId}`;
    expect(await reapStaleJobs(sql, 60_000)).toBe(1);
    const statuses = (await sql`select status from tracking_job_targets where job_id = ${r.jobId} order by status`).map((t) => t.status);
    expect(statuses).toEqual(["pending", "uncertain"]);
    expect((await jobStatus(r.jobId)).status).toBe("queued");
    await sql`update tracking_jobs set run_after = now() where id = ${r.jobId}`;
    await runWorkerPass(sql);
    expect(await jobStatus(r.jobId)).toMatchObject({ status: "partial" });
    expect(await sql`select * from serp_observations`).toHaveLength(1);
  });

  it("enforces budgets: block, require approval, and admin approval", async () => {
    const { projectId } = await newProject(["k1", "k2"]);
    await upsertBudget(sql, actor, { projectId: null, module: null, monthlyLimit: 0.001, alertThresholdPct: 80, onLimit: "block" });
    expect((await requestOrganicRefresh(sql, actor, projectId, null, { confirmed: true })).kind).toBe("budget_blocked");

    await upsertBudget(sql, actor, { projectId: null, module: null, monthlyLimit: 0.001, alertThresholdPct: 80, onLimit: "require_approval" });
    const r = await requestOrganicRefresh(sql, actor, projectId, null, { confirmed: true });
    expect(r.kind).toBe("awaiting_approval");
    if (r.kind !== "awaiting_approval") return;
    expect((await runWorkerPass(sql)).processed).toBe(0);
    expect(await approveJob(sql, r.jobId, actor.organizationId, actor.id)).toBe(true);
    expect((await runWorkerPass(sql)).statuses).toEqual(["completed"]);
  });

  it("asks for confirmation on material manual refresh costs", async () => {
    process.env.MANUAL_REFRESH_CONFIRM_AMOUNT = "0.001";
    try {
      const { projectId } = await newProject(["k1"]);
      const r = await requestOrganicRefresh(sql, actor, projectId, null, { confirmed: false });
      expect(r.kind).toBe("needs_confirmation");
      expect(await sql`select * from tracking_jobs`).toHaveLength(0);
    } finally {
      delete process.env.MANUAL_REFRESH_CONFIRM_AMOUNT;
    }
  });

  it("scheduler enqueues one recovery run for missed slots and advances next_run_at", async () => {
    const { projectId } = await newProject(["k1"]);
    await sql`update tracking_configs set next_run_at = now() - interval '22 days' where project_id = ${projectId} and module = 'organic'`;
    const r = await runSchedulerTick(sql);
    expect(r.enqueued).toBe(1);
    const jobs = await sql`select trigger from tracking_jobs where project_id = ${projectId}`;
    expect(jobs.map((j) => j.trigger)).toEqual(["recovery"]);
    const [cfg] = await sql<{ next_run_at: Date }[]>`select next_run_at from tracking_configs where project_id = ${projectId} and module = 'organic'`;
    expect(cfg!.next_run_at.getTime()).toBeGreaterThan(Date.now());
    const [log] = await sql`select metadata_json from audit_logs where action = 'schedule.missed'`;
    expect(log!.metadata_json.missed_slots).toBe(3);
    expect((await runSchedulerTick(sql)).enqueued).toBe(0);
  });

  it("changes module schedules independently and audits the change", async () => {
    const { projectId } = await newProject(["k1"]);
    await updateSchedule(sql, actor, projectId, "organic", { enabled: true, intervalValue: 1, intervalUnit: "day", preferredRunTime: "03:00" });
    await updateSchedule(sql, actor, projectId, "maps", { enabled: true, intervalValue: 14, intervalUnit: "day", preferredRunTime: "05:00" });
    const rows = await sql`select module, interval_value, enabled from tracking_configs where project_id = ${projectId} and module in ('organic','maps') order by module`;
    expect(rows.map((r) => [r.module, r.interval_value, r.enabled])).toEqual([["maps", 14, true], ["organic", 1, true]]);
    expect(await sql`select * from audit_logs where action = 'schedule.updated'`).toHaveLength(2);
  });

  it("pausing a project cancels waiting jobs but keeps history", async () => {
    const { projectId } = await newProject(["k1"], { activate: true });
    await runWorkerPass(sql);
    await requestOrganicRefresh(sql, actor, projectId, null, { confirmed: true });
    await setProjectStatus(sql, actor, projectId, "paused");
    expect((await sql`select status from tracking_jobs order by created_at`).map((j) => j.status)).toEqual(["completed", "cancelled"]);
    expect(await sql`select * from serp_observations`).toHaveLength(1);
  });

  it("resolves project access: unassigned members, other orgs and revoked clients are denied", async () => {
    const { projectId } = await newProject(["k1"]);
    const [member] = await sql<{ id: string }[]>`insert into users (email) values ('m@agency.test') returning id`;
    await sql`insert into organization_members (organization_id, user_id, role) values (${actor.organizationId}, ${member!.id}, 'member')`;
    const rel = await projectRelation(sql, { id: member!.id, organizationId: actor.organizationId, role: "member" }, projectId);
    expect(rel!.relation).toEqual({ kind: "org", role: "member", assigned: false });

    const other = await createOrgWithAdmin(sql, "other@else.test");
    expect((await projectRelation(sql, { id: other.id, organizationId: other.organizationId, role: "admin" }, projectId))!.relation.kind).toBe("none");

    const [client] = await sql<{ id: string }[]>`insert into users (email) values ('c@client.test') returning id`;
    const [access] = await sql<{ id: string }[]>`insert into client_project_access (project_id, user_id) values (${projectId}, ${client!.id}) returning id`;
    const cu = { id: client!.id, organizationId: null, role: null };
    expect((await projectRelation(sql, cu, projectId))!.relation).toEqual({ kind: "client", role: "viewer" });
    await sql`update client_project_access set revoked_at = now() where id = ${access!.id}`;
    expect((await projectRelation(sql, cu, projectId))!.relation.kind).toBe("none");
  });

  it("provisions users: bootstrap only when no org exists, invited emails link, strangers are refused", async () => {
    await sql`truncate organizations, users cascade`;
    const first = await provisionUser(sql, "auth-1", "owner@agency.test");
    expect(first).not.toBeNull();
    expect(await provisionUser(sql, "auth-2", "stranger@evil.test")).toBeNull();
    await sql`insert into users (email) values ('invited@agency.test')`;
    expect((await provisionUser(sql, "auth-3", "Invited@agency.test"))?.authentication_user_id).toBe("auth-3");
    // A different identity cannot take over an already-linked account.
    expect(await provisionUser(sql, "auth-4", "owner@agency.test")).toBeNull();
  });

  it("stores provider keys encrypted, write-only, and overriding the environment", async () => {
    process.env.APP_ENCRYPTION_KEY = "test-key-test-key-test-key-1234";
    delete process.env.YEPAPI_API_KEY;
    clearCredentialCache();
    expect(new YepApiProvider().isConfigured()).toBe(false);
    await saveProviderCredentials(sql, "yepapi", actor.id, { apiKey: "yep_sk_abcdef123456", pricePerPage: "0.02" });
    const [row] = await sql<{ secrets_enc: string; hints_json: Record<string, string> }[]>`select secrets_enc, hints_json from provider_credentials where provider_id = 'yepapi'`;
    expect(row!.secrets_enc).not.toContain("abcdef");
    expect(row!.hints_json.apiKey).toBe("3456");
    expect(new YepApiProvider().isConfigured()).toBe(true);
    expect(new YepApiProvider().pricePerUnit()).toBe(0.02);
    // blank secret keeps the saved one; the UI status never exposes it
    await saveProviderCredentials(sql, "yepapi", actor.id, { apiKey: "", pricePerPage: "" });
    expect(providerValue("yepapi", "apiKey")).toBe("yep_sk_abcdef123456");
    expect(JSON.stringify(credentialStatus("yepapi"))).not.toContain("abcdef");
    clearCredentialCache();
    await refreshProviderCredentials(sql, true);
    expect(new YepApiProvider().isConfigured()).toBe(true);
    await removeProviderCredentials(sql, "yepapi");
    expect(new YepApiProvider().isConfigured()).toBe(false);
    await expect(saveProviderCredentials(sql, "nope", actor.id, {})).rejects.toThrow();
    delete process.env.APP_ENCRYPTION_KEY;
    await expect(saveProviderCredentials(sql, "yepapi", actor.id, { apiKey: "x".repeat(20) })).rejects.toThrow(/APP_ENCRYPTION_KEY/);
  });

  it("pays for a few pages when a keyword ranked before, escalates on a miss, and reuses cached searches", async () => {
    process.env.APP_ENCRYPTION_KEY = "test-key-test-key-test-key-1234";
    process.env.YEPAPI_API_KEY = "k";
    clearCredentialCache();
    const { projectId } = await newProject(["plumber austin"], { activate: true });
    const [kw] = await sql<{ id: string }[]>`select id from keywords where project_id = ${projectId}`;
    const [job0] = await sql<{ id: string }[]>`select id from tracking_jobs where project_id = ${projectId} order by created_at limit 1`;
    await sql`insert into serp_observations (keyword_id, job_id, provider, requested_location, device, result_depth, collected_at, result_status, position, result_metadata_json)
      values (${kw!.id}, ${job0!.id}, 'yepapi', 'x', 'desktop', 100, now() - interval '7 days', 'ranked', 3, '{}')`;
    const calls: number[] = [];
    const items = (depth: number, withTarget: boolean) => Array.from({ length: depth }, (_, i) => ({ position: i + 1, title: "t", url: withTarget && i + 1 === 4 ? "https://acmeplumbing.com/x" : `https://other${i}.com/` }));
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_u: unknown, init: RequestInit) => {
      const depth = JSON.parse(String(init.body)).depth as number;
      calls.push(depth);
      return new Response(JSON.stringify({ ok: true, data: { items: items(depth, depth >= 20) } }), { status: 200 });
    }) as typeof fetch;
    try {
      await sql`delete from serp_cache`;
      const { enqueueOrganic, loadDepthPlans } = await import("@/server/jobs/organic");
      const { YepApiProvider } = await import("@/server/providers/serp/yepapi");
      const plans = await loadDepthPlans(sql, new YepApiProvider(), [kw!.id], 100, false, new Date());
      expect(plans.get(kw!.id)).toMatchObject({ depth: 10, escalate: true });
      await sql`update tracking_jobs set status = 'cancelled' where project_id = ${projectId}`;
      await enqueueOrganic(sql, { projectId, keywordIds: null, trigger: "manual", requestedByUserId: actor.id });
      await runWorkerPass(sql);
      // first call 1 page misses (target is at 4 only in deeper SERPs), then the full-depth repeat finds it
      expect(calls).toEqual([10, 100]);
      const [obs] = await sql<{ result_status: string; position: number; result_depth: number }[]>`select result_status, position, result_depth from serp_observations where keyword_id = ${kw!.id} order by collected_at desc limit 1`;
      expect(obs).toMatchObject({ result_status: "ranked", position: 4, result_depth: 100 });
      const [u] = await sql<{ units: number; saved: number }[]>`select sum(units_requested)::float8 as units, sum(saved_units)::float8 as saved from provider_usage where project_id = ${projectId}`;
      expect(u!.units).toBe(11);
      // an immediate second refresh is served entirely from the cache: no new paid calls
      await enqueueOrganic(sql, { projectId, keywordIds: null, trigger: "manual", requestedByUserId: actor.id });
      calls.length = 0;
      await runWorkerPass(sql);
      expect(calls).toEqual([]);
      const [u2] = await sql<{ units: number; saved: number }[]>`select sum(units_requested)::float8 as units, sum(saved_units)::float8 as saved from provider_usage where project_id = ${projectId}`;
      expect(u2!.units).toBe(11);
      expect(u2!.saved).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.YEPAPI_API_KEY;
      delete process.env.APP_ENCRYPTION_KEY;
      clearCredentialCache();
    }
  });

  it("stops starting keywords at the deadline and hands the job back without using an attempt", async () => {
    const { projectId } = await newProject(["a b", "c d"], { activate: true });
    const [job] = await sql<{ id: string }[]>`select id from tracking_jobs where project_id = ${projectId} and status = 'queued'`;
    const claimed = await claimJob(sql, "mock", 10, "w1");
    expect(claimed?.id).toBe(job!.id);
    const status = await processSerpJob(sql, claimed!, { workerId: "w1", deadlineAt: Date.now() - 1 });
    expect(status).toBe("queued");
    const [after] = await sql<{ attempts: number }[]>`select attempts from tracking_jobs where id = ${job!.id}`;
    expect(after!.attempts).toBe(0);
    const [pending] = await sql<{ n: number }[]>`select count(*)::int as n from tracking_job_targets where job_id = ${job!.id} and status = 'pending'`;
    expect(pending!.n).toBe(2);
  });
});
