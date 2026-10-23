export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { authMode, getCurrentUser } from "@/server/auth";
import { ownerState, type OwnerState } from "@/server/accounts";
import { ownerEmail, ownerSetupCode } from "@/server/owner";
import { classifyDbError, type SetupProblem } from "@/server/schema";
import { SetupNotice } from "./setup-notice";
import { sql } from "@/server/db";
import { ClaimOwnerForm, SetupForm, SignInForm } from "./sign-in-form";

export const metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ signin?: string }> }) {
  const mode = authMode();
  let state: OwnerState = "ready";
  let problem: SetupProblem | null = null;
  let signedIn = false;
  try {
    signedIn = Boolean(await getCurrentUser()); // also applies pending migrations
    if (mode === "password") state = await ownerState(sql);
  } catch (e) {
    console.error("[sign-in] database check failed", e);
    problem = classifyDbError(e);
  }
  if (signedIn) redirect("/");
  const forceSignIn = (await searchParams).signin === "1";
  const setup = !problem && mode === "password" && state === "no_workspace";
  const claim = !problem && mode === "password" && state === "owner_needs_password" && !forceSignIn;
  const needsCode = Boolean(ownerSetupCode());
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-navy p-12 text-white lg:flex lg:flex-col lg:justify-between dark:bg-panel">
        <div className="absolute -left-20 top-1/3 h-96 w-96 rounded-full bg-accent/30 blur-3xl" />
        <div className="relative font-display text-xl font-bold">Rank<span className="text-accent">Pilot</span></div>
        <div className="relative">
          <h1 className="font-display max-w-md text-4xl font-semibold leading-tight tracking-tight">Every client. Every location. Every search signal.</h1>
          <ul className="mt-8 space-y-3 text-sm text-white/75">
            <li>✓ Location-specific rank tracking on your schedule</li>
            <li>✓ Every metric labelled with its source and timestamp</li>
            <li>✓ Transparent, budgeted API costs per client</li>
          </ul>
        </div>
        <div className="relative text-xs text-white/50">Agency workspace · invitation only</div>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <div className="font-display text-2xl font-semibold tracking-tight">
              {problem ? "Almost there" : setup ? "Set up your workspace" : claim ? "Set your owner password" : "Welcome back"}
            </div>
            <div className="mt-1 text-sm text-muted">
              {problem ? "RankPilot is running, but it can't use its database yet." : setup ? "Create the owner account for your agency." : claim ? "Choose the password you'll use to sign in as the workspace owner." : "Sign in to your agency workspace."}
            </div>
          </div>
          {problem ? <SetupNotice problem={problem} />
            : setup ? <SetupForm ownerEmail={ownerEmail()} needsCode={needsCode} />
            : claim ? <><ClaimOwnerForm ownerEmail={ownerEmail()} needsCode={needsCode} /><p className="mt-4 text-center text-xs text-faint"><a className="link" href="/sign-in?signin=1">Sign in with another account</a></p></>
            : <SignInForm mode={mode} />}
        </div>
      </section>
    </main>
  );
}
