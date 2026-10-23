import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "", footer }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; footer?: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
      {footer && <footer className="border-t border-line px-4 py-2 text-xs text-faint">{footer}</footer>}
    </section>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: ReactNode; href?: string }) {
  const body = (
    <div className="card h-full p-4 transition hover:border-accent/50">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-faint">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

const TONES = {
  neutral: "bg-panel-2 text-muted border-line",
  good: "bg-good/10 text-good border-good/30",
  warn: "bg-warn/10 text-warn border-warn/30",
  bad: "bg-bad/10 text-bad border-bad/30",
  info: "bg-accent/10 text-accent border-accent/30",
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

const JOB_TONES: Record<string, Tone> = {
  queued: "info", running: "info", completed: "good", partial: "warn", failed: "bad", cancelled: "neutral", awaiting_approval: "warn",
  pending: "neutral", in_flight: "info", succeeded: "good", uncertain: "warn", skipped: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={JOB_TONES[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-12 text-center">
      <div className="text-sm font-semibold">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`rounded-lg border px-3 py-2 text-sm ${TONES[tone]}`}>{children}</div>;
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

export function PlannedModule({ title, phase, children }: { title: string; phase: string; children: ReactNode }) {
  return (
    <div>
      <PageHeader title={title} subtitle={<Badge tone="info">Planned · {phase}</Badge>} />
      <EmptyState title={`${title} is not enabled yet`}>{children}</EmptyState>
    </div>
  );
}
