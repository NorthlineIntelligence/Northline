import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { prisma } from "@/lib/prisma";

async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // ignore
        }
      },
    },
  });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/customer/dashboard";
  const assessmentId = url.searchParams.get("assessmentId");
  const emailHint = (url.searchParams.get("email") ?? "").trim().toLowerCase();

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    url.origin;

  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, origin));

  if (!code) return redirectTo("/customer/access?error=missing_code");

  try {
    const supabase = await getSupabaseServerClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      return redirectTo("/customer/access?error=exchange_failed");
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user?.id || !user.email) {
      return redirectTo("/customer/access?error=missing_user");
    }

    const email = user.email.trim().toLowerCase();
    const effectiveEmail = emailHint || email;

    const where =
      assessmentId != null
        ? {
            assessment_id: assessmentId,
            email: effectiveEmail,
            portal_role: { not: "NONE" as const },
          }
        : {
            email: effectiveEmail,
            portal_role: { not: "NONE" as const },
          };

    const participant = await prisma.participant.findFirst({
      where,
      select: { id: true, user_id: true },
      orderBy: { created_at: "desc" },
    });

    if (!participant) {
      return redirectTo("/customer/access?error=no_portal_access");
    }

    if (participant.user_id && participant.user_id !== user.id) {
      return redirectTo("/customer/access?error=already_claimed");
    }

    await prisma.participant.update({
      where: { id: participant.id },
      data: { user_id: user.id, invite_accepted_at: new Date() },
    });

    return redirectTo(next);
  } catch {
    return redirectTo("/customer/access?error=server_error");
  }
}
