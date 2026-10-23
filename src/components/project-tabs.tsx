"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: [string, string, boolean?][] = [
  ["", "Overview"], ["keywords", "Keywords"], ["rankings", "Organic Rankings"], ["competitors", "Competitors"], ["schedule", "Tracking Schedule"],
  ["maps", "Maps Grid", true], ["ai-visibility", "AI Visibility", true], ["citations", "Citations", true], ["search-console", "Search Console", true],
  ["analytics", "Google Analytics", true], ["reports", "Reports", true], ["settings", "Settings"],
];

export function ProjectTabs({ projectId }: { projectId: string }) {
  const path = usePathname();
  const base = `/projects/${projectId}`;
  return (
    <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-line bg-panel p-1 shadow-[var(--shadow-card)]">
      {TABS.map(([slug, label, planned]) => {
        const href = slug ? `${base}/${slug}` : base;
        const active = slug ? path.startsWith(href) : path === base;
        return (
          <Link key={slug} href={href} aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium transition ${active ? "bg-navy text-panel shadow-sm" : planned ? "text-faint hover:bg-panel-2 hover:text-muted" : "text-muted hover:bg-panel-2 hover:text-ink"}`}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
