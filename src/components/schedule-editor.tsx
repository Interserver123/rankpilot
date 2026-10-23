"use client";

import { INTERVAL_PRESETS, type IntervalUnit } from "@/lib/schedule";

export interface Sched { enabled: boolean; intervalValue: number; intervalUnit: IntervalUnit; preferredRunTime: string }

export function ScheduleEditor({ label, note, value, onChange }: { label: string; note?: string; value: Sched; onChange: (s: Sched) => void }) {
  const preset = INTERVAL_PRESETS.find((p) => p.value === value.intervalValue && p.unit === value.intervalUnit);
  return (
    <div className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 font-medium">
          <input type="checkbox" checked={value.enabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} /> {label}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-40" value={preset ? `${preset.value}:${preset.unit}` : "custom"} disabled={!value.enabled}
            onChange={(e) => { if (e.target.value !== "custom") { const [v, u] = e.target.value.split(":"); onChange({ ...value, intervalValue: Number(v), intervalUnit: u as IntervalUnit }); } else onChange({ ...value, intervalValue: 10 }); }}>
            {INTERVAL_PRESETS.map((p) => <option key={p.label} value={`${p.value}:${p.unit}`}>{p.label}</option>)}
            <option value="custom">Custom…</option>
          </select>
          {!preset && (
            <>
              <input type="number" min={1} max={365} className="input w-20" value={value.intervalValue} disabled={!value.enabled} onChange={(e) => onChange({ ...value, intervalValue: Math.max(1, Number(e.target.value) || 1) })} />
              <select className="input w-24" value={value.intervalUnit} disabled={!value.enabled} onChange={(e) => onChange({ ...value, intervalUnit: e.target.value as IntervalUnit })}>
                <option value="day">days</option><option value="week">weeks</option><option value="month">months</option>
              </select>
            </>
          )}
          <span className="text-sm text-muted">at</span>
          <input type="time" className="input w-36" value={value.preferredRunTime} disabled={!value.enabled} onChange={(e) => onChange({ ...value, preferredRunTime: e.target.value })} />
        </div>
      </div>
      {note && <p className="mt-2 text-xs text-faint">{note}</p>}
    </div>
  );
}

