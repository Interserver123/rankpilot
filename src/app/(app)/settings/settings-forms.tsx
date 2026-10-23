"use client";

import { keepValuesOnSubmit } from "@/components/use-keep-form";
import { useActionState, useState, useTransition } from "react";
import { addMemberAction, changePasswordAction, removeMemberAction, renameOrgAction, resetMemberPasswordAction, type SettingsState } from "./actions";

export function OrgNameForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(renameOrgAction, {});
  return (
    <form onSubmit={keepValuesOnSubmit(action)} className="flex flex-wrap items-end gap-2">
      <label><span className="label">Agency name</span><input name="name" defaultValue={name} className="input w-72" /></label>
      <button className="btn-secondary" disabled={pending}>Save</button>
      {state.error && <span className="text-sm text-bad">{state.error}</span>}{state.ok && <span className="text-sm text-good">Saved.</span>}
    </form>
  );
}

/** Shows a one-time temporary password with a copy button. */
function TempPassword({ email, password }: { email?: string; password: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 rounded-xl border border-accent/30 bg-accent-soft p-3 text-sm">
      <div className="font-semibold">Temporary password{email ? ` for ${email}` : ""}</div>
      <div className="mt-2 flex items-center gap-2">
        <code className="rounded-lg bg-panel px-2 py-1 font-mono text-sm">{password}</code>
        <button type="button" className="btn-secondary py-1 text-xs" onClick={() => { navigator.clipboard.writeText(password); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <p className="mt-2 text-xs text-muted">Shown only once. Share it securely; they can change it under Settings → My account after signing in.</p>
    </div>
  );
}

export function AddMemberForm({ passwordMode }: { passwordMode: boolean }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(addMemberAction, {});
  return (
    <form onSubmit={keepValuesOnSubmit(action)}>
      <div className="flex flex-wrap items-end gap-2">
        <label><span className="label">Email</span><input name="email" type="email" required className="input w-72" /></label>
        <label><span className="label">Role</span><select name="role" className="input"><option value="member">Member</option><option value="manager">Manager</option><option value="admin">Admin</option></select></label>
        <button className="btn-primary" disabled={pending}>Add / update</button>
        {state.error && <span className="text-sm text-bad">{state.error}</span>}
        {state.ok && !state.tempPassword && <span className="text-sm text-good">Saved.</span>}
      </div>
      {passwordMode && !state.tempPassword && <p className="mt-2 text-xs text-faint">New members get a temporary password shown here once.</p>}
      {state.tempPassword && <TempPassword email={state.email} password={state.tempPassword} />}
    </form>
  );
}

export function MemberActions({ userId, canReset }: { userId: string; canReset: boolean }) {
  const [pending, start] = useTransition();
  const [temp, setTemp] = useState<SettingsState | null>(null);
  return (
    <div>
      <div className="flex justify-end gap-1">
        {canReset && <button className="btn-ghost text-xs" disabled={pending} onClick={() => start(async () => {
          if (!confirm("Reset this member's password? They will be signed out everywhere.")) return;
          const r = await resetMemberPasswordAction(userId); if (r.error) alert(r.error); else setTemp(r);
        })}>Reset password</button>}
        <button className="btn-ghost text-xs text-bad" disabled={pending} onClick={() => start(async () => {
          if (!confirm("Remove this member from the agency?")) return;
          const r = await removeMemberAction(userId); if (r.error) alert(r.error);
        })}>Remove</button>
      </div>
      {temp?.tempPassword && <TempPassword email={temp.email} password={temp.tempPassword} />}
    </div>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<SettingsState, FormData>(changePasswordAction, {});
  return (
    <form onSubmit={keepValuesOnSubmit(action)} className="grid max-w-3xl gap-3 sm:grid-cols-3 sm:items-end">
      <label><span className="label">Current password</span><input name="current" type="password" required autoComplete="current-password" className="input" /></label>
      <label><span className="label">New password</span><input name="next" type="password" required minLength={10} autoComplete="new-password" className="input" /></label>
      <label><span className="label">Confirm new password</span><input name="confirm" type="password" required autoComplete="new-password" className="input" /></label>
      <div className="flex items-center gap-3 sm:col-span-3">
        <button className="btn-primary" disabled={pending}>Change password</button>
        {state.error && <span className="text-sm text-bad">{state.error}</span>}
        {state.ok && <span className="text-sm text-good">Password changed. Other devices were signed out.</span>}
      </div>
    </form>
  );
}
