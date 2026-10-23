import { describe, expect, it } from "vitest";
import { advanceSchedule, firstRunAt } from "@/lib/schedule";
import { averagePosition, rankChange, rankDistribution, formatRankChange } from "@/lib/ranking";
import { generateGrid, gridMetrics } from "@/lib/grid";
import { checkBudget, estimateLlm, estimateMaps, estimateOrganic } from "@/lib/cost";
import { dedupeKeywordConfigs, parseKeywordCsv, csvCell, normalizeKeyword } from "@/lib/keywords";
import { canOrg, canProject } from "@/lib/permissions";
import { normalizeDomain, urlMatchesDomain, isValidDomain } from "@/lib/domain";
import { backoffDelayMs, parseRetryAfter } from "@/lib/retry";
import { alternatePoolerUrl, connectionOptions } from "@/server/db";

describe("schedule", () => {
  const spec = { intervalValue: 7, intervalUnit: "day" as const, preferredRunTime: "06:00", timezone: "America/Chicago" };

  it("first run is the next preferred local time, stored in UTC", () => {
    // 2026-03-02 10:00 Chicago (CST, UTC-6) → already past 06:00, so next day 06:00 CST = 12:00Z
    const now = new Date("2026-03-02T16:00:00Z");
    expect(firstRunAt(spec, now).toISOString()).toBe("2026-03-03T12:00:00.000Z");
    // 05:00 local → today at 06:00
    expect(firstRunAt(spec, new Date("2026-03-02T11:00:00Z")).toISOString()).toBe("2026-03-02T12:00:00.000Z");
  });

  it("keeps the local wall-clock time across DST changes", () => {
    // DST starts 2026-03-08 in the US. 06:00 CDT = 11:00Z.
    const due = new Date("2026-03-03T12:00:00Z");
    const r = advanceSchedule(spec, due, new Date("2026-03-03T12:00:01Z"));
    expect(r.nextRunAt.toISOString()).toBe("2026-03-10T11:00:00.000Z");
    expect(r.missedSlots).toBe(0);
  });

  it("counts missed slots without backfilling", () => {
    const due = new Date("2026-01-05T12:00:00Z");
    const r = advanceSchedule(spec, due, new Date("2026-01-27T00:00:00Z"));
    expect(r.missedSlots).toBe(3); // Jan 12, 19 and 26 (06:00 local) all passed
    expect(r.nextRunAt.toISOString()).toBe("2026-02-02T12:00:00.000Z");
  });

  it("supports monthly intervals and rejects bad input", () => {
    const m = { ...spec, intervalValue: 1, intervalUnit: "month" as const, timezone: "UTC" };
    expect(advanceSchedule(m, new Date("2026-01-31T06:00:00Z"), new Date("2026-01-31T07:00:00Z")).nextRunAt.toISOString())
      .toBe("2026-02-28T06:00:00.000Z");
    expect(() => firstRunAt({ ...spec, timezone: "Mars/Base" }, new Date())).toThrow();
    expect(() => firstRunAt({ ...spec, preferredRunTime: "25:00" }, new Date())).toThrow();
  });
});

describe("ranking", () => {
  it("computes changes including entering and dropping out", () => {
    expect(rankChange({ status: "ranked", position: 3 }, { status: "ranked", position: 7 })).toEqual({ kind: "moved", from: 7, to: 3, delta: 4 });
    expect(rankChange({ status: "not_found", depth: 100 }, { status: "ranked", position: 7 })).toEqual({ kind: "dropped_out", from: 7 });
    expect(rankChange({ status: "ranked", position: 9 }, { status: "not_found", depth: 100 })).toEqual({ kind: "entered", to: 9 });
    expect(rankChange({ status: "ranked", position: 9 }, null)).toEqual({ kind: "new" });
    expect(rankChange(null, null)).toEqual({ kind: "no_data" });
    expect(formatRankChange({ kind: "moved", from: 10, to: 12, delta: -2 })).toBe("▼ 2");
  });

  it("never treats missing or not-found as a position", () => {
    const ranks = [{ status: "ranked" as const, position: 2 }, { status: "ranked" as const, position: 12 }, { status: "not_found" as const, depth: 100 }, null];
    expect(averagePosition(ranks)).toEqual({ average: 7, counted: 2 });
    const d = rankDistribution(ranks);
    expect(d.buckets.top3).toBe(1);
    expect(d.buckets.top20).toBe(1);
    expect(d.buckets.notFound).toBe(1);
    expect(d.noData).toBe(1);
    expect(d.measured).toBe(3);
  });
});

describe("grid", () => {
  it("generates a centred grid with correct spacing", () => {
    const pts = generateGrid(30, -97, 3, 3, 1000);
    expect(pts).toHaveLength(9);
    const center = pts.find((p) => p.row === 1 && p.col === 1)!;
    expect(center).toMatchObject({ lat: 30, lng: -97 });
    const north = pts.find((p) => p.row === 0 && p.col === 1)!;
    expect((north.lat - 30) * 111_195).toBeCloseTo(1000, -1); // ~1km north
    expect(() => generateGrid(30, -97, 0, 3, 1000)).toThrow();
  });

  it("excludes failed points from metrics", () => {
    const m = gridMetrics([
      { status: "ranked", position: 1 }, { status: "ranked", position: 5 }, { status: "not_found" }, { status: "failed" },
    ], 20);
    expect(m).toMatchObject({ validPoints: 3, failedPoints: 1, averagePosition: 3, top3Pct: 33.3, top10Pct: 66.7, resultDepth: 20 });
    expect(gridMetrics([{ status: "failed" }], 20).averagePosition).toBeNull();
  });
});

describe("cost", () => {
  it("estimates per PRD formulas and refuses to guess unknown prices", () => {
    expect(estimateOrganic(50, 1, { pricePerUnit: 0.002, currency: "USD" })).toEqual({ units: 50, amount: 0.1, currency: "USD" });
    expect(estimateOrganic(50, 1, { pricePerUnit: null, currency: "USD" }).amount).toBeNull();
    expect(estimateMaps(5, 5, 3, 1, { pricePerUnit: null, currency: "USD" }).units).toBe(75);
    expect(estimateLlm(10, 2, 3, { pricePerUnit: 0.01, currency: "USD" }).amount).toBe(0.6);
  });

  it("checks budgets", () => {
    expect(checkBudget({ limit: 100, spent: 50, alertThresholdPct: 80 }, 10)).toMatchObject({ allowed: true, warning: false });
    expect(checkBudget({ limit: 100, spent: 75, alertThresholdPct: 80 }, 10)).toMatchObject({ allowed: true, warning: true });
    expect(checkBudget({ limit: 100, spent: 95, alertThresholdPct: 80 }, 10)).toMatchObject({ allowed: false, reason: "would_exceed" });
    expect(checkBudget({ limit: 100, spent: 100, alertThresholdPct: 80 }, null)).toMatchObject({ allowed: false, reason: "limit_reached" });
  });
});

describe("keywords", () => {
  it("dedupes only identical configurations", () => {
    const base = { locationId: "L1", searchEngine: "google", language: "en", device: "desktop" as const };
    const { unique, duplicates } = dedupeKeywordConfigs([
      { ...base, keyword: "Plumber  Austin" },
      { ...base, keyword: "plumber austin" },
      { ...base, keyword: "plumber austin", device: "mobile" },
      { ...base, keyword: "plumber austin", locationId: "L2" },
    ]);
    expect(unique).toHaveLength(3);
    expect(duplicates).toHaveLength(1);
    expect(normalizeKeyword("  Café   Near ME ")).toBe("café near me");
  });

  it("parses CSV with header, validation and plain lists", () => {
    const { rows, errors } = parseKeywordCsv("keyword,device,tags,target_url\nplumber austin,mobile,emergency;Local,https://x.com/a\n,desktop,,\nbad,tablet,,\n");
    expect(rows).toEqual([{ keyword: "plumber austin", device: "mobile", tags: ["emergency", "local"], targetUrl: "https://x.com/a", location: undefined, language: undefined }]);
    expect(errors.map((e) => e.row)).toEqual([3, 4]);
    expect(parseKeywordCsv("one\ntwo\n").rows.map((r) => r.keyword)).toEqual(["one", "two"]);
  });

  it("neutralizes CSV formula injection", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });
});

describe("permissions", () => {
  it("enforces role boundaries", () => {
    expect(canOrg("admin", "budget.manage")).toBe(true);
    expect(canOrg("manager", "budget.manage")).toBe(false);
    expect(canOrg("manager", "project.create")).toBe(true);
    expect(canOrg("member", "project.create")).toBe(false);
    expect(canProject({ kind: "org", role: "member", assigned: false }, "project.view")).toBe(false);
    expect(canProject({ kind: "org", role: "member", assigned: true }, "scan.manual")).toBe(true);
    expect(canProject({ kind: "org", role: "manager", assigned: false }, "keyword.manage")).toBe(true);
    expect(canProject({ kind: "org", role: "manager", assigned: false }, "client_access.manage")).toBe(false);
    expect(canProject({ kind: "client", role: "viewer" }, "project.view")).toBe(true);
    expect(canProject({ kind: "client", role: "viewer" }, "scan.manual")).toBe(false);
    expect(canProject({ kind: "client", role: "viewer_with_refresh" }, "scan.manual")).toBe(true);
    expect(canProject({ kind: "client", role: "viewer" }, "keyword.manage")).toBe(false);
    expect(canProject({ kind: "none" }, "project.view")).toBe(false);
  });
});

describe("domain & retry", () => {
  it("normalizes and matches domains", () => {
    expect(normalizeDomain("HTTPS://www.Example.com/path?q")).toBe("example.com");
    expect(urlMatchesDomain("https://blog.example.com/x", "example.com")).toBe(true);
    expect(urlMatchesDomain("https://notexample.com/x", "example.com")).toBe(false);
    expect(isValidDomain("example")).toBe(false);
    expect(isValidDomain("sub.example.co.uk")).toBe(true);
  });

  it("backs off exponentially with a cap and parses Retry-After", () => {
    expect(backoffDelayMs(1, 1000, 60_000, () => 1)).toBe(1000);
    expect(backoffDelayMs(3, 1000, 60_000, () => 1)).toBe(4000);
    expect(backoffDelayMs(20, 1000, 60_000, () => 1)).toBe(60_000);
    expect(parseRetryAfter("120")).toBe(120_000);
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT", Date.parse("Wed, 21 Oct 2026 07:27:00 GMT"))).toBe(60_000);
    expect(parseRetryAfter(null)).toBeNull();
  });
});

describe("database connection options", () => {
  it("uses TLS for Supabase and disables prepared statements on the transaction pooler", () => {
    expect(connectionOptions("postgresql://postgres.abc:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres")).toEqual({ ssl: "require", prepare: false });
    expect(connectionOptions("postgresql://postgres:pw@db.abc.supabase.co:5432/postgres")).toEqual({ ssl: "require", prepare: true });
    expect(connectionOptions("postgres://u:p@localhost:5432/db")).toEqual({ ssl: false, prepare: true });
    expect(connectionOptions("postgres://u:p@host:5432/db?sslmode=require")).toMatchObject({ ssl: "require" });
    expect(() => connectionOptions("not a url")).toThrow();
  });
});

describe("supabase pooler fallback", () => {
  it("swaps between aws-0 and aws-1 clusters only for Supabase poolers", () => {
    expect(alternatePoolerUrl("postgresql://u.ref:p@aws-0-ap-south-1.pooler.supabase.com:6543/postgres")).toBe("postgresql://u.ref:p@aws-1-ap-south-1.pooler.supabase.com:6543/postgres");
    expect(alternatePoolerUrl("postgresql://u.ref:p@aws-1-ap-south-1.pooler.supabase.com:6543/postgres")).toContain("aws-0-");
    expect(alternatePoolerUrl("postgres://u:p@localhost:5432/db")).toBeNull();
  });
});

describe("provider credentials", () => {
  it("encrypts secrets round-trip and rejects tampering or a wrong key", async () => {
    const { encryptSecrets, decryptSecrets } = await import("@/server/providers/credentials");
    process.env.APP_ENCRYPTION_KEY = "test-key-test-key-test-key-1234";
    const blob = encryptSecrets({ apiKey: "yep_sk_secret" });
    expect(blob).not.toContain("yep_sk_secret");
    expect(decryptSecrets(blob)).toEqual({ apiKey: "yep_sk_secret" });
    expect(() => decryptSecrets(blob.slice(0, -2) + "AA")).toThrow();
    process.env.APP_ENCRYPTION_KEY = "another-key-another-key-0000000";
    expect(() => decryptSecrets(blob)).toThrow();
    delete process.env.APP_ENCRYPTION_KEY;
  });
});

describe("yepapi adapter", () => {
  const req = {
    keyword: "plumber austin", language: "en", device: "mobile" as const, googleDomain: "google.com", depth: 30,
    targetDomain: "acme.com", competitorDomains: [{ id: "c1", domain: "rival.com" }],
    location: { countryCode: "US", city: "Austin", region: "Texas" },
  };

  it("builds country and city requests and prices per 10 results", async () => {
    const { buildYepApiBody, YepApiProvider } = await import("@/server/providers/serp/yepapi");
    expect(buildYepApiBody(req)).toEqual({
      body: { query: "plumber austin", depth: 30, device: "mobile", language: "en", location_name: "Austin,Texas,United States" },
      requestedLocation: "city: Austin,Texas,United States",
    });
    expect(buildYepApiBody({ ...req, location: { countryCode: "GB" } }).body).toMatchObject({ location: "gb" });
    const p = new YepApiProvider();
    expect(p.unitsPerRequest(30)).toBe(3);
    expect(p.unitsPerRequest(100)).toBe(10);
    expect(p.pricePerUnit()).toBe(0.01);
  });

  it("parses positions, verified absence, and maps error codes", async () => {
    const { parseYepApiResponse, classifyYepApiError } = await import("@/server/providers/serp/yepapi");
    const ok = { ok: true, data: { totalResults: 99, items: [
      { position: 1, title: "A", url: "https://rival.com/x", domain: "rival.com" },
      { position: 4, title: "Acme", url: "https://www.acme.com/plumber", domain: "acme.com" },
    ] } };
    const r = parseYepApiResponse(ok, req, "country: US");
    expect(r).toMatchObject({ position: 4, rankingUrl: "https://www.acme.com/plumber", unitsConsumed: 3, actualCost: null });
    expect(r.competitors).toEqual([{ id: "c1", position: 1, url: "https://rival.com/x" }]);
    expect(parseYepApiResponse({ ok: true, data: { items: [{ position: 1, url: "https://rival.com/x" }] } }, req, "x").position).toBeNull();
    // an empty result list is never recorded as "not ranking"
    expect(() => parseYepApiResponse({ ok: true, data: { items: [] } }, req, "x")).toThrowError(/no usable results/);
    // tolerated field aliases
    expect(parseYepApiResponse({ ok: true, data: { items: [{ rank: 2, link: "https://acme.com/a" }] } }, req, "x").position).toBe(2);
    expect(() => parseYepApiResponse({ ok: false, error: { code: "NO_CREDITS", message: "empty" } }, req, "x")).toThrowError(/empty/);
    expect(classifyYepApiError("INVALID_API_KEY", "x").kind).toBe("auth");
    expect(classifyYepApiError("NO_CREDITS", "x").kind).toBe("insufficient_funds");
    expect(classifyYepApiError("VALIDATION_ERROR", "x").kind).toBe("invalid_request");
    expect(classifyYepApiError("RATE_LIMITED_UPSTREAM", "x").retryable).toBe(true);
    expect(classifyYepApiError("UPSTREAM_TIMEOUT", "x").retryable).toBe(true);
  });
});

describe("adaptive depth plan", () => {
  const base = { maxDepth: 100, pageSize: 10, baselineDepth: 30, probeDepth: 30, fullCheckDays: 28, bufferRanks: 5, competitorFloor: null, now: new Date("2026-10-23T00:00:00Z") };
  it("checks near the last rank, then escalates only on a miss", async () => {
    const { planDepth } = await import("@/lib/depth-plan");
    expect(planDepth(null, null, base)).toEqual({ depth: 30, reason: "baseline", escalate: false });
    expect(planDepth({ status: "ranked", position: 3 }, null, base)).toEqual({ depth: 10, reason: "near_last_rank", escalate: true });
    expect(planDepth({ status: "ranked", position: 8 }, null, base).depth).toBe(20);
    expect(planDepth({ status: "ranked", position: 97 }, null, base)).toMatchObject({ depth: 100, escalate: false });
  });
  it("probes keywords that were not found and re-checks fully when stale", async () => {
    const { planDepth } = await import("@/lib/depth-plan");
    const nf = { status: "not_found" as const, position: null };
    expect(planDepth(nf, new Date("2026-10-10T00:00:00Z"), base)).toEqual({ depth: 30, reason: "probe", escalate: false });
    expect(planDepth(nf, new Date("2026-08-01T00:00:00Z"), base)).toMatchObject({ depth: 100, reason: "periodic_full" });
    expect(planDepth(nf, null, base).depth).toBe(100);
    expect(planDepth(null, null, { ...base, baselineDepth: 100 }).depth).toBe(100);
  });
  it("keeps a minimum depth when competitors are tracked", async () => {
    const { planDepth } = await import("@/lib/depth-plan");
    expect(planDepth({ status: "ranked", position: 3 }, null, { ...base, competitorFloor: 30 })).toMatchObject({ depth: 30, reason: "competitor_floor", escalate: true });
  });
});

describe("google domain input", () => {
  it("accepts pasted URLs and blank, rejects non-Google domains", async () => {
    const { projectWizardSchema } = await import("@/lib/validation");
    const loc = (googleDomain: string) => projectWizardSchema.shape.locations.element.safeParse({ name: "A", countryCode: "US", googleDomain });
    for (const v of ["https://www.google.com/", "Google.co.uk", " google.com ", ""]) expect(loc(v).success, v).toBe(true);
    expect((loc("https://www.google.com/").data as { googleDomain: string }).googleDomain).toBe("google.com");
    expect((loc("").data as { googleDomain: string }).googleDomain).toBe("google.com");
    expect(loc("hawktowingandauto.com").success).toBe(false);
  });
});
