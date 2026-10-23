"use client";

import { useActionState } from "react";
import { testSearchAction, type SearchTestState } from "./actions";

/** Runs one real 10-result YepAPI search so the location and result format can be verified by eye. */
export function SearchTest() {
  const [state, action, pending] = useActionState<SearchTestState, FormData>(testSearchAction, {});
  const r = state.result;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">Runs one real search (10 results, about $0.01) and shows exactly what was sent and returned. Use it to check a location before trusting rankings.</p>
      <form action={action} className="grid max-w-2xl gap-2 sm:grid-cols-2">
        <label><span className="label">Keyword</span><input name="keyword" required className="input w-full" placeholder="towing service" /></label>
        <label><span className="label">Your domain (to find your position)</span><input name="domain" className="input w-full" placeholder="example.com" /></label>
        <label><span className="label">City</span><input name="city" className="input w-full" placeholder="Beaumont" /></label>
        <label><span className="label">State / region</span><input name="region" className="input w-full" placeholder="Texas" /></label>
        <label><span className="label">Country code</span><input name="country" defaultValue="US" maxLength={2} className="input w-full" /></label>
        <label><span className="label">Device</span><select name="device" className="input w-full"><option value="desktop">Desktop</option><option value="mobile">Mobile</option></select></label>
        <div className="sm:col-span-2"><button className="btn-secondary" disabled={pending}>{pending ? "Searching…" : "Run test search"}</button></div>
      </form>
      {state.error && <p className="text-bad">{state.error}</p>}
      {r && (
        <div className="space-y-2 rounded-xl border border-line bg-panel-2 p-3">
          {r.error && <p className="text-bad">{r.error}</p>}
          {r.requestBody && <p><span className="font-medium">Sent:</span> <code className="break-all text-xs">{JSON.stringify(r.requestBody)}</code></p>}
          {r.ok && (
            <>
              <p><span className="font-medium">Returned:</span> {r.itemCount} results{r.totalResults != null ? ` (total reported ${r.totalResults})` : ""}. Fields: <code className="text-xs">{(r.itemKeys ?? []).join(", ") || "none"}</code></p>
              <p>{r.matchedPosition != null ? <span className="text-good">Your domain found at position {r.matchedPosition}.</span> : <span className="text-muted">Your domain is not in these 10 results.</span>}</p>
              <ol className="space-y-1">{(r.items ?? []).map((i, n) => <li key={n} className="break-all"><span className="tabular-nums text-muted">{i.position ?? "?"}.</span> {i.domain || i.url}</li>)}</ol>
            </>
          )}
        </div>
      )}
    </div>
  );
}
