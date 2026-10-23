import Link from "next/link";
import { requireStaff, visibleProjectsFilter } from "@/server/authz";
import { sql } from "@/server/db";
import { canOrg } from "@/lib/permissions";
import { NavLinks, type NavGroup } from "@/components/nav-links";
import { ProjectSwitcher } from "@/components/project-switcher";
import { Icon } from "@/components/icons";

export const dynamic = "force-dynamic";

const NAV: NavGroup[] = [
  { label: "Workspace", items: [
    { href: "/", label: "Overview", icon: "overview" },
    { href: "/projects", label: "Projects", icon: "projects" },
    { href: "/rank-tracking", label: "Rank Tracking", icon: "rank" },
    { href: "/alerts", label: "Action Center", icon: "bell" },
  ] },
  { label: "Search intelligence", items: [
    { href: "/maps-grid", label: "Maps Grid", icon: "map", planned: true },
    { href: "/ai-visibility", label: "AI Visibility", icon: "ai", planned: true },
    { href: "/citations", label: "Citations", icon: "citation", planned: true },
    { href: "/analytics", label: "Analytics", icon: "analytics", planned: true },
    { href: "/reports", label: "Reports", icon: "report", planned: true },
  ] },
  { label: "Operations", items: [
    { href: "/jobs", label: "Job Monitor", icon: "jobs" },
    { href: "/usage", label: "Usage & Costs", icon: "wallet" },
    { href: "/integrations", label: "Integrations", icon: "plug" },
    { href: "/settings", label: "Settings", icon: "settings" },
  ] },
];

function initials(s: string) {
  const parts = s.replace(/@.*/, "").split(/[._\s-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "U";
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff();
  const filter = visibleProjectsFilter(sql, user);
  const projects = await sql<{ id: string; name: string; domain: string }[]>`
    select p.id, p.name, p.domain from projects p where ${filter} and p.status <> 'archived' order by p.name`;
  const [org] = await sql<{ name: string }[]>`select name from organizations where id = ${user.organizationId}`;
  const [{ n: attention } = { n: 0 }] = await sql<{ n: number }[]>`
    select count(*)::int as n from tracking_jobs j join projects p on p.id = j.project_id
    where ${filter} and (j.status = 'awaiting_approval' or (j.status in ('failed', 'partial') and j.completed_at > now() - interval '24 hours')
      or (j.status = 'queued' and j.run_after < now() - interval '15 minutes'))`;
  const displayName = user.name ?? user.email.split("@")[0]!;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-panel md:flex">
        <Link href="/" className="flex items-center gap-3 px-6 pb-6 pt-6">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy text-accent shadow-sm"><Icon name="rocket" size={20} /></span>
          <span>
            <span className="font-display block text-lg font-bold leading-tight">Rank<span className="text-accent">Pilot</span></span>
            <span className="block max-w-36 truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">{org?.name ?? "SEO operations"}</span>
          </span>
        </Link>
        <div className="flex-1 overflow-y-auto pb-4"><NavLinks groups={NAV} /></div>
        <div className="space-y-3 border-t border-line p-4">
          {canOrg(user.role, "project.create") && (
            <Link href="/projects/new" className="btn-primary w-full"><Icon name="plus" size={16} />New project</Link>
          )}
          <div className="flex items-center gap-3 rounded-xl bg-panel-2 p-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-navy text-xs font-bold text-white">{initials(displayName)}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold capitalize">{displayName}</div>
              <div className="text-[11px] capitalize text-faint">{user.role}</div>
            </div>
            <form action="/auth/sign-out" method="post">
              <button className="rounded-lg p-1.5 text-faint hover:bg-panel hover:text-bad" title="Sign out" aria-label="Sign out"><Icon name="logout" size={16} /></button>
            </form>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-bg/80 px-4 py-3 backdrop-blur-xl md:px-8">
          <ProjectSwitcher projects={projects} />
          <form action="/search" className="relative ml-auto w-full max-w-md">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"><Icon name="search" size={16} /></span>
            <input name="q" className="input pl-9" placeholder="Search projects, keywords, domains, businesses…" aria-label="Global search" />
          </form>
          <Link href="/alerts" className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-panel text-muted hover:text-ink" aria-label={`Action center${attention ? `, ${attention} items need attention` : ""}`}>
            <Icon name="bell" size={18} />
            {attention > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-bad px-1 text-[10px] font-bold text-white">{attention > 9 ? "9+" : attention}</span>}
          </Link>
        </header>
        <main className="min-w-0 flex-1 px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
