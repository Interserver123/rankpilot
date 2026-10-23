/** Lightweight SVG charts (server-renderable, no client JS). */

export interface RankPoint { at: Date; position: number | null; depth: number }

/**
 * Rank history line chart. Y axis is inverted (1 at top). Not-found observations are drawn as
 * hollow markers on the "not in top N" baseline and break the line; they are never plotted as a rank.
 */
export function RankHistoryChart({ points, height = 220, title }: { points: RankPoint[]; height?: number; title: string }) {
  const width = 720;
  const pad = { l: 40, r: 16, t: 12, b: 28 };
  const sorted = [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
  if (sorted.length === 0) return null;
  const maxRank = Math.max(10, ...sorted.map((p) => p.position ?? 0));
  const floor = maxRank + Math.ceil(maxRank * 0.08) + 1; // "not found" lane
  const t0 = sorted[0]!.at.getTime();
  const t1 = sorted[sorted.length - 1]!.at.getTime();
  const x = (d: Date) => pad.l + (t1 === t0 ? (width - pad.l - pad.r) / 2 : ((d.getTime() - t0) / (t1 - t0)) * (width - pad.l - pad.r));
  const y = (r: number) => pad.t + ((r - 1) / (floor - 1)) * (height - pad.t - pad.b);

  const segments: string[] = [];
  let cur: string[] = [];
  for (const p of sorted) {
    if (p.position === null) { if (cur.length) segments.push(cur.join(" ")); cur = []; continue; }
    cur.push(`${cur.length ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.position).toFixed(1)}`);
  }
  if (cur.length) segments.push(cur.join(" "));
  const ticks = [1, ...[5, 10, 20, 50, 100].filter((t) => t < maxRank)];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={title}>
      <title>{title}</title>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeDasharray="3 4" />
          <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--color-faint)">{t}</text>
        </g>
      ))}
      <text x={pad.l - 8} y={y(floor) + 4} textAnchor="end" fontSize="10" fill="var(--color-faint)">n/f</text>
      {segments.map((d, i) => <path key={i} d={d} fill="none" stroke="var(--color-accent)" strokeWidth="2" />)}
      {sorted.map((p, i) => p.position === null
        ? <circle key={i} cx={x(p.at)} cy={y(floor)} r="4" fill="none" stroke="var(--color-bad)" strokeWidth="1.5"><title>{`${p.at.toISOString().slice(0, 10)}: not in top ${p.depth}`}</title></circle>
        : <circle key={i} cx={x(p.at)} cy={y(p.position)} r="3.5" fill="var(--color-accent)"><title>{`${p.at.toISOString().slice(0, 10)}: #${p.position}`}</title></circle>)}
      <text x={pad.l} y={height - 8} fontSize="11" fill="var(--color-faint)">{sorted[0]!.at.toISOString().slice(0, 10)}</text>
      <text x={width - pad.r} y={height - 8} textAnchor="end" fontSize="11" fill="var(--color-faint)">{sorted[sorted.length - 1]!.at.toISOString().slice(0, 10)}</text>
    </svg>
  );
}

export function DistributionBars({ items }: { items: { label: string; value: number; tone?: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-2">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-3 text-sm">
          <div className="w-20 shrink-0 text-muted">{i.label}</div>
          <div className="h-2.5 flex-1 rounded bg-panel-2">
            <div className="h-2.5 rounded" style={{ width: `${(i.value / max) * 100}%`, background: i.tone ?? "var(--color-accent)" }} />
          </div>
          <div className="w-10 text-right tabular-nums">{i.value}</div>
        </div>
      ))}
    </div>
  );
}

export function BarSeries({ data, format }: { data: { label: string; value: number }[]; format: (n: number) => string }) {
  const max = Math.max(0, ...data.map((d) => d.value));
  if (data.length === 0) return null;
  return (
    <div className="flex h-32 items-end gap-1">
      {data.map((d) => (
        <div key={d.label} className="flex flex-1 flex-col items-center justify-end" title={`${d.label}: ${format(d.value)}`}>
          <div className="w-full rounded-t bg-accent/70" style={{ height: `${max ? Math.max(2, (d.value / max) * 100) : 0}%` }} />
        </div>
      ))}
    </div>
  );
}
