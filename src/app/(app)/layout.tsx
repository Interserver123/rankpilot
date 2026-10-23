import Link from "next/link";
import { requireStaff, visibleProjectsFilter } from "@/server/authz";
import { sql } from "@/server/db";
import { NavLinks } from "@/components/nav-links";
import { ProjectSwitcher } from "@/components/project-switcher";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/projects", label: "Projects" },
  { href: "/rank-tracking", label: "Rank Tracking" },
  { href: "/maps-grid", label: "Maps Grid", planned: true },
  { href: "/ai-visibility", label: "AI Visibility", planned: true },
  { href: "/citations", label: "Citations", planned: true },
  { href: "/analytics", label: "Analytics", planned: true },
  { href: "/reports", label: "Reports", planned: true },
  { href: "/alerts", label: "Alerts", planned: true },
  { href: "/jobs", label: "Job Monitor" },
  { href: "/integrations", label: "Integrations" },
  { href: "/usage", label: "Usage & Costs" },
  { href: "/settings", label: "Settings" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff();
  const projects = await sql<{ id: string; name: string; domain: string }[]>`
    select p.id, p.name, p.domain from projects p where ${visibleProjectsFilter(sql, user)} and p.status <> 'archived' order by p.name`;
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-line bg-panel md:flex">
        <Link href="/" className="px-5 py-5">
          <div className="text-base font-semibold tracking-tight">Rank<span className="text-accent">Pilot</span></div>
          <div className="text-[11px] text-faint">SEO operations</div>
        </Link>
        <NavLinks items={NAV} />
        <div className="mt-auto border-t border-line p-4 text-xs text-muted">
          <div className="truncate" title={user.email}>{user.email}</div>
          <div className="mb-2 capitalize text-faint">{user.role}</div>
          <form action="/auth/sign-out" method="post"><button className="link text-xs">Sign out</button></form>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-bg/90 px-4 py-3 backdrop-blur md:px-8">
          <ProjectSwitcher projects={projects} />
          <form action="/search" className="ml-auto w-full max-w-xs">
            <input name="q" className="input" placeholder="Search projects, keywords, domains…" aria-label="Global search" />
          </form>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
