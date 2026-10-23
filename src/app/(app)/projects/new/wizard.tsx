"use client";

import { useMemo, useState, useTransition } from "react";
import { parseKeywordCsv, normalizeTags, dedupeKeywordConfigs } from "@/lib/keywords";
import { describeInterval, type IntervalUnit } from "@/lib/schedule";
import { ScheduleEditor, type Sched } from "@/components/schedule-editor";
import { formatMoney } from "@/lib/cost";
import type { ProjectWizardInput } from "@/lib/validation";
import { createProjectAction } from "./actions";

type Device = "desktop" | "mobile";
interface Loc {
  name: string; businessName: string; address: string; phone: string; countryCode: string; region: string; city: string;
  postalCode: string; latitude: string; longitude: string; googleDomain: string; googleBusinessProfileReference: string;
}
interface Kw { keyword: string; locationIndex: number; device: Device; targetUrl?: string; tags: string[] }

const STEPS = ["Project details", "Data sources", "Locations", "Keywords", "Schedules", "Review"];
const COUNTRIES: [string, string][] = [["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"], ["AU", "Australia"], ["IE", "Ireland"], ["NZ", "New Zealand"], ["IN", "India"], ["BD", "Bangladesh"], ["DE", "Germany"], ["FR", "France"], ["ES", "Spain"], ["IT", "Italy"], ["NL", "Netherlands"], ["AE", "United Arab Emirates"], ["SG", "Singapore"], ["ZA", "South Africa"]];
const LANGUAGES: [string, string][] = [["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["it", "Italian"], ["nl", "Dutch"], ["pt", "Portuguese"], ["bn", "Bengali"], ["hi", "Hindi"], ["ar", "Arabic"]];
const MODULE_INFO: Record<"organic" | "maps" | "llm" | "citations", { label: string; note?: string }> = {
  organic: { label: "Organic SERP rankings" },
  maps: { label: "Google Maps geo-grid scans", note: "Collector ships in a later phase. The schedule is saved now and starts once grids are configured." },
  llm: { label: "LLM visibility checks", note: "Collector ships in a later phase. The schedule is saved now." },
  citations: { label: "Citation verification", note: "Collector ships in a later phase. The schedule is saved now." },
};

const emptyLoc = (country = "US"): Loc => ({ name: "", businessName: "", address: "", phone: "", countryCode: country, region: "", city: "", postalCode: "", latitude: "", longitude: "", googleDomain: "google.com", googleBusinessProfileReference: "" });
const defaultSched = (enabled: boolean): Sched => ({ enabled, intervalValue: 7, intervalUnit: "day", preferredRunTime: "06:00" });

export function ProjectWizard({ serpProvider, timezones }: {
  serpProvider: { name: string; pricePerUnit: number | null; currency: string; isMock: boolean } | null;
  timezones: string[];
}) {
  const [step, setStep] = useState(0);
  const [details, setDetails] = useState({
    name: "", domain: "", clientName: "", businessCategory: "", country: "US", language: "en",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", notes: "",
  });
  const [competitors, setCompetitors] = useState<{ name: string; domain: string }[]>([]);
  const [locations, setLocations] = useState<Loc[]>([emptyLoc()]);
  const [keywords, setKeywords] = useState<Kw[]>([]);
  const [schedules, setSchedules] = useState({ organic: defaultSched(true), maps: defaultSched(false), llm: defaultSched(false), citations: defaultSched(false) });
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const stepErrors = (s: number): string[] => {
    const e: string[] = [];
    if (s === 0) {
      if (!details.name.trim()) e.push("Project name is required");
      if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(details.domain.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0] ?? "")) e.push("Enter a valid website domain");
      if (!details.clientName.trim()) e.push("Client or business name is required");
      if (!details.businessCategory.trim()) e.push("Business category is required");
      competitors.forEach((c, i) => { if (!c.name.trim()) e.push(`Competitor ${i + 1} needs a name`); });
    }
    if (s === 2) {
      locations.forEach((l, i) => {
        if (!l.name.trim()) e.push(`Location ${i + 1} needs a name`);
        if (!l.countryCode) e.push(`Location ${i + 1} needs a country`);
        if ((l.latitude === "") !== (l.longitude === "")) e.push(`Location ${i + 1}: provide both latitude and longitude, or neither`);
      });
    }
    return e;
  };

  const next = () => {
    const e = stepErrors(step);
    setErrors(e);
    if (e.length === 0) setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const submit = (activate: boolean) => {
    const all = [0, 2].flatMap(stepErrors);
    if (all.length) { setErrors(all); return; }
    const payload: ProjectWizardInput = {
      project: { ...details, notes: details.notes || undefined },
      locations: locations.map((l) => ({
        ...l, businessName: l.businessName || undefined, address: l.address || undefined, phone: l.phone || undefined,
        region: l.region || undefined, city: l.city || undefined, postalCode: l.postalCode || undefined,
        latitude: l.latitude === "" ? undefined : Number(l.latitude), longitude: l.longitude === "" ? undefined : Number(l.longitude),
        googleBusinessProfileReference: l.googleBusinessProfileReference || undefined,
      })),
      competitors: competitors.filter((c) => c.name.trim()).map((c) => ({ name: c.name, domain: c.domain || undefined })),
      keywords,
      schedules,
      activate,
    };
    start(async () => {
      const res = await createProjectAction(payload);
      if (res?.error) setErrors([res.error, ...(res.fieldErrors ?? [])]);
    });
  };

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button type="button" onClick={() => (i < step ? setStep(i) : undefined)}
              className={`rounded-full border px-3 py-1 ${i === step ? "border-accent bg-accent/15 text-ink" : i < step ? "border-line text-muted hover:text-ink" : "border-line text-faint"}`}>
              {i + 1}. {s}
            </button>
          </li>
        ))}
      </ol>

      <div className="card p-5">
        {step === 0 && <DetailsStep details={details} setDetails={setDetails} competitors={competitors} setCompetitors={setCompetitors} timezones={timezones} />}
        {step === 1 && <SourcesStep serpProvider={serpProvider} />}
        {step === 2 && <LocationsStep locations={locations} setLocations={setLocations} defaultCountry={details.country} />}
        {step === 3 && <KeywordsStep keywords={keywords} setKeywords={setKeywords} locations={locations} />}
        {step === 4 && <SchedulesStep schedules={schedules} setSchedules={setSchedules} timezone={details.timezone} />}
        {step === 5 && <ReviewStep details={details} locations={locations} keywords={keywords} competitors={competitors} schedules={schedules} serpProvider={serpProvider} />}
      </div>

      {errors.length > 0 && (
        <div className="rounded-lg border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
          <ul className="list-inside list-disc">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      <div className="flex items-center justify-between">
        <button type="button" className="btn-ghost" disabled={step === 0 || pending} onClick={() => { setErrors([]); setStep((s) => s - 1); }}>Back</button>
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn-primary" onClick={next}>Continue</button>
        ) : (
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => submit(false)}>Save without first run</button>
            <button type="button" className="btn-primary" disabled={pending} onClick={() => submit(true)}>{pending ? "Creating…" : "Activate project"}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

function DetailsStep({ details, setDetails, competitors, setCompetitors, timezones }: {
  details: { name: string; domain: string; clientName: string; businessCategory: string; country: string; language: string; timezone: string; notes: string };
  setDetails: (d: typeof details) => void;
  competitors: { name: string; domain: string }[];
  setCompetitors: (c: { name: string; domain: string }[]) => void;
  timezones: string[];
}) {
  const set = (k: keyof typeof details) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setDetails({ ...details, [k]: e.target.value });
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Project name *"><input className="input" value={details.name} onChange={set("name")} placeholder="Acme Plumbing — Local SEO" /></Field>
        <Field label="Website domain *"><input className="input" value={details.domain} onChange={set("domain")} placeholder="acmeplumbing.com" /></Field>
        <Field label="Client or business name *"><input className="input" value={details.clientName} onChange={set("clientName")} /></Field>
        <Field label="Business category *"><input className="input" value={details.businessCategory} onChange={set("businessCategory")} placeholder="Plumber" /></Field>
        <Field label="Primary country *">
          <select className="input" value={details.country} onChange={set("country")}>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
        </Field>
        <Field label="Language *">
          <select className="input" value={details.language} onChange={set("language")}>{LANGUAGES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
        </Field>
        <Field label="Time zone *" hint="Schedules run at local times in this zone. Timestamps are stored in UTC.">
          <select className="input" value={details.timezone} onChange={set("timezone")}>{timezones.map((t) => <option key={t}>{t}</option>)}</select>
        </Field>
      </div>
      <Field label="Project notes"><textarea className="input min-h-20" value={details.notes} onChange={set("notes")} /></Field>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="label mb-0">Competitors (optional)</span>
          <button type="button" className="btn-ghost text-xs" onClick={() => setCompetitors([...competitors, { name: "", domain: "" }])}>+ Add competitor</button>
        </div>
        {competitors.length === 0 && <p className="text-sm text-faint">Competitor domains are matched in each SERP result to compare positions.</p>}
        <div className="space-y-2">
          {competitors.map((c, i) => (
            <div key={i} className="flex gap-2">
              <input className="input" placeholder="Name" value={c.name} onChange={(e) => setCompetitors(competitors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className="input" placeholder="domain.com" value={c.domain} onChange={(e) => setCompetitors(competitors.map((x, j) => (j === i ? { ...x, domain: e.target.value } : x)))} />
              <button type="button" className="btn-ghost" onClick={() => setCompetitors(competitors.filter((_, j) => j !== i))} aria-label="Remove competitor">✕</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SourcesStep({ serpProvider }: { serpProvider: { name: string; isMock: boolean } | null }) {
  const cards: { name: string; status: "Connected" | "Not connected" | "Needs authorization" | "Error"; note: string }[] = [
    { name: "SERP data provider", status: serpProvider ? "Connected" : "Not connected",
      note: serpProvider ? `${serpProvider.name}${serpProvider.isMock ? " — synthetic data for development, not real rankings" : ""}. Configured by an administrator on the server.` : "An administrator must add provider credentials to the server environment before rankings can be collected." },
    { name: "Google Search Console", status: "Not connected", note: "OAuth connection and property selection arrive with the Google integrations phase." },
    { name: "Google Analytics 4", status: "Not connected", note: "OAuth connection and property selection arrive with the Google integrations phase." },
    { name: "Maps rank data provider", status: "Not connected", note: "Planned with the Maps geo-grid module." },
    { name: "LLM data providers", status: "Not connected", note: "Planned with the AI visibility module." },
    { name: "Citation sources", status: "Not connected", note: "Planned with the citation module." },
  ];
  return (
    <div>
      <p className="mb-4 text-sm text-muted">No integration is required to create a project. You can connect sources later from the project settings.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <div key={c.name} className="rounded-lg border border-line bg-panel-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{c.name}</span>
              <span className={`rounded-md border px-1.5 py-0.5 text-xs ${c.status === "Connected" ? "border-good/30 bg-good/10 text-good" : "border-line text-muted"}`}>{c.status}</span>
            </div>
            <p className="mt-2 text-xs text-muted">{c.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function LocationsStep({ locations, setLocations, defaultCountry }: { locations: Loc[]; setLocations: (l: Loc[]) => void; defaultCountry: string }) {
  const update = (i: number, k: keyof Loc, v: string) => setLocations(locations.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        City and postal targeting use the provider&apos;s regional location, which is <strong>not</strong> the same as searching from an exact physical point.
        Add coordinates for point-level targeting where the provider supports it.
      </p>
      {locations.map((l, i) => (
        <div key={i} className="rounded-lg border border-line p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-medium">{i === 0 ? "Primary location" : `Location ${i + 1}`}</span>
            {i > 0 && <button type="button" className="btn-ghost text-xs" onClick={() => setLocations(locations.filter((_, j) => j !== i))}>Remove</button>}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Location name *"><input className="input" value={l.name} onChange={(e) => update(i, "name", e.target.value)} placeholder="Austin, TX" /></Field>
            <Field label="Business name"><input className="input" value={l.businessName} onChange={(e) => update(i, "businessName", e.target.value)} /></Field>
            <Field label="Phone"><input className="input" value={l.phone} onChange={(e) => update(i, "phone", e.target.value)} /></Field>
            <div className="sm:col-span-3"><Field label="Business address"><input className="input" value={l.address} onChange={(e) => update(i, "address", e.target.value)} /></Field></div>
            <Field label="Country *">
              <select className="input" value={l.countryCode} onChange={(e) => update(i, "countryCode", e.target.value)}>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
            </Field>
            <Field label="Region / state"><input className="input" value={l.region} onChange={(e) => update(i, "region", e.target.value)} placeholder="Texas" /></Field>
            <Field label="City"><input className="input" value={l.city} onChange={(e) => update(i, "city", e.target.value)} placeholder="Austin" /></Field>
            <Field label="Postal code"><input className="input" value={l.postalCode} onChange={(e) => update(i, "postalCode", e.target.value)} /></Field>
            <Field label="Latitude"><input className="input" inputMode="decimal" value={l.latitude} onChange={(e) => update(i, "latitude", e.target.value)} /></Field>
            <Field label="Longitude"><input className="input" inputMode="decimal" value={l.longitude} onChange={(e) => update(i, "longitude", e.target.value)} /></Field>
            <Field label="Google domain"><input className="input" value={l.googleDomain} onChange={(e) => update(i, "googleDomain", e.target.value)} /></Field>
            <div className="sm:col-span-2"><Field label="Google Business Profile URL or place ID"><input className="input" value={l.googleBusinessProfileReference} onChange={(e) => update(i, "googleBusinessProfileReference", e.target.value)} /></Field></div>
          </div>
        </div>
      ))}
      <button type="button" className="btn-secondary" onClick={() => setLocations([...locations, emptyLoc(defaultCountry)])}>+ Add location</button>
    </div>
  );
}

function KeywordsStep({ keywords, setKeywords, locations }: { keywords: Kw[]; setKeywords: (k: Kw[]) => void; locations: Loc[] }) {
  const [text, setText] = useState("");
  const [locationIndex, setLocationIndex] = useState(0);
  const [devices, setDevices] = useState<"desktop" | "mobile" | "both">("desktop");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState<string[]>([]);

  const addRows = (rows: { keyword: string; device?: Device; targetUrl?: string; tags: string[]; location?: string }[], importErrors: { row: number; message: string }[]) => {
    const extraTags = normalizeTags(tags.split(","));
    const out: Kw[] = [];
    for (const r of rows) {
      const li = r.location ? locations.findIndex((l) => l.name.toLowerCase() === r.location!.toLowerCase()) : locationIndex;
      const devs: Device[] = r.device ? [r.device] : devices === "both" ? ["desktop", "mobile"] : [devices];
      for (const d of devs) out.push({ keyword: r.keyword, locationIndex: li >= 0 ? li : locationIndex, device: d, targetUrl: r.targetUrl, tags: normalizeTags([...r.tags, ...extraTags]) });
    }
    const keyed = (k: Kw) => ({ ...k, locationId: String(k.locationIndex), searchEngine: "google", language: "x" });
    const { unique, duplicates } = dedupeKeywordConfigs([...keywords, ...out].map(keyed));
    setKeywords(unique.map(({ locationId: _l, searchEngine: _s, language: _g, ...k }) => k));
    setNotes([
      `${unique.length - keywords.length} added${duplicates.length ? `, ${duplicates.length} duplicate configuration(s) skipped` : ""}.`,
      ...importErrors.slice(0, 10).map((e) => `Row ${e.row}: ${e.message}`),
    ]);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2_000_000) { setNotes(["File too large (max 2 MB)."]); return; }
    const { rows, errors } = parseKeywordCsv(await f.text());
    addRows(rows, errors);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Location">
          <select className="input" value={locationIndex} onChange={(e) => setLocationIndex(Number(e.target.value))}>
            {locations.map((l, i) => <option key={i} value={i}>{l.name || `Location ${i + 1}`}</option>)}
          </select>
        </Field>
        <Field label="Device">
          <select className="input" value={devices} onChange={(e) => setDevices(e.target.value as typeof devices)}>
            <option value="desktop">Desktop</option><option value="mobile">Mobile</option><option value="both">Desktop + mobile</option>
          </select>
        </Field>
        <Field label="Tags (comma-separated)"><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="services, brand" /></Field>
      </div>
      <Field label="Keywords, one per line">
        <textarea className="input min-h-32 font-mono" value={text} onChange={(e) => setText(e.target.value)} placeholder={"plumber austin\nemergency plumber near me"} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" onClick={() => { const r = parseKeywordCsv(text); addRows(r.rows, r.errors); setText(""); }}>Add keywords</button>
        <label className="btn-ghost cursor-pointer">
          Import CSV<input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <span className="text-xs text-faint">CSV columns: keyword, location, device, language, target_url, tags (separated by ;)</span>
      </div>
      {notes.length > 0 && <div className="rounded-lg bg-panel-2 p-3 text-xs text-muted">{notes.map((n) => <div key={n}>{n}</div>)}</div>}
      {keywords.length > 0 ? (
        <div className="max-h-72 overflow-auto rounded-lg border border-line">
          <table className="table">
            <thead><tr><th>Keyword</th><th>Location</th><th>Device</th><th>Tags</th><th></th></tr></thead>
            <tbody>
              {keywords.map((k, i) => (
                <tr key={`${k.keyword}-${k.locationIndex}-${k.device}`}>
                  <td>{k.keyword}</td><td className="text-muted">{locations[k.locationIndex]?.name || `Location ${k.locationIndex + 1}`}</td>
                  <td className="text-muted">{k.device}</td><td className="text-muted">{k.tags.join(", ")}</td>
                  <td className="text-right"><button type="button" className="btn-ghost text-xs" onClick={() => setKeywords(keywords.filter((_, j) => j !== i))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-sm text-faint">No keywords yet. You can also add them after creating the project.</p>}
    </div>
  );
}

function SchedulesStep({ schedules, setSchedules, timezone }: { schedules: Record<keyof typeof MODULE_INFO, Sched>; setSchedules: (s: Record<keyof typeof MODULE_INFO, Sched>) => void; timezone: string }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Each module has its own schedule. The default is every 7 days. Times are in {timezone}.</p>
      {(Object.keys(MODULE_INFO) as (keyof typeof MODULE_INFO)[]).map((m) => (
        <ScheduleEditor key={m} label={MODULE_INFO[m].label} note={MODULE_INFO[m].note} value={schedules[m]} onChange={(v) => setSchedules({ ...schedules, [m]: v })} />
      ))}
    </div>
  );
}

function ReviewStep({ details, locations, keywords, competitors, schedules, serpProvider }: {
  details: { name: string; domain: string; timezone: string };
  locations: Loc[]; keywords: Kw[]; competitors: { name: string }[];
  schedules: Record<keyof typeof MODULE_INFO, Sched>;
  serpProvider: { name: string; pricePerUnit: number | null; currency: string; isMock: boolean } | null;
}) {
  const estimate = useMemo(() => {
    if (!serpProvider) return null;
    return { units: keywords.length, amount: serpProvider.pricePerUnit === null ? null : keywords.length * serpProvider.pricePerUnit };
  }, [keywords.length, serpProvider]);
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <div><dt className="label">Project</dt><dd>{details.name} — {details.domain}</dd></div>
        <div><dt className="label">Time zone</dt><dd>{details.timezone}</dd></div>
        <div><dt className="label">Locations</dt><dd>{locations.map((l) => l.name).join(", ")}</dd></div>
        <div><dt className="label">Competitors</dt><dd>{competitors.length || "None"}</dd></div>
        <div><dt className="label">Keyword configurations</dt><dd>{keywords.length}</dd></div>
      </dl>
      <div>
        <div className="label">Schedules</div>
        <ul className="space-y-1">
          {(Object.keys(MODULE_INFO) as (keyof typeof MODULE_INFO)[]).map((m) => (
            <li key={m}>{MODULE_INFO[m].label}: {schedules[m].enabled ? `${describeInterval(schedules[m].intervalValue, schedules[m].intervalUnit)} at ${schedules[m].preferredRunTime}` : "Off"}</li>
          ))}
        </ul>
      </div>
      <div className="rounded-lg bg-panel-2 p-3">
        <div className="label">Expected first run</div>
        {!serpProvider ? <p className="text-warn">No SERP provider is configured, so no rankings will be collected until one is added.</p>
          : keywords.length === 0 || !schedules.organic.enabled ? <p className="text-muted">No initial organic job (no keywords or organic tracking off).</p>
          : <p>One organic collection job for {keywords.length} keyword configuration(s) via {serpProvider.name}. Estimated usage: {estimate!.units} request(s), {formatMoney(estimate!.amount, serpProvider.currency)}{estimate!.amount === null ? " (no unit price configured)" : ""}.</p>}
        {serpProvider?.isMock && <p className="mt-1 text-warn">The mock provider produces synthetic results for development only.</p>}
      </div>
    </div>
  );
}
