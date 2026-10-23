"use client";

import { useActionState } from "react";
import { addKeywordsAction, type ActionState } from "../actions";

export function AddKeywordsForm({ projectId, locations }: { projectId: string; locations: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addKeywordsAction.bind(null, projectId), {});
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label><span className="label">Location</span>
          <select name="locationId" className="input">{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label><span className="label">Device</span>
          <select name="device" className="input"><option value="desktop">Desktop</option><option value="mobile">Mobile</option><option value="both">Desktop + mobile</option></select></label>
        <label><span className="label">Tags (comma-separated)</span><input name="tags" className="input" /></label>
      </div>
      <label className="block"><span className="label">Keywords, one per line</span>
        <textarea name="keywords" className="input min-h-24 font-mono" placeholder={"plumber austin\nwater heater repair austin"} /></label>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={pending}>{pending ? "Adding…" : "Add keywords"}</button>
        <label className="text-sm text-muted">or import CSV <input type="file" name="file" accept=".csv,text/csv" className="ml-2 text-xs" /></label>
        <span className="text-xs text-faint">Columns: keyword, location, device, language, target_url, tags. Same keyword at another location or device is kept as a separate configuration.</span>
      </div>
      {state.error && <p className="text-sm text-bad">{state.error}</p>}
      {state.message && <p className="text-sm text-good">{state.message}</p>}
    </form>
  );
}
