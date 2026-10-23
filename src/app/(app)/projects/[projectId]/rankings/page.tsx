import Link from "next/link";
import { requireProjectAccess } from "@/server/authz";
import { sql } from "@/server/db";
import { getLocations, getProject, getTrackingConfigs, keywordRankings, projectTags } from "@/server/queries";
import { defaultSerpProvider } from "@/server/providers/registry";
import { canProject } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";
import { changeInfo, parseRankFilters, positionLabel, toObserved, trackingStatus, type RankSearchParams as SP } from "@/lib/rank-display";
import { Card, EmptyState, Pagination, Provenance } from "@/components/ui";
import { RankingsTable } from "./rankings-table";

export default async function RankingsPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<SP> }) {
  const { projectId } = await params;
  const sp = await searchParams;
  const { relation } = await requireProjectAccess(projectId, "project.view");
  const f = parseRankFilters(sp);
  const [project, locations, tags, rows, configs] = await Promise.all([
    getProject(sql, projectId), getLocations(sql, projectId), projectTags(sql, projectId), keywordRankings(sql, projectId, f), getTrackingConfigs(sql, projectId),
  ]);
  const tz = project!.timezone;
  const organic = configs.find((c) => c.module === "organic");
  const nextRun = organic?.enabled && organic.next_run_at ? formatDateTime(organic.next_run_at, tz) : "Not scheduled";
  const total = rows[0]?.total ?? 0;
  const query = (over: Record<string, string>) => `?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v)), ...over })}`;
  const sortLink = (key: string) => query({ sort: key, dir: f.sort === key && f.dir === "asc" ? "desc" : "asc", page: "1" });
  const provider = defaultSerpProvider();

  return (
    <Card title={`Organic rankings (${total})`}
      actions={<a className="btn-secondary" href={`/projects/${projectId}/rankings/export${query({})}`}>Export CSV</a>}
      footer={<Provenance source="Independently collected, location-specific Google organic results. Not the same as Search Console average position."
        updated={organic?.last_success_at ? formatDateTime(organic.last_success_at, tz) : "never"} next={nextRun}
        extra={<span>Search volume is not shown: no supported volume source is connected.{provider?.id === "mock" ? " Mock provider data is synthetic." : ""}</span>} />}>
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Search keywords" className="input max-w-56" />
        <select name="tag" defaultValue={sp.tag ?? ""} className="input max-w-40"><option value="">All tags</option>{tags.map((t) => <option key={t}>{t}</option>)}</select>
        <select name="location" defaultValue={sp.location ?? ""} className="input max-w-48"><option value="">All locations</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        <select name="device" defaultValue={sp.device ?? ""} className="input max-w-36"><option value="">All devices</option><option value="desktop">Desktop</option><option value="mobile">Mobile</option></select>
        <button className="btn-secondary">Filter</button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No keywords to show" action={<Link className="btn-primary" href={`/projects/${projectId}/keywords`}>Add keywords</Link>}>Add keywords to start tracking rankings.</EmptyState>
      ) : (
        <RankingsTable projectId={projectId} canRefresh={canProject(relation, "scan.manual")} nextRun={nextRun}
          sortLinks={{ keyword: sortLink("keyword"), position: sortLink("position"), change: sortLink("change"), checked: sortLink("checked") }}
          rows={rows.map((r) => {
            const cur = toObserved(r.cur_status, r.cur_pos, r.cur_depth);
            const prev = toObserved(r.prev_status, r.prev_pos, r.prev_depth);
            const status = trackingStatus({ isActive: r.is_active, collectedAt: r.collected_at, lastTargetStatus: r.last_target_status, lastTargetAt: r.last_target_at, lastTargetError: r.last_target_error });
            return {
              id: r.id, keyword: r.keyword, location: r.location_name, device: r.device, requestedLocation: r.requested_location,
              current: positionLabel(cur), previous: positionLabel(prev), change: changeInfo(cur, prev),
              url: r.ranking_url, features: r.serp_features ?? [], lastChecked: r.collected_at ? formatDateTime(r.collected_at, tz) : "Never",
              status, provider: r.provider,
            };
          })} />
      )}
      <Pagination page={f.page ?? 1} total={total} pageSize={50} hrefFor={(p) => query({ page: String(p) })} />
    </Card>
  );
}
