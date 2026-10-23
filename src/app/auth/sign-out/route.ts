import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { DEV_COOKIE, supabaseConfigured, supabaseServerClient } from "@/server/auth";
import { revokeSession, SESSION_COOKIE } from "@/server/sessions";
import { sql } from "@/server/db";

export async function POST(req: NextRequest) {
  const store = await cookies();
  if (supabaseConfigured()) await (await supabaseServerClient()).auth.signOut();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(sql, token);
  store.delete(SESSION_COOKIE);
  store.delete(DEV_COOKIE);
  return NextResponse.redirect(new URL("/sign-in", req.url), { status: 303 });
}
