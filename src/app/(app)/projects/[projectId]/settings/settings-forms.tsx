"use client";

import { useActionState, useTransition } from "react";
import { addLocationAction, deleteLocationAction, setAssignmentAction, setStatusAction, updateLocationAction, updateProjectAction, type ActionState } from "../actions";

function Result({ state }: { state: ActionState }) {
  if (state.error) return <span className="text-sm text-bad">{state.error}</span>;
  if (state.message) return <span className="text-sm text-good">{state.message}</span>;
  return null;
}

export function DetailsForm({ projectId, initial, disabled, timezones }: {
  projectId: string; disabled: boolean; timezones: string[];
  initial: { name: string; domain: string; businessCategory: string; timezone: string; language: string; notes: string };
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateProjectAction.bind(null, projectId), {});
  return (
    <form action={action}>
      <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
        <label><span className="label">Name</span><input name="name" defaultValue={initial.name} className="input" required /></label>
        <label><span className="label">Domain</span><input name="domain" defaultValue={initial.domain} className="input" required /></label>
        <label><span className="label">Business category</span><input name="businessCategory" defaultValue={initial.businessCategory} className="input" /></label>
        <label><span className="label">Language</span><input name="language" defaultValue={initial.language} className="input" /></label>
        <label><span className="label">Time zone</span>
          <select name="timezone" defaultValue={initial.timezone} className="input">{timezones.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label className="sm:col-span-2"><span className="label">Notes</span><textarea name="notes" defaultValue={initial.notes} className="input min-h-20" /></label>
        <div className="flex items-center gap-3 sm:col-span-2"><button className="btn-primary" disabled={pending}>Save</button><Result state={state} /></div>
      </fieldset>
    </form>
  );
}

interface Loc { id: string; name: string; business_name: string | null; address: string | null; phone: string | null; country_code: string; region: string | null;
  city: string | null; postal_code: string | null; latitude: number | null; longitude: number | null; google_domain: string; google_business_profile_reference: string | null }

export function LocationForm({ projectId, location, disabled }: { projectId: string; location: Loc | null; disabled: boolean }) {
  const fn = location ? updateLocationAction.bind(null, projectId, location.id) : addLocationAction.bind(null, projectId);
  const [state, action, pending] = useActionState<ActionState, FormData>(fn, {});
  const l = location;
  const f = (name: string, label: string, value: string | number | null | undefined, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <label><span className="label">{label}</span><input name={name} defaultValue={value ?? ""} className="input" {...extra} /></label>
  );
  return (
    <form action={action}>
      <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-3">
        {f("name", "Location name *", l?.name, { required: true })}
        {f("businessName", "Business name", l?.business_name)}
        {f("phone", "Phone", l?.phone)}
        <div className="sm:col-span-3">{f("address", "Address", l?.address)}</div>
        {f("countryCode", "Country code *", l?.country_code ?? "US", { required: true, maxLength: 2 })}
        {f("region", "Region / state", l?.region)}
        {f("city", "City", l?.city)}
        {f("postalCode", "Postal code", l?.postal_code)}
        {f("latitude", "Latitude", l?.latitude, { inputMode: "decimal" })}
        {f("longitude", "Longitude", l?.longitude, { inputMode: "decimal" })}
        {f("googleDomain", "Google domain", l?.google_domain ?? "google.com")}
        <div className="sm:col-span-2">{f("googleBusinessProfileReference", "Google Business Profile URL or place ID", l?.google_business_profile_reference)}</div>
        <div className="flex items-center gap-3 sm:col-span-3"><button className="btn-primary" disabled={pending}>{l ? "Save location" : "Add location"}</button><Result state={state} /></div>
      </fieldset>
    </form>
  );
}

export function DeleteLocationButton({ projectId, locationId }: { projectId: string; locationId: string }) {
  const [pending, start] = useTransition();
  return (
    <button className="btn-danger" disabled={pending} onClick={() => start(async () => {
      if (!confirm("Remove this location?")) return;
      const r = await deleteLocationAction(projectId, locationId);
      if (r.error) alert(r.error);
    })}>Remove location</button>
  );
}

export function StatusControls({ projectId, status, canArchive }: { projectId: string; status: string; canArchive: boolean }) {
  const [pending, start] = useTransition();
  const set = (s: "active" | "paused" | "archived") => start(async () => { await setStatusAction(projectId, s); });
  return (
    <div className="flex flex-wrap gap-2">
      {status !== "active" && <button className="btn-primary" disabled={pending} onClick={() => set("active")}>Resume project</button>}
      {status === "active" && <button className="btn-secondary" disabled={pending} onClick={() => set("paused")}>Pause project</button>}
      {canArchive && status !== "archived" && <button className="btn-danger" disabled={pending} onClick={() => { if (confirm("Archive this project? Its data is kept.")) set("archived"); }}>Archive project</button>}
    </div>
  );
}

export function AssignmentToggle({ projectId, userId, assigned }: { projectId: string; userId: string; assigned: boolean }) {
  const [pending, start] = useTransition();
  return <input type="checkbox" defaultChecked={assigned} disabled={pending} aria-label="Assigned to project"
    onChange={(e) => { const v = e.target.checked; start(async () => { await setAssignmentAction(projectId, userId, v); }); }} />;
}
