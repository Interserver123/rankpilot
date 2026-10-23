"use client";

import { useState, useTransition } from "react";
import { refreshAction } from "@/app/(app)/projects/[projectId]/actions";
import { formatMoney } from "@/lib/cost";

type Result = Awaited<ReturnType<typeof refreshAction>>;

function describe(r: Result): { tone: "good" | "warn" | "bad"; text: string } {
  switch (r.kind) {
    case "queued": return { tone: "good", text: `Queued ${r.targets} keyword(s)${r.skipped ? `; ${r.skipped} already queued` : ""}. Results appear when the job finishes.` };
    case "duplicate": return { tone: "warn", text: "These keywords are already queued or running. No duplicate requests were created." };
    case "awaiting_approval": return { tone: "warn", text: "A budget limit was reached. The job is waiting for administrator approval." };
    case "budget_blocked": return { tone: "bad", text: r.message };
    case "no_provider": return { tone: "bad", text: "No SERP provider is configured. Ask an administrator to add provider credentials." };
    case "nothing_to_do": return { tone: "warn", text: "Nothing to refresh (no active keywords, or the project is paused)." };
    case "rate_limited": return { tone: "warn", text: "Too many refresh requests. Wait a minute and try again." };
    case "needs_confirmation": return { tone: "warn", text: "" };
  }
}

export function RefreshButton({ projectId, keywordIds, label = "Refresh", className = "btn-secondary", disabled }: {
  projectId: string; keywordIds: string[] | null; label?: string; className?: string; disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<Extract<Result, { kind: "needs_confirmation" }> | null>(null);
  const [msg, setMsg] = useState<{ tone: string; text: string } | null>(null);

  const run = (confirmed: boolean) => start(async () => {
    setMsg(null);
    const r = await refreshAction(projectId, keywordIds, confirmed);
    if (r.kind === "needs_confirmation") { setConfirm(r); return; }
    setConfirm(null);
    setMsg(describe(r));
    window.dispatchEvent(new Event("rankpilot:jobs-changed"));
  });

  return (
    <span className="relative inline-flex flex-col items-end">
      <button type="button" className={className} disabled={pending || disabled} onClick={() => run(false)}>{pending ? "Queuing…" : label}</button>
      {confirm && (
        <div role="dialog" className="absolute right-0 top-full z-20 mt-2 w-80 rounded-lg border border-line bg-panel p-4 text-sm shadow-xl">
          <div className="mb-1 font-medium">Confirm refresh</div>
          <p className="text-muted">
            {confirm.estimate.keywords} keyword(s) via {confirm.estimate.provider?.name ?? "provider"}: about {confirm.estimate.units} request(s),
            estimated {formatMoney(confirm.estimate.amount, confirm.estimate.currency)}.
            This does not change the recurring schedule.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setConfirm(null)}>Cancel</button>
            <button type="button" className="btn-primary" disabled={pending} onClick={() => run(true)}>Run refresh</button>
          </div>
        </div>
      )}
      {msg && <span className={`mt-1 max-w-80 text-right text-xs ${msg.tone === "good" ? "text-good" : msg.tone === "bad" ? "text-bad" : "text-warn"}`}>{msg.text}</span>}
    </span>
  );
}
