"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icons";

export interface NavGroup { label: string; items: { href: string; label: string; icon: IconName; planned?: boolean }[] }

export function NavLinks({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  return (
    <nav className="space-y-5 px-3">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-faint">{g.label}</div>
          <div className="space-y-0.5">
            {g.items.map((i) => {
              const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
              return (
                <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}
                  className={`group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${active ? "bg-accent-soft text-accent" : i.planned ? "text-faint hover:bg-panel-2 hover:text-muted" : "text-muted hover:bg-panel-2 hover:text-ink"}`}>
                  {active && <span className="absolute -left-3 top-1.5 h-[calc(100%-12px)] w-1 rounded-r-full bg-accent" />}
                  <Icon name={i.icon} size={18} />
                  <span className="flex-1">{i.label}</span>
                  {i.planned && <span className="rounded-md bg-panel-2 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-faint">Soon</span>}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
