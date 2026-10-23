"use client";

import { useState, useTransition } from "react";
import { ScheduleEditor, type Sched } from "@/components/schedule-editor";
import { updateScheduleAction } from "../actions";

export function ScheduleForm({ projectId, module, initial, disabled }: { projectId: string; module: string; initial: Sched; disabled: boolean }) {
  const [value, setValue] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <ScheduleEditor label="Enabled" value={value} onChange={(v) => { setValue(v); setMsg(null); }} />
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={!dirty || pending} onClick={() => start(async () => {
          const r = await updateScheduleAction(projectId, module, value);
          setMsg({ ok: Boolean(r.ok), text: r.error ?? r.message ?? "" });
        })}>{pending ? "Saving…" : "Save schedule"}</button>
        {msg && <span className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</span>}
      </div>
    </fieldset>
  );
}
