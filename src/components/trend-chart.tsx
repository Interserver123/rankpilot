"use client";

import { useMemo, useState } from "react";

export interface TrendPoint { day: string; value: number | null; secondary?: number | null; note?: string }

/**
 * Smooth area chart with hover tooltip. Days without data are skipped (never drawn as zero).
 * `domain` fixes the Y range (e.g. [0, 100] for percentages).
 */
export function TrendChart({ points, domain, format: fmtKind, label, secondaryLabel, height = 260, invert = false }: {
  points: TrendPoint[]; domain?: [number, number]; invert?: boolean; format: "percent" | "decimal"; label: string; secondaryLabel?: string; height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const format = (n: number) => (fmtKind === "percent" ? `${Math.round(n)}%` : n.toFixed(1));
  const width = 760;
  const pad = { l: 44, r: 16, t: 16, b: 30 };
  const data = points.filter((p) => p.value !== null) as (TrendPoint & { value: number })[];

  const geo = useMemo(() => {
    if (data.length === 0) return null;
    const vals = data.map((d) => d.value);
    const [lo, hi] = domain ?? [Math.max(0, Math.min(...vals) * 0.85), Math.max(...vals) * 1.15 || 1];
    const t = data.map((d) => new Date(`${d.day}T00:00:00Z`).getTime());
    const t0 = t[0]!, t1 = t[t.length - 1]!;
    const x = (i: number) => pad.l + (t1 === t0 ? (width - pad.l - pad.r) / 2 : ((t[i]! - t0) / (t1 - t0)) * (width - pad.l - pad.r));
    const frac = (v: number) => (v - lo) / (hi - lo || 1);
    const y = (v: number) => pad.t + (invert ? frac(v) : 1 - frac(v)) * (height - pad.t - pad.b);
    const pts = data.map((d, i) => [x(i), y(d.value)] as const);
    // Catmull-Rom → cubic Bézier for a smooth but faithful line.
    let line = `M${pts[0]![0]},${pts[0]![1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[i + 2] ?? p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      line += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
    }
    const area = `${line} L${pts[pts.length - 1]![0]},${height - pad.b} L${pts[0]![0]},${height - pad.b} Z`;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));
    return { pts, line, area, ticks, y };
  }, [data, domain, height, invert]);

  if (!geo) return <div className="grid place-items-center text-sm text-muted" style={{ height }}>No observations in this period yet.</div>;
  const h = hover !== null ? data[hover] : null;
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={label}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const mx = ((e.clientX - rect.left) / rect.width) * width;
          let best = 0;
          geo.pts.forEach((p, i) => { if (Math.abs(p[0] - mx) < Math.abs(geo.pts[best]![0] - mx)) best = i; });
          setHover(best);
        }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {geo.ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={width - pad.r} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--color-line)" strokeDasharray={i === 0 ? undefined : "4 6"} />
            <text x={pad.l - 10} y={geo.y(t) + 4} textAnchor="end" fontSize="11" fill="var(--color-faint)">{fmtKind === "percent" ? format(t) : Math.round(t)}</text>
          </g>
        ))}
        <path d={geo.area} fill="url(#trendFill)" />
        <path d={geo.line} fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" />
        {data.map((d, i) => i % labelEvery === 0 || i === data.length - 1 ? (
          <text key={d.day} x={geo.pts[i]![0]} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--color-faint)">
            {new Date(`${d.day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
          </text>
        ) : null)}
        {geo.pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={hover === i ? 5 : data.length < 20 ? 3 : 0} fill="var(--color-panel)" stroke="var(--color-accent)" strokeWidth="2" />)}
        {hover !== null && <line x1={geo.pts[hover]![0]} x2={geo.pts[hover]![0]} y1={pad.t} y2={height - pad.b} stroke="var(--color-accent)" strokeOpacity="0.35" />}
      </svg>
      {h && hover !== null && (
        <div className="pointer-events-none absolute -translate-x-1/2 rounded-xl border border-line bg-panel px-3 py-2 text-xs shadow-lg"
          style={{ left: `${(geo.pts[hover]![0] / width) * 100}%`, top: 0 }}>
          <div className="font-semibold">{new Date(`${h.day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</div>
          <div className="text-muted">{label}: <span className="font-semibold text-ink">{format(h.value)}</span></div>
          {secondaryLabel && h.secondary != null && <div className="text-muted">{secondaryLabel}: <span className="font-semibold text-ink">{h.secondary}</span></div>}
          {h.note && <div className="text-faint">{h.note}</div>}
        </div>
      )}
    </div>
  );
}
