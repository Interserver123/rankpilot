import { requireProjectAccess } from "@/server/authz";
import { sql } from "@/server/db";
import { getLocations, keywordRankings, projectTags } from "@/server/queries";
import { canProject } from "@/lib/permissions";
import { Card, EmptyState, Pagination } from "@/components/ui";
import { AddKeywordsForm } from "./add-keywords-form";
import { KeywordTable } from "./keyword-table";

export default async function KeywordsPage({ params, searchParams }: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ q?: string; tag?: string; location?: string; device?: string; active?: string; page?: string }>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const { relation } = await requireProjectAccess(projectId, "project.view");
  const canManage = canProject(relation, "keyword.manage");
  const page = Number(sp.page) || 1;
  const [locations, tags, rows] = await Promise.all([
    getLocations(sql, projectId), projectTags(sql, projectId),
    keywordRankings(sql, projectId, {
      q: sp.q, tag: sp.tag, locationId: /^[0-9a-f-]{36}$/.test(sp.location ?? "") ? sp.location : undefined,
      device: sp.device === "desktop" || sp.device === "mobile" ? sp.device : undefined,
      active: sp.active === "active" || sp.active === "paused" ? sp.active : undefined, page, pageSize: 100,
    }),
  ]);
  const total = rows[0]?.total ?? 0;
  const qs = (p: number) => `?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v)), page: String(p) })}`;

  return (
    <div className="space-y-6">
      {canManage && (
        <Card title="Add keywords">
          <AddKeywordsForm projectId={projectId} locations={locations.map((l) => ({ id: l.id, name: l.name }))} />
        </Card>
      )}
      <Card title={`Keyword configurations (${total})`}>
        <form className="mb-4 flex flex-wrap gap-2">
          <input name="q" defaultValue={sp.q} placeholder="Search keywords" className="input max-w-56" />
          <select name="tag" defaultValue={sp.tag ?? ""} className="input max-w-40"><option value="">All tags</option>{tags.map((t) => <option key={t}>{t}</option>)}</select>
          <select name="location" defaultValue={sp.location ?? ""} className="input max-w-48"><option value="">All locations</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          <select name="device" defaultValue={sp.device ?? ""} className="input max-w-36"><option value="">All devices</option><option value="desktop">Desktop</option><option value="mobile">Mobile</option></select>
          <select name="active" defaultValue={sp.active ?? ""} className="input max-w-36"><option value="">Any status</option><option value="active">Active</option><option value="paused">Paused</option></select>
          <button className="btn-secondary">Filter</button>
        </form>
        {rows.length === 0 ? (
          <EmptyState title={total === 0 && !sp.q ? "No keywords yet" : "No keywords match"}>Add keywords manually or import a CSV above.</EmptyState>
        ) : (
          <KeywordTable projectId={projectId} canManage={canManage} canRefresh={canProject(relation, "scan.manual")}
            rows={rows.map((r) => ({ id: r.id, keyword: r.keyword, location: r.location_name, device: r.device, language: r.language, tags: r.tags, isActive: r.is_active, targetUrl: r.target_url, lastStatus: r.last_target_status }))} />
        )}
        <Pagination page={page} total={total} pageSize={100} hrefFor={qs} />
      </Card>
    </div>
  );
}
