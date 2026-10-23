import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[28px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "", footer }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; footer?: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="font-display text-base font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
      {footer && <footer className="rounded-b-2xl border-t border-line bg-panel-2/60 px-5 py-2.5 text-xs text-faint">{footer}</footer>}
    </section>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: ReactNode; href?: string }) {
  const body = (
    <div className="card h-full p-5 transition hover:border-accent/40">
      <div className="eyebrow">{label}</div>
      <div className="font-display mt-2 text-3xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-faint">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

const TONES = {
  neutral: "bg-panel-2 text-muted border-transparent",
  good: "bg-good/10 text-good border-transparent",
  warn: "bg-warn/10 text-warn border-transparent",
  bad: "bg-bad/10 text-bad border-transparent",
  info: "bg-accent-soft text-accent border-transparent",
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONES[tone]}`}>{children}</span>;
}

const JOB_TONES: Record<string, Tone> = {
  queued: "info", running: "info", completed: "good", partial: "warn", failed: "bad", cancelled: "neutral", awaiting_approval: "warn",
  pending: "neutral", in_flight: "info", succeeded: "good", uncertain: "warn", skipped: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={JOB_TONES[status] ?? "neutral"}><span className="capitalize">{status.replace(/_/g, " ")}</span></Badge>;
}

export function EmptyState({ title, children, action, icon = "rocket" }: { title: string; children?: ReactNode; action?: ReactNode; icon?: IconName }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-panel/60 px-6 py-14 text-center">
      <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent"><Icon name={icon} size={22} /></span>
      <div className="font-display text-base font-semibold">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`rounded-xl border px-4 py-3 text-sm ${TONES[tone]}`}>{children}</div>;
}

export function Pagination({ page, total, pageSize, hrefFor }: { page: number; total: number; pageSize: number; hrefFor: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-3 text-sm text-muted">
      <span>Page {page} of {pages} · {total} items</span>
      <div className="flex gap-2">
        {page > 1 && <Link className="btn-secondary" href={hrefFor(page - 1)}>Previous</Link>}
        {page < pages && <Link className="btn-secondary" href={hrefFor(page + 1)}>Next</Link>}
      </div>
    </div>
  );
}

/** Data-provenance footer used on every data module. */
export function Provenance({ source, updated, next, extra }: { source: string; updated?: string; next?: string; extra?: ReactNode }) {
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1">
      <span>Source: {source}</span>
      {updated && <span>Last updated: {updated}</span>}
      {next && <span>Next scheduled: {next}</span>}
      {extra}
    </span>
  );
}

export function PlannedModule({ title, phase, children, icon = "rocket" }: { title: string; phase: string; children: ReactNode; icon?: IconName }) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-accent-soft via-panel to-panel p-10 md:p-14">
      <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-navy text-accent shadow-sm"><Icon name={icon} size={26} /></span>
      <div className="mt-6"><Badge tone="info">On the roadmap · {phase}</Badge></div>
      <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 max-w-xl text-[15px] text-muted">{children}</p>
      <p className="mt-6 max-w-xl text-xs text-faint">The data model for this module is already in place, so it can ship without changing existing projects or history.</p>
    </div>
  );
}
