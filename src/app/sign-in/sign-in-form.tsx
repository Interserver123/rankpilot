"use client";

import { keepValuesOnSubmit } from "@/components/use-keep-form";
import { useActionState, useState } from "react";
import { claimOwnerAction, setupAdmin, signIn, type SignInState } from "./actions";

function PasswordInput({ id, name, autoComplete, placeholder }: { id: string; name: string; autoComplete: string; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input id={id} name={name} type={show ? "text" : "password"} required autoComplete={autoComplete} placeholder={placeholder} className="input pr-16" />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:text-ink">
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}

function Result({ state }: { state: SignInState }) {
  if (state.error) return <p role="alert" className="rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">{state.error}</p>;
  if (state.message) return <p className="rounded-xl bg-good/10 px-3 py-2 text-sm text-good">{state.message}</p>;
  return null;
}

export function SignInForm({ mode }: { mode: "supabase" | "dev" | "password" }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});
  return (
    <form onSubmit={keepValuesOnSubmit(action)} className="space-y-4">
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" placeholder="you@agency.com" className="input" />
      </div>
      {mode === "password" && (
        <div>
          <label className="label" htmlFor="password">Password</label>
          <PasswordInput id="password" name="password" autoComplete="current-password" />
        </div>
      )}
      {mode === "supabase" && (
        <div>
          <label className="label" htmlFor="password">Password <span className="normal-case text-faint">(leave blank for a magic link)</span></label>
          <input id="password" name="password" type="password" autoComplete="current-password" className="input" />
        </div>
      )}
      {mode === "dev" && <p className="rounded-xl border border-warn/30 bg-warn/10 p-2.5 text-xs text-warn">Development sign-in: no password is checked. Disabled in production.</p>}
      <Result state={state} />
      <button className="btn-primary w-full py-2.5" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
      {mode === "password" && <p className="text-center text-xs text-faint">Forgot your password? Ask a workspace administrator to reset it.</p>}
    </form>
  );
}

function OwnerEmail({ email }: { email: string }) {
  return (
    <div>
      <label className="label" htmlFor="owner-email">Owner email</label>
      <input id="owner-email" value={email} readOnly className="input bg-panel-2 text-muted" />
    </div>
  );
}

function SetupCode({ show }: { show: boolean }) {
  if (!show) return null;
  return <div><label className="label" htmlFor="setupCode">Setup code</label><input id="setupCode" name="setupCode" required autoComplete="off" className="input" /></div>;
}

export function SetupForm({ ownerEmail, needsCode }: { ownerEmail: string; needsCode: boolean }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(setupAdmin, {});
  return (
    <form onSubmit={keepValuesOnSubmit(action)} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label" htmlFor="name">Your name</label><input id="name" name="name" required autoComplete="name" className="input" /></div>
        <div><label className="label" htmlFor="agencyName">Agency name</label><input id="agencyName" name="agencyName" required autoComplete="organization" className="input" /></div>
      </div>
      <OwnerEmail email={ownerEmail} />
      <div><label className="label" htmlFor="password">Choose a password</label><PasswordInput id="password" name="password" autoComplete="new-password" placeholder="At least 10 characters" /></div>
      <div><label className="label" htmlFor="confirm">Confirm password</label><PasswordInput id="confirm" name="confirm" autoComplete="new-password" /></div>
      <SetupCode show={needsCode} />
      <Result state={state} />
      <button className="btn-primary w-full py-2.5" disabled={pending}>{pending ? "Creating workspace…" : "Create workspace"}</button>
      <p className="text-center text-xs text-faint">This account becomes the owner and administrator. Add your team afterwards in Settings.</p>
    </form>
  );
}

export function ClaimOwnerForm({ ownerEmail, needsCode }: { ownerEmail: string; needsCode: boolean }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(claimOwnerAction, {});
  return (
    <form onSubmit={keepValuesOnSubmit(action)} className="space-y-4">
      <OwnerEmail email={ownerEmail} />
      <div><label className="label" htmlFor="name">Your name</label><input id="name" name="name" autoComplete="name" className="input" /></div>
      <div><label className="label" htmlFor="password">Choose a password</label><PasswordInput id="password" name="password" autoComplete="new-password" placeholder="At least 10 characters" /></div>
      <div><label className="label" htmlFor="confirm">Confirm password</label><PasswordInput id="confirm" name="confirm" autoComplete="new-password" /></div>
      <SetupCode show={needsCode} />
      <Result state={state} />
      <button className="btn-primary w-full py-2.5" disabled={pending}>{pending ? "Saving…" : "Set password and sign in"}</button>
    </form>
  );
}
