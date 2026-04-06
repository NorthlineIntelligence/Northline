import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

async function signOutAndRedirectToLogin(req: Request) {
  const cookieStore = await cookies();

  const res = NextResponse.redirect(new URL("/admin/login", req.url));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  await supabase.auth.signOut();

  return res;
}

/** Form submissions from the dashboard */
export async function POST(req: Request) {
  return signOutAndRedirectToLogin(req);
}

/** Direct navigation / links to /admin/logout would otherwise return 405 (POST-only). */
export async function GET(req: Request) {
  return signOutAndRedirectToLogin(req);
}