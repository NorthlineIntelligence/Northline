import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { prisma } from "@/lib/prisma";

const BodySchema = z.object({
  email: z.string().email(),
  assessmentId: z.string().uuid().optional(),
});

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

export async function POST(req: NextRequest) {
  try {
    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
    }

    const email = parsed.data.email.trim().toLowerCase();
    const assessmentId = parsed.data.assessmentId ?? null;

    const where =
      assessmentId != null
        ? {
            email,
            assessment_id: assessmentId,
            portal_role: { not: "NONE" as const },
          }
        : {
            email,
            portal_role: { not: "NONE" as const },
          };

    const participant = await prisma.participant.findFirst({
      where,
      select: { id: true, assessment_id: true, portal_role: true },
      orderBy: { created_at: "desc" },
    });

    if (!participant) {
      return NextResponse.json(
        { ok: false, error: "No eligible portal access found for this email." },
        { status: 403 }
      );
    }

    const origin =
      process.env.NEXT_PUBLIC_SITE_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      req.nextUrl.origin;

    const callbackUrl =
      `${origin}/auth/callback` +
      `?next=${encodeURIComponent("/customer/dashboard")}` +
      `&assessmentId=${encodeURIComponent(participant.assessment_id)}` +
      `&email=${encodeURIComponent(email)}`;

    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl },
    });

    if (error) {
      return NextResponse.json(
        { ok: false, error: "Failed to send magic link.", message: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "Internal server error.", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
