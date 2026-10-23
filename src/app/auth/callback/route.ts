import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfigured, supabaseServerClient } from "@/server/auth";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (code && supabaseConfigured()) {
    const supabase = await supabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL("/", req.url));
}
