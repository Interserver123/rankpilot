"use client";

import { useActionState, useTransition } from "react";
import { addCompetitorAction, deleteCompetitorAction, type ActionState } from "../actions";

export function AddCompetitorForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addCompetitorAction.bind(null, projectId), {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label><span className="label">Name</span><input name="name" required className="input" /></label>
      <label><span className="label">Domain</span><input name="domain" className="input" placeholder="competitor.com" /></label>
      <button className="btn-primary" disabled={pending}>Add</button>
      {state.error && <span className="text-sm text-bad">{state.error}</span>}
      {state.message && <span className="text-sm text-good">{state.message}</span>}
    </form>
  );
}

export function DeleteCompetitorButton({ projectId, competitorId }: { projectId: string; competitorId: string }) {
  const [pending, start] = useTransition();
  return (
    <button className="btn-ghost text-xs" disabled={pending} onClick={() => {
      if (confirm("Remove this competitor? Its recorded positions are deleted too.")) start(async () => { await deleteCompetitorAction(projectId, competitorId); });
    }}>Remove</button>
  );
}
