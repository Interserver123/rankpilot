"use client";

import { useActionState, useTransition } from "react";
import { deleteBudgetAction, saveBudgetAction, type BudgetState } from "./actions";

export function BudgetForm({ projects }: { projects: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<BudgetState, FormData>(saveBudgetAction, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-6 sm:items-end">
      <label className="sm:col-span-2"><span className="label">Scope</span>
        <select name="projectId" className="input"><option value="">Whole organization</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label><span className="label">Module</span>
        <select name="module" className="input"><option value="">All modules</option><option value="organic">Organic</option><option value="maps">Maps</option><option value="llm">LLM</option><option value="citations">Citations</option></select></label>
      <label><span className="label">Monthly limit (USD)</span><input name="monthlyLimit" type="number" step="0.01" min="0" required className="input" /></label>
      <label><span className="label">Alert at %</span><input name="alertThresholdPct" type="number" min="1" max="100" defaultValue={80} className="input" /></label>
      <label><span className="label">When reached</span>
        <select name="onLimit" className="input"><option value="require_approval">Require approval</option><option value="block">Block new jobs</option></select></label>
      <div className="flex items-center gap-3 sm:col-span-6">
        <button className="btn-primary" disabled={pending}>Save budget</button>
        <span className="text-xs text-faint">Saving a budget for an existing scope updates it.</span>
        {state.error && <span className="text-sm text-bad">{state.error}</span>}
        {state.ok && <span className="text-sm text-good">Saved.</span>}
      </div>
    </form>
  );
}

export function DeleteBudget({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return <button className="btn-ghost text-xs" disabled={pending} onClick={() => start(async () => { if (confirm("Delete this budget?")) await deleteBudgetAction(id); })}>Delete</button>;
}
