"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { bulkKeywordAction } from "../actions";
import { RefreshButton } from "@/components/refresh-button";

interface Row { id: string; keyword: string; location: string; device: string; language: string; tags: string[]; isActive: boolean; targetUrl: string | null; lastStatus: string | null }

export function KeywordTable({ projectId, rows, canManage, canRefresh }: { projectId: string; rows: Row[]; canManage: boolean; canRefresh: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tag, setTag] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ids = [...selected];
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const bulk = (op: "pause" | "resume" | "delete" | "tag" | "untag") => {
    if (op === "delete" && !confirm(`Delete ${ids.length} keyword(s)? Their ranking history is deleted too. Pause them instead to keep history.`)) return;
    start(async () => {
      const r = await bulkKeywordAction(projectId, { ids, op, tag });
      setMsg(r.error ?? r.message ?? null);
      if (r.ok) setSelected(new Set());
    });
  };

  return (
    <div>
      {(canManage || canRefresh) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">{ids.length} selected</span>
          {canRefresh && <RefreshButton projectId={projectId} keywordIds={ids} label="Refresh selected" disabled={ids.length === 0} />}
          {canManage && (
            <>
              <button className="btn-secondary" disabled={!ids.length || pending} onClick={() => bulk("pause")}>Pause</button>
              <button className="btn-secondary" disabled={!ids.length || pending} onClick={() => bulk("resume")}>Resume</button>
              <input className="input w-32" placeholder="tag" value={tag} onChange={(e) => setTag(e.target.value)} />
              <button className="btn-secondary" disabled={!ids.length || !tag || pending} onClick={() => bulk("tag")}>Add tag</button>
              <button className="btn-secondary" disabled={!ids.length || !tag || pending} onClick={() => bulk("untag")}>Remove tag</button>
              <button className="btn-danger" disabled={!ids.length || pending} onClick={() => bulk("delete")}>Delete</button>
            </>
          )}
          {msg && <span className="text-xs text-muted">{msg}</span>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-8"><input type="checkbox" aria-label="Select all" checked={rows.length > 0 && selected.size === rows.length}
                onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
              <th>Keyword</th><th>Location</th><th>Device</th><th>Language</th><th>Target URL</th><th>Tags</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><input type="checkbox" aria-label={`Select ${r.keyword}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td><Link className="hover:underline" href={`/projects/${projectId}/rankings/${r.id}`}>{r.keyword}</Link></td>
                <td className="text-muted">{r.location}</td>
                <td className="text-muted">{r.device}</td>
                <td className="text-muted">{r.language}</td>
                <td className="max-w-48 truncate text-muted" title={r.targetUrl ?? ""}>{r.targetUrl ?? "—"}</td>
                <td className="text-muted">{r.tags.join(", ") || "—"}</td>
                <td>{r.isActive ? <span className="text-good">Active</span> : <span className="text-warn">Paused</span>}
                  {r.lastStatus && ["pending", "in_flight"].includes(r.lastStatus) && <span className="ml-2 text-xs text-accent">checking…</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
