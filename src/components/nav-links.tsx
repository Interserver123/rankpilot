"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ items }: { items: { href: string; label: string; planned?: boolean }[] }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 px-3">
      {items.map((i) => {
        const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href}
            className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm ${active ? "bg-accent/15 text-ink" : "text-muted hover:bg-panel-2 hover:text-ink"}`}>
            {i.label}
            {i.planned && <span className="text-[10px] uppercase text-faint">soon</span>}
          </Link>
        );
      })}
    </nav>
  );
}
