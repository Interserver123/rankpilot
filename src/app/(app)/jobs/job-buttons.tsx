"use client";

import { useTransition } from "react";
import { approveJobAction, cancelJobAction } from "./actions";

export function JobButtons({ jobId, status, canApprove }: { jobId: string; status: string; canApprove: boolean }) {
  const [pending, start] = useTransition();
  const run = (fn: (id: string) => Promise<{ ok?: boolean; error?: string }>) => start(async () => { const r = await fn(jobId); if (r.error) alert(r.error); });
  return (
    <span className="flex gap-1">
      {status === "awaiting_approval" && canApprove && <button className="btn-secondary text-xs" disabled={pending} onClick={() => run(approveJobAction)}>Approve</button>}
      {(status === "queued" || status === "awaiting_approval") && <button className="btn-ghost text-xs" disabled={pending} onClick={() => run(cancelJobAction)}>Cancel</button>}
    </span>
  );
}
