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

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Protect all /admin routes except /admin/login
  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    const res = NextResponse.next();

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

    // IMPORTANT:
    // Use getUser() for identity/auth decisions.
    // getSession() reads from storage (cookies) and may not be authentic.
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    // Not logged in (or cannot verify) -> login
    if (userError || !user) {
      return NextResponse.redirect(new URL("/admin/login", req.url));
    }

    // Logged in but not admin -> forbidden
    const email = (user.email ?? "").trim().toLowerCase();
    const allowlist = getAllowlist();
    const isAdmin = allowlist.length > 0 && allowlist.includes(email);

    if (!isAdmin) {
      return NextResponse.redirect(
        new URL("/admin/login?error=forbidden", req.url)
      );
    }

    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};