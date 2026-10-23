import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProjectAccess } from "@/server/authz";
import { sql } from "@/server/db";
import { competitorHistory, getProject, keywordHistory } from "@/server/queries";
import { canProject } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";
import { changeInfo, positionLabel, toObserved } from "@/lib/rank-display";
import { Card, EmptyState, Provenance } from "@/components/ui";
import { RankHistoryChart } from "@/components/charts";
import { RefreshButton } from "@/components/refresh-button";

export default async function KeywordHistoryPage({ params }: { params: Promise<{ projectId: string; keywordId: string }> }) {
  const { projectId, keywordId } = await params;
  const { relation } = await requireProjectAccess(projectId, "project.view");
  if (!/^[0-9a-f-]{36}$/i.test(keywordId)) notFound();
  const [kw] = await sql<{ id: string; keyword: string; device: string; language: string; is_active: boolean; tags: string[]; target_url: string | null; location_name: string }[]>`
    select k.*, l.name as location_name from keywords k join project_locations l on l.id = k.location_id where k.id = ${keywordId} and k.project_id = ${projectId}`;
  if (!kw) notFound();
  const project = (await getProject(sql, projectId))!;
  const [history, comps] = await Promise.all([keywordHistory(sql, keywordId), competitorHistory(sql, keywordId)]);
  const competitors = [...new Map(comps.map((c) => [c.competitor_id, { id: c.competitor_id, name: c.name }])).values()];
  const compAt = (obsId: string, compId: string) => comps.find((c) => c.observation_id === obsId && c.competitor_id === compId);
  const tz = project.timezone;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/projects/${projectId}/rankings`} className="text-xs text-muted hover:underline">← Organic rankings</Link>
          <h2 className="mt-1 text-lg font-semibold">{kw.keyword}</h2>
          <p className="text-sm text-muted">{kw.location_name} · {kw.device} · {kw.language}{kw.tags.length ? ` · ${kw.tags.join(", ")}` : ""}{!kw.is_active && " · paused"}</p>
          {kw.target_url && <p className="text-xs text-faint">Target URL: {kw.target_url}</p>}
        </div>
        {canProject(relation, "scan.manual") && <RefreshButton projectId={projectId} keywordIds={[kw.id]} label="Refresh this keyword" />}
      </div>

      {history.length === 0 ? <EmptyState title="No observations yet">This keyword has not been successfully checked yet.</EmptyState> : (
        <>
          <Card title="Position history" footer={<Provenance source="Independent SERP collection. Hollow red markers = verified not found within the result depth." />}>
            <RankHistoryChart title={`Position history for ${kw.keyword}`} points={history.map((h) => ({ at: h.collected_at, position: h.position, depth: h.result_depth }))} />
          </Card>
          <Card title={`Observations (${history.length})`}>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr><th>Collected</th><th className="text-right">Position</th><th className="text-right">Change</th><th>Ranking URL</th>
                    {competitors.map((c) => <th key={c.id} className="text-right">{c.name}</th>)}
                    <th>Provider</th><th>Requested location</th><th>Job</th></tr>
                </thead>
                <tbody>
                  {history.map((h, i) => {
                    const cur = toObserved(h.result_status, h.position, h.result_depth);
                    const prevRow = history[i + 1];
                    const prev = prevRow ? toObserved(prevRow.result_status, prevRow.position, prevRow.result_depth) : null;
                    const ch = changeInfo(cur, prev);
                    return (
                      <tr key={h.id}>
                        <td className="whitespace-nowrap text-muted">{formatDateTime(h.collected_at, tz)}</td>
                        <td className="text-right font-semibold tabular-nums">{positionLabel(cur)}</td>
                        <td className={`text-right tabular-nums ${ch.direction > 0 ? "text-good" : ch.direction < 0 ? "text-bad" : "text-muted"}`}>{ch.text}</td>
                        <td className="max-w-64 truncate">{h.ranking_url ? <a className="link" href={h.ranking_url} target="_blank" rel="noreferrer noopener">{h.ranking_url.replace(/^https?:\/\//, "")}</a> : "—"}</td>
                        {competitors.map((c) => { const p = compAt(h.id, c.id); return <td key={c.id} className="text-right tabular-nums text-muted">{p ? (p.position ?? `n/f`) : "—"}</td>; })}
                        <td className="text-muted">{h.provider}</td>
                        <td className="text-xs text-muted">{h.requested_location} · depth {h.result_depth}</td>
                        <td><Link className="link text-xs" href={`/jobs/${h.job_id}`}>view</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
