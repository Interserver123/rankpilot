"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "./actions";

export function SignInForm({ mode }: { mode: "supabase" | "dev" | "none" }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" className="input" />
      </div>
      {mode === "supabase" && (
        <div>
          <label className="label" htmlFor="password">Password <span className="normal-case text-faint">(leave blank for a magic link)</span></label>
          <input id="password" name="password" type="password" autoComplete="current-password" className="input" />
        </div>
      )}
      {mode === "dev" && <p className="rounded-lg border border-warn/30 bg-warn/10 p-2 text-xs text-warn">Development sign-in: no password is checked. Disabled in production.</p>}
      {state.error && <p className="text-sm text-bad">{state.error}</p>}
      {state.message && <p className="text-sm text-good">{state.message}</p>}
      <button className="btn-primary w-full" disabled={pending || mode === "none"}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
