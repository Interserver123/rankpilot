import Link from "next/link";
import { requireStaff, visibleProjectsFilter } from "@/server/authz";
import { sql } from "@/server/db";
import { formatDateTime, relativeTime } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Rank Tracking" };

export default async function RankTrackingPage() {
  const user = await requireStaff();
  const rows = await sql<{ id: string; name: string; domain: string; timezone: string; keywords: number; top3: number; top10: number; not_found: number; measured: number; improved: number; declined: number; last: Date | null; next_run_at: Date | null }[]>`
    with latest as (
      select k.project_id, o.position, o.result_status, o.collected_at,
        lag(o.position) over (partition by o.keyword_id order by o.collected_at) as prev_pos,
        lag(o.result_status) over (partition by o.keyword_id order by o.collected_at) as prev_status,
        row_number() over (partition by o.keyword_id order by o.collected_at desc) as rn
      from serp_observations o join keywords k on k.id = o.keyword_id join projects p on p.id = k.project_id
      where ${visibleProjectsFilter(sql, user)} and k.is_active)
    select p.id, p.name, p.domain, p.timezone,
      (select count(*)::int from keywords k where k.project_id = p.id and k.is_active) as keywords,
      count(*) filter (where l.position <= 3)::int as top3,
      count(*) filter (where l.position <= 10)::int as top10,
      count(*) filter (where l.result_status = 'not_found')::int as not_found,
      count(l.*)::int as measured,
      count(*) filter (where l.prev_status is not null and coalesce(l.position, 1000) < coalesce(l.prev_pos, 1000))::int as improved,
      count(*) filter (where l.prev_status is not null and coalesce(l.position, 1000) > coalesce(l.prev_pos, 1000))::int as declined,
      max(l.collected_at) as last, c.next_run_at
    from projects p
    left join latest l on l.project_id = p.id and l.rn = 1
    left join tracking_configs c on c.project_id = p.id and c.module = 'organic' and c.target_type = 'project' and c.enabled
    where ${visibleProjectsFilter(sql, user)} and p.status = 'active'
    group by p.id, c.next_run_at order by p.name`;
  return (
    <div>
      <PageHeader title="Rank tracking" subtitle="Latest verified organic positions per project. Keywords not found within the result depth are counted separately." />
      {rows.length === 0 ? <EmptyState title="No active projects" /> : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Project</th><th className="text-right">Keywords</th><th className="text-right">Measured</th><th className="text-right">Top 3</th><th className="text-right">Top 10</th><th className="text-right">Not found</th><th className="text-right">Improved</th><th className="text-right">Declined</th><th>Last collected</th><th>Next run</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link className="font-medium hover:underline" href={`/projects/${r.id}/rankings`}>{r.name}</Link><div className="text-xs text-faint">{r.domain}</div></td>
                  <td className="text-right tabular-nums">{r.keywords}</td><td className="text-right tabular-nums">{r.measured}</td>
                  <td className="text-right tabular-nums">{r.top3}</td><td className="text-right tabular-nums">{r.top10}</td><td className="text-right tabular-nums text-muted">{r.not_found}</td>
                  <td className="text-right tabular-nums text-good">{r.improved}</td><td className="text-right tabular-nums text-bad">{r.declined}</td>
                  <td className="text-muted" title={formatDateTime(r.last, r.timezone)}>{relativeTime(r.last)}</td>
                  <td className="text-muted">{r.next_run_at ? formatDateTime(r.next_run_at, r.timezone) : "Not scheduled"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
