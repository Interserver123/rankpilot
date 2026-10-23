"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  ["", "Overview"], ["keywords", "Keywords"], ["rankings", "Organic Rankings"], ["maps", "Maps Grid"], ["ai-visibility", "AI Visibility"],
  ["citations", "Citations"], ["search-console", "Search Console"], ["analytics", "Google Analytics"], ["competitors", "Competitors"],
  ["reports", "Reports"], ["schedule", "Tracking Schedule"], ["settings", "Settings"],
] as const;

export function ProjectTabs({ projectId }: { projectId: string }) {
  const path = usePathname();
  const base = `/projects/${projectId}`;
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b border-line pb-px">
      {TABS.map(([slug, label]) => {
        const href = slug ? `${base}/${slug}` : base;
        const active = slug ? path.startsWith(href) : path === base;
        return (
          <Link key={slug} href={href} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
