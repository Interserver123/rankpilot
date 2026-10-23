"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface ActiveJob { id: string; module: string; status: string; trigger: string; total: number; done: number; failed: number }

/** Polls active jobs; refreshes server data once jobs finish so results appear only after they are saved. */
export function ActiveJobs({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const prevCount = useRef(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/jobs`, { cache: "no-store" });
        if (!res.ok) return;
        const { jobs } = (await res.json()) as { jobs: ActiveJob[] };
        if (cancelled) return;
        if (jobs.length < prevCount.current) router.refresh();
        prevCount.current = jobs.length;
        setJobs(jobs);
      } catch { /* transient network errors: try again next tick */ }
    };
    load();
    const delay = jobs.length > 0 ? 3000 : 15000;
    const t = setTimeout(() => setTick((n) => n + 1), delay);
    return () => { cancelled = true; clearTimeout(t); };
  }, [projectId, tick]);

  useEffect(() => {
    const onRefresh = () => setTick((n) => n + 1);
    window.addEventListener("rankpilot:jobs-changed", onRefresh);
    return () => window.removeEventListener("rankpilot:jobs-changed", onRefresh);
  }, []);

  if (jobs.length === 0) return null;
  return (
    <div className="mt-4 space-y-2">
      {jobs.map((j) => (
        <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm hover:border-accent">
          <span className={`h-2 w-2 rounded-full ${j.status === "running" ? "animate-pulse bg-accent" : j.status === "awaiting_approval" ? "bg-warn" : "bg-muted"}`} />
          <span className="capitalize">{j.module} {j.trigger} job · {j.status.replace("_", " ")}</span>
          <span className="ml-auto tabular-nums text-muted">{j.done}/{j.total} done{j.failed ? ` · ${j.failed} failed` : ""}</span>
          <div className="hidden h-1.5 w-32 rounded bg-panel-2 sm:block"><div className="h-1.5 rounded bg-accent" style={{ width: `${j.total ? (j.done / j.total) * 100 : 0}%` }} /></div>
        </Link>
      ))}
    </div>
  );
}
