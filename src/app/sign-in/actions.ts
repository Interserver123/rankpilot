"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authMode, DEV_COOKIE, signDevSession, supabaseServerClient } from "@/server/auth";
import { AccountError, passwordSignIn, setupFirstAdmin } from "@/server/accounts";
import { SESSION_COOKIE } from "@/server/sessions";
import { sql } from "@/server/db";
import { rateLimit } from "@/server/rate-limit";

export interface SignInState { error?: string; message?: string }

const schema = z.object({ email: z.string().trim().email("Enter a valid email"), password: z.string().optional() });

async function clientMeta() {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local", userAgent: h.get("user-agent") };
}

async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", path: "/", expires: expiresAt, secure: process.env.NODE_ENV === "production",
  });
}

export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const parsed = schema.safeParse({ email: form.get("email"), password: form.get("password") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { email, password } = parsed.data;

  const meta = await clientMeta();
  if (!rateLimit(`signin:${meta.ip}`, 10, 60_000).ok || !rateLimit(`signin:${email.toLowerCase()}`, 5, 60_000).ok) {
    return { error: "Too many attempts. Try again in a minute." };
  }

  const mode = authMode();
  if (mode === "supabase") {
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

  if (mode === "dev") {
    (await cookies()).set(DEV_COOKIE, signDevSession(email), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 24 * 3600 });
    redirect("/");
  }

  if (!password) return { error: "Enter your password." };
  const session = await passwordSignIn(sql, email, password, meta);
  if (!session) return { error: "Invalid email or password." };
  await setSessionCookie(session.token, session.expiresAt);
  redirect("/");
}

const setupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120),
  email: z.string().trim().email("Enter a valid email"),
  agencyName: z.string().trim().min(1, "Enter your agency name").max(120),
  password: z.string(),
  confirm: z.string(),
}).refine((v) => v.password === v.confirm, { message: "Passwords do not match", path: ["confirm"] });

export async function setupAdmin(_prev: SignInState, form: FormData): Promise<SignInState> {
  if (authMode() !== "password") return { error: "Setup is handled by your identity provider." };
  const meta = await clientMeta();
  if (!rateLimit(`setup:${meta.ip}`, 5, 60_000).ok) return { error: "Too many attempts. Try again in a minute." };
  const p = setupSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  try {
    await setupFirstAdmin(sql, p.data);
  } catch (e) {
    if (e instanceof AccountError) return { error: e.message };
    throw e;
  }
  const session = await passwordSignIn(sql, p.data.email, p.data.password, meta);
  if (!session) return { error: "Account created. Please sign in." };
  await setSessionCookie(session.token, session.expiresAt);
  redirect("/?welcome=1");
}
