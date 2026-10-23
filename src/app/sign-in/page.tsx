export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { authMode, getCurrentUser } from "@/server/auth";
import { hasOrganization } from "@/server/accounts";
import { sql } from "@/server/db";
import { SetupForm, SignInForm } from "./sign-in-form";

export const metadata = { title: "Sign in" };

export default async function SignInPage() {
  if (await getCurrentUser()) redirect("/");
  const mode = authMode();
  const setup = mode === "password" && !(await hasOrganization(sql));
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
            <div className="font-display text-2xl font-semibold tracking-tight">{setup ? "Set up your workspace" : "Welcome back"}</div>
            <div className="mt-1 text-sm text-muted">{setup ? "Create the administrator account for your agency." : "Sign in to your agency workspace."}</div>
          </div>
          {setup ? <SetupForm /> : <SignInForm mode={mode} />}
        </div>
      </section>
    </main>
  );
}
