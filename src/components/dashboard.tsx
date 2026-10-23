import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/**
 * Mini bar sparkline over a fixed number of slots (latest on the right, emphasized).
 * Needs at least two points; otherwise shows a placeholder instead of a misleading single bar.
 */
export function Sparkbars({ values, tone = "accent", height = 40, invert = false, slots = 10 }: { values: number[]; tone?: "accent" | "bad" | "warn"; height?: number; invert?: boolean; slots?: number }) {
  const v = values.slice(-slots);
  if (v.length < 2) {
    return (
      <div className="flex items-end gap-1.5" style={{ height }} title="Builds up as more checks are collected">
        {Array.from({ length: slots }, (_, i) => <div key={i} className="flex-1 rounded-[4px] bg-panel-2" style={{ height: "18%" }} />)}
      </div>
    );
  }
  const max = Math.max(...v);
  const min = Math.min(...v);
  const scale = (x: number) => {
    if (max === min) return 0.55;
    const r = (x - min) / (max - min);
    return 0.18 + 0.82 * (invert ? 1 - r : r);
  };
  const color = tone === "bad" ? "var(--color-bad)" : tone === "warn" ? "var(--color-warn)" : "var(--color-accent)";
  const pad = slots - v.length;
  return (
    <div className="flex items-end gap-1.5" style={{ height }} aria-hidden>
      {Array.from({ length: pad }, (_, i) => <div key={`p${i}`} className="flex-1 rounded-[4px] bg-panel-2" style={{ height: "18%" }} />)}
      {v.map((x, i) => (
        <div key={i} className="flex-1 rounded-[4px] transition-all"
          style={{ height: `${scale(x) * 100}%`, background: color, opacity: i === v.length - 1 ? 1 : 0.22 + (i / v.length) * 0.3 }} />
      ))}
    </div>
  );
}

export function DeltaChip({ delta, betterWhen = "up", suffix = "", precision = 0 }: { delta: number | null; betterWhen?: "up" | "down"; suffix?: string; precision?: number }) {
  if (delta === null || !Number.isFinite(delta)) return null;
  if (Math.abs(delta) < 10 ** -precision / 2) return <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[11px] font-semibold text-muted">±0{suffix}</span>;
  const good = betterWhen === "up" ? delta > 0 : delta < 0;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${good ? "bg-good/10 text-good" : "bg-bad/10 text-bad"}`}>
      <Icon name={delta > 0 ? "up" : "down"} size={11} strokeWidth={2.4} />
      {delta > 0 ? "+" : ""}{delta.toFixed(precision)}{suffix}
    </span>
  );
}

export function KpiCard({ label, value, unit, delta, spark, hint, icon, emphasis = false }: {
  label: string; value: ReactNode; unit?: string; delta?: ReactNode; spark?: ReactNode; hint?: ReactNode; icon: IconName; emphasis?: boolean;
}) {
  return (
    <div className={`card relative flex flex-col overflow-hidden p-5 ${emphasis ? "bg-gradient-to-br from-accent-soft/70 to-panel" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-accent"><Icon name={icon} size={16} /></span>
          <span className="eyebrow">{label}</span>
        </div>
        {delta}
      </div>
      <div className="mt-4 flex items-baseline gap-1">
        <span className="font-display text-[34px] font-semibold leading-none text-ink">{value}</span>
        {unit && <span className="text-sm font-medium text-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-1.5 text-xs text-muted">{hint}</div>}
      {spark && <div className="mt-auto pt-4">{spark}</div>}
    </div>
  );
}

/** Circular gauge for a 0–100 share. */
export function Ring({ pct, size = 112, label }: { pct: number | null; size?: number; label: string }) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const p = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-panel-2)" strokeWidth={10} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-accent)" strokeWidth={10} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)} />
      </svg>
      <div className="absolute text-center">
        <div className="font-display text-2xl font-semibold">{pct === null ? "—" : `${Math.round(p)}%`}</div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">{label}</div>
      </div>
    </div>
  );
}

const SEVERITY: Record<string, { dot: string; chip: string; label: string }> = {
  critical: { dot: "bg-bad", chip: "bg-bad/10 text-bad", label: "Fix now" },
  warning: { dot: "bg-warn", chip: "bg-warn/10 text-warn", label: "Soon" },
  info: { dot: "bg-accent", chip: "bg-accent-soft text-accent", label: "Improve" },
};

export function ActionList({ items, empty }: { items: { id: string; severity: string; title: string; detail: string; href: string; cta: string }[]; empty: ReactNode }) {
  if (items.length === 0) return <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted"><span className="grid h-10 w-10 place-items-center rounded-full bg-good/10 text-good"><Icon name="check" /></span>{empty}</div>;
  return (
    <ul className="space-y-2.5">
      {items.map((a) => {
        const s = SEVERITY[a.severity] ?? SEVERITY.info!;
        return (
          <li key={a.id}>
            <Link href={a.href} className="group block rounded-xl border border-line bg-panel p-3.5 transition hover:border-accent/40 hover:shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-semibold"><span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} />{a.title}</span>
                <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${s.chip}`}>{s.label}</span>
              </div>
              <p className="mt-1 line-clamp-2 pl-4 text-xs text-muted">{a.detail}</p>
              <span className="mt-2 inline-flex items-center gap-1 pl-4 text-xs font-semibold text-accent opacity-80 group-hover:opacity-100">{a.cta}<Icon name="arrowRight" size={12} /></span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function SegmentedLinks({ options, active }: { options: { label: string; href: string; value: string }[]; active: string }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-panel-2 p-0.5 text-xs font-semibold">
      {options.map((o) => (
        <Link key={o.value} href={o.href} scroll={false}
          className={`rounded-[10px] px-3 py-1.5 transition ${o.value === active ? "bg-navy text-panel shadow-sm" : "text-muted hover:text-ink"}`}>{o.label}</Link>
      ))}
    </div>
  );
}
