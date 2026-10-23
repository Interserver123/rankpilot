import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { DEV_COOKIE, supabaseConfigured, supabaseServerClient } from "@/server/auth";

export async function POST(req: NextRequest) {
  if (supabaseConfigured()) await (await supabaseServerClient()).auth.signOut();
  (await cookies()).delete(DEV_COOKIE);
  return NextResponse.redirect(new URL("/sign-in", req.url), { status: 303 });
}
