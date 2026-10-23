import { requireProjectAccess } from "@/server/authz";
import { sql } from "@/server/db";
import { getCompetitors } from "@/server/queries";
import { canProject } from "@/lib/permissions";
import { Card, EmptyState } from "@/components/ui";
import { AddCompetitorForm, DeleteCompetitorButton } from "./competitor-forms";

export default async function CompetitorsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { relation } = await requireProjectAccess(projectId, "project.view");
  const competitors = await getCompetitors(sql, projectId);
  const stats = await sql<{ competitor_id: string; measured: number; ranked: number; top10: number; avg: number | null }[]>`
    with latest as (
      select distinct on (o.keyword_id) o.id from serp_observations o join keywords k on k.id = o.keyword_id
      where k.project_id = ${projectId} and k.is_active order by o.keyword_id, o.collected_at desc)
    select co.competitor_id, count(*)::int as measured, count(co.position)::int as ranked,
      count(*) filter (where co.position <= 10)::int as top10, round(avg(co.position)::numeric, 1)::float8 as avg
    from serp_competitor_observations co join latest l on l.id = co.observation_id group by co.competitor_id`;
  const canEdit = canProject(relation, "project.update");
  return (
    <div className="space-y-6">
      {canEdit && <Card title="Add competitor"><AddCompetitorForm projectId={projectId} /></Card>}
      <Card title="Competitors" footer="Positions come from the latest observation of each active keyword. Average excludes keywords where the competitor was not found.">
        {competitors.length === 0 ? <EmptyState title="No competitors">Add competitor domains to compare their organic positions on your tracked keywords.</EmptyState> : (
          <table className="table">
            <thead><tr><th>Name</th><th>Domain</th><th className="text-right">Keywords measured</th><th className="text-right">Ranking</th><th className="text-right">Top 10</th><th className="text-right">Avg. position</th><th></th></tr></thead>
            <tbody>
              {competitors.map((c) => {
                const s = stats.find((x) => x.competitor_id === c.id);
                return (
                  <tr key={c.id}>
                    <td>{c.name}</td><td className="text-muted">{c.domain ?? "—"}</td>
                    <td className="text-right tabular-nums">{s?.measured ?? 0}</td><td className="text-right tabular-nums">{s?.ranked ?? 0}</td>
                    <td className="text-right tabular-nums">{s?.top10 ?? 0}</td><td className="text-right tabular-nums">{s?.avg ?? "—"}</td>
                    <td className="text-right">{canEdit && <DeleteCompetitorButton projectId={projectId} competitorId={c.id} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
