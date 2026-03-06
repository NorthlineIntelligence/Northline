import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

function getAllowlist() {
  const raw = process.env.NORTHLINE_ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only protect /admin routes (except login)
  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    const res = NextResponse.next();

    // Debug header: confirms middleware ran at all
    res.headers.set("x-nl-mw-hit", "1");

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              res.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
  
      const allowlist = getAllowlist();
      res.headers.set("x-nl-mw-allowlist-len", String(allowlist.length));
  
      if (userError || !user) {
        const r = NextResponse.redirect(new URL("/admin/login", req.url));
        r.headers.set("x-nl-mw-hit", "1");
        r.headers.set("x-nl-mw-auth", "0");
        return r;
      }
  
      const email = (user.email ?? "").trim().toLowerCase();
      const isAdmin = allowlist.includes(email);

    res.headers.set("x-nl-mw-auth", "1");
    res.headers.set("x-nl-mw-admin", isAdmin ? "1" : "0");

    if (!isAdmin) {
      const r = NextResponse.redirect(
        new URL("/admin/login?error=forbidden", req.url)
      );
      r.headers.set("x-nl-mw-hit", "1");
      r.headers.set("x-nl-mw-auth", "1");
      r.headers.set("x-nl-mw-admin", "0");
      r.headers.set("x-nl-mw-allowlist-len", String(allowlist.length));
      return r;
    }

    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};