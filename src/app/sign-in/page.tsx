export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getCurrentUser, devAuthEnabled, supabaseConfigured } from "@/server/auth";
import { SignInForm } from "./sign-in-form";

export const metadata = { title: "Sign in" };

export default async function SignInPage() {
  if (await getCurrentUser()) redirect("/");
  const mode = supabaseConfigured() ? "supabase" : devAuthEnabled() ? "dev" : "none";
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6">
          <div className="text-lg font-semibold">RankPilot</div>
          <div className="text-sm text-muted">Every client. Every location. Every search signal.</div>
        </div>
        <SignInForm mode={mode} />
      </div>
    </main>
  );
}
