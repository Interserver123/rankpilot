"use client";

import Link from "next/link";
import { useState } from "react";
import { RefreshButton } from "@/components/refresh-button";

interface Row {
  id: string; keyword: string; location: string; device: string; requestedLocation: string | null;
  current: string; previous: string; change: { text: string; direction: -1 | 0 | 1 };
  url: string | null; features: string[]; lastChecked: string; provider: string | null;
  status: { label: string; tone: string; detail?: string };
}

const TONE: Record<string, string> = { good: "text-good", warn: "text-warn", bad: "text-bad", info: "text-accent", neutral: "text-muted" };

export function RankingsTable({ projectId, rows, canRefresh, nextRun, sortLinks }: {
  projectId: string; rows: Row[]; canRefresh: boolean; nextRun: string; sortLinks: Record<"keyword" | "position" | "change" | "checked", string>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ids = [...selected];
  return (
    <div>
      {canRefresh && (
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className="text-muted">{ids.length} selected</span>
          <RefreshButton projectId={projectId} keywordIds={ids} label="Refresh selected" disabled={!ids.length} />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              {canRefresh && <th className="w-8"><input type="checkbox" aria-label="Select all" checked={rows.length > 0 && selected.size === rows.length}
                onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>}
              <th><Link href={sortLinks.keyword}>Keyword ↕</Link></th><th>Location</th><th>Device</th>
              <th className="text-right"><Link href={sortLinks.position}>Current ↕</Link></th><th className="text-right">Previous</th>
              <th className="text-right"><Link href={sortLinks.change}>Change ↕</Link></th><th>Ranking URL</th><th>SERP features</th>
              <th><Link href={sortLinks.checked}>Last checked ↕</Link></th><th>Next update</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {canRefresh && <td><input type="checkbox" aria-label={`Select ${r.keyword}`} checked={selected.has(r.id)}
                  onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} /></td>}
                <td className="min-w-48"><Link className="font-medium hover:underline" href={`/projects/${projectId}/rankings/${r.id}`}>{r.keyword}</Link></td>
                <td className="whitespace-nowrap text-muted" title={r.requestedLocation ? `Requested: ${r.requestedLocation}` : undefined}>{r.location}</td>
                <td className="text-muted">{r.device}</td>
                <td className="text-right font-semibold tabular-nums">{r.current}</td>
                <td className="text-right tabular-nums text-muted">{r.previous}</td>
                <td className={`text-right tabular-nums ${r.change.direction > 0 ? "text-good" : r.change.direction < 0 ? "text-bad" : "text-muted"}`}>{r.change.text}</td>
                <td className="max-w-56 truncate">{r.url ? <a className="link" href={r.url} target="_blank" rel="noreferrer noopener" title={r.url}>{r.url.replace(/^https?:\/\//, "")}</a> : <span className="text-faint">—</span>}</td>
                <td className="text-xs text-muted">{r.features.length ? r.features.map((f) => f.replace(/_/g, " ")).join(", ") : "—"}</td>
                <td className="whitespace-nowrap text-xs text-muted" title={r.provider ? `Provider: ${r.provider}` : undefined}>{r.lastChecked}</td>
                <td className="whitespace-nowrap text-xs text-muted">{nextRun}</td>
                <td className={`whitespace-nowrap text-xs ${TONE[r.status.tone]}`} title={r.status.detail}>{r.status.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
