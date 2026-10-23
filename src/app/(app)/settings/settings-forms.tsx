"use client";

import { useActionState, useTransition } from "react";
import { addMemberAction, removeMemberAction, renameOrgAction, type SettingsState } from "./actions";

export function OrgNameForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(renameOrgAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label><span className="label">Agency name</span><input name="name" defaultValue={name} className="input w-72" /></label>
      <button className="btn-secondary" disabled={pending}>Save</button>
      {state.error && <span className="text-sm text-bad">{state.error}</span>}{state.ok && <span className="text-sm text-good">Saved.</span>}
    </form>
  );
}

export function AddMemberForm() {
  const [state, action, pending] = useActionState<SettingsState, FormData>(addMemberAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label><span className="label">Email</span><input name="email" type="email" required className="input w-72" /></label>
      <label><span className="label">Role</span><select name="role" className="input"><option value="member">Member</option><option value="manager">Manager</option><option value="admin">Admin</option></select></label>
      <button className="btn-primary" disabled={pending}>Add / update</button>
      {state.error && <span className="text-sm text-bad">{state.error}</span>}{state.ok && <span className="text-sm text-good">Saved. They can sign in with this email.</span>}
    </form>
  );
}

export function RemoveMember({ userId }: { userId: string }) {
  const [pending, start] = useTransition();
  return <button className="btn-ghost text-xs" disabled={pending} onClick={() => start(async () => {
    if (!confirm("Remove this member from the agency?")) return;
    const r = await removeMemberAction(userId); if (r.error) alert(r.error);
  })}>Remove</button>;
}
