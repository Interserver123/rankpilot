import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { sql } from "./db";
import type { OrgRole } from "@/lib/permissions";
import { provisionUser } from "./users";
import { resolveSession, SESSION_COOKIE } from "./sessions";

export const DEV_COOKIE = "rp_dev_session";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  organizationId: string | null;
  role: OrgRole | null;
}

export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function devAuthEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.AUTH_MODE === "dev" && !supabaseConfigured();
}

export type AuthMode = "supabase" | "dev" | "password";

/** Supabase when configured; email-only dev sign-in only when explicitly enabled outside production; otherwise built-in passwords. */
export function authMode(): AuthMode {
  if (supabaseConfigured()) return "supabase";
  if (devAuthEnabled()) return "dev";
  return "password";
}

function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET must be set (at least 16 characters)");
  return s;
}

export function signDevSession(email: string, issuedAt = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ email, iat: issuedAt })).toString("base64url");
  const sig = createHmac("sha256", authSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyDevSession(token: string, maxAgeMs = 7 * 24 * 3600_000): string | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", authSecret()).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { email, iat } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { email: string; iat: number };
    if (typeof email !== "string" || Date.now() - iat > maxAgeMs) return null;
    return email;
  } catch {
    return null;
  }
}

export async function supabaseServerClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const c of list) store.set(c.name, c.value, c.options);
        } catch {
          // Called from a Server Component: middleware refreshes the session instead.
        }
      },
    },
  });
}

/** Identity from the auth provider (not yet mapped to an app user). */
export const authIdentity = cache(async (): Promise<{ authId: string | null; email: string } | null> => {
  if (supabaseConfigured()) {
    const supabase = await supabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user?.email) return null;
    return { authId: data.user.id, email: data.user.email };
  }
  if (devAuthEnabled()) {
    const token = (await cookies()).get(DEV_COOKIE)?.value;
    const email = token ? verifyDevSession(token) : null;
    return email ? { authId: `dev:${email.toLowerCase()}`, email } : null;
  }
  const id = await passwordSessionUserId();
  if (!id) return null;
  const [u] = await sql<{ email: string }[]>`select email from users where id = ${id}`;
  return u ? { authId: null, email: u.email } : null;
});

/** User id behind the built-in password session cookie (memoized per request). */
const passwordSessionUserId = cache(async (): Promise<string | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? resolveSession(sql, token) : null;
});

/** Current user for this request (memoized per request). */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  let user: { id: string; email: string; name: string | null; status: string } | null | undefined;
  if (authMode() === "password") {
    const id = await passwordSessionUserId();
    if (!id) return null;
    [user] = await sql<{ id: string; email: string; name: string | null; status: string }[]>`select id, email, name, status from users where id = ${id}`;
  } else {
    const identity = await authIdentity();
    if (!identity) return null;
    user = await provisionUser(sql, identity.authId, identity.email);
  }
  if (!user || user.status !== "active") return null;
  const [m] = await sql<{ organization_id: string; role: OrgRole }[]>`
    select organization_id, role from organization_members where user_id = ${user.id} order by created_at limit 1`;
  return { id: user.id, email: user.email, name: user.name, organizationId: m?.organization_id ?? null, role: m?.role ?? null };
});
