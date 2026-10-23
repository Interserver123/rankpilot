"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DEV_COOKIE, devAuthEnabled, signDevSession, supabaseConfigured, supabaseServerClient } from "@/server/auth";
import { rateLimit } from "@/server/rate-limit";

export interface SignInState { error?: string; message?: string }

const schema = z.object({ email: z.string().trim().email("Enter a valid email"), password: z.string().optional() });

export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const parsed = schema.safeParse({ email: form.get("email"), password: form.get("password") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { email, password } = parsed.data;

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`signin:${ip}`, 10, 60_000).ok || !rateLimit(`signin:${email.toLowerCase()}`, 5, 60_000).ok) {
    return { error: "Too many attempts. Try again in a minute." };
  }

  if (supabaseConfigured()) {
    const supabase = await supabaseServerClient();
    if (password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: "Invalid email or password." };
      redirect("/");
    }
    const origin = (await headers()).get("origin") ?? "";
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${origin}/auth/callback`, shouldCreateUser: false } });
    // Same response whether or not the account exists, to avoid account enumeration.
    if (error && error.status && error.status >= 500) return { error: "Could not send the sign-in link. Try again." };
    return { message: "If this email has access, a sign-in link is on its way." };
  }

  if (devAuthEnabled()) {
    (await cookies()).set(DEV_COOKIE, signDevSession(email), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 24 * 3600 });
    redirect("/");
  }
  return { error: "Authentication is not configured. Set Supabase keys, or AUTH_MODE=dev for local development." };
}
