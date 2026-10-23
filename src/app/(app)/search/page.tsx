import Link from "next/link";
import { requireStaff, visibleProjectsFilter } from "@/server/authz";
import { sql } from "@/server/db";
import { globalSearch } from "@/server/queries";
import { Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireStaff();
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  if (!q) return <EmptyState title="Search across projects">Search project names, domains, business names and keywords from the top bar.</EmptyState>;
  const r = await globalSearch(sql, visibleProjectsFilter(sql, user), q);
  const none = !r.projects.length && !r.locations.length && !r.keywords.length;
  return (
    <div className="space-y-4">
      <PageHeader title={`Results for “${q}”`} />
      {none && <EmptyState title="Nothing found" />}
      {r.projects.length > 0 && <Card title="Projects & domains"><ul className="space-y-1 text-sm">{r.projects.map((p) => <li key={p.id}><Link className="link" href={`/projects/${p.id}`}>{p.name}</Link> <span className="text-muted">· {p.domain} · {p.client_name}</span></li>)}</ul></Card>}
      {r.locations.length > 0 && <Card title="Business names & locations"><ul className="space-y-1 text-sm">{r.locations.map((l) => <li key={l.id}><Link className="link" href={`/projects/${l.project_id}/settings`}>{l.business_name ?? l.name}</Link> <span className="text-muted">· {l.name} · {l.project_name}</span></li>)}</ul></Card>}
      {r.keywords.length > 0 && <Card title="Keywords"><ul className="space-y-1 text-sm">{r.keywords.map((k) => <li key={k.id}><Link className="link" href={`/projects/${k.project_id}/rankings/${k.id}`}>{k.keyword}</Link> <span className="text-muted">· {k.project_name}</span></li>)}</ul></Card>}
    </div>
  );
}
