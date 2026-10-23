"use client";

import { useActionState } from "react";
import { removeKeysAction, saveKeysAction, testKeysAction, type KeyState } from "./actions";

export interface KeyFormField { key: string; label: string; secret: boolean; placeholder?: string; help?: string; hasValue: boolean; hint: string | null; value: string | null; source: "dashboard" | "environment" | "none" }

function Result({ s }: { s: KeyState }) {
  if (s.error) return <span className="text-sm text-bad">{s.error}</span>;
  if (s.ok) return <span className="text-sm text-good">{s.message ?? "Done."}</span>;
  return null;
}

/** Write-only key entry: stored secrets are never sent back to the browser, only their last 4 characters. */
export function KeyForm({ providerId, fields, canSave, hasSaved }: { providerId: string; fields: KeyFormField[]; canSave: boolean; hasSaved: boolean }) {
  const [saveState, save, saving] = useActionState<KeyState, FormData>(saveKeysAction, {});
  const [testState, test, testing] = useActionState<KeyState, FormData>(testKeysAction, {});
  const [removeState, remove, removing] = useActionState<KeyState, FormData>(removeKeysAction, {});
  return (
    <div className="mt-4 border-t border-line pt-4">
      <form action={save} autoComplete="off" className="space-y-3">
        <input type="hidden" name="provider" value={providerId} />
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className="label">{f.label}</span>
            <input
              name={f.key}
              type={f.secret ? "password" : "text"}
              inputMode={f.secret ? undefined : "decimal"}
              autoComplete="off"
              spellCheck={false}
              defaultValue={f.secret ? "" : f.value ?? ""}
              placeholder={f.secret ? (f.hasValue ? `Saved ••••${f.hint ?? ""} — leave blank to keep` : f.placeholder ?? "") : f.placeholder}
              disabled={!canSave}
              className="input w-full max-w-md"
            />
            {f.help && <span className="mt-1 block text-xs text-faint">{f.help}</span>}
            {f.secret && f.source === "environment" && <span className="mt-1 block text-xs text-faint">Currently from a server environment variable. A key saved here replaces it.</span>}
          </label>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary" disabled={!canSave || saving}>{saving ? "Saving…" : "Save"}</button>
          <Result s={saveState} />
        </div>
      </form>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <form action={test}><input type="hidden" name="provider" value={providerId} /><button className="btn-secondary" disabled={testing || !fields.some((f) => f.secret && f.hasValue)}>{testing ? "Testing…" : "Test connection"}</button></form>
        {hasSaved && canSave && (
          <form action={remove} onSubmit={(e) => { if (!confirm("Remove the keys saved in the dashboard? A server environment variable, if any, will be used instead.")) e.preventDefault(); }}>
            <input type="hidden" name="provider" value={providerId} /><button className="btn-secondary" disabled={removing}>Remove saved keys</button>
          </form>
        )}
        <Result s={testState} /><Result s={removeState} />
      </div>
    </div>
  );
}
