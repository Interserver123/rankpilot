import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/** Refreshes the Supabase session cookie on navigation. No-op when Supabase is not configured. */
export async function middleware(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let res = NextResponse.next({ request: req });
  if (!url || !key) return res;
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const c of list) req.cookies.set(c.name, c.value);
        res = NextResponse.next({ request: req });
        for (const c of list) res.cookies.set(c.name, c.value, c.options);
      },
    },
  });
  await supabase.auth.getUser();
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|api/cron).*)"] };
