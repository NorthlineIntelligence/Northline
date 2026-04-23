// src/app/api/assessments/[id]/narrative/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { prisma } from "@/lib/prisma";
import { isAdminEmail } from "@/lib/admin";
import { ASSESSMENTS_IN_PROGRESS_MESSAGE } from "@/lib/assessmentParticipantMessages";
import { getReportingParticipantCompletionStats } from "@/lib/assessmentParticipantCompletion";

const ParamsSchema = z.object({ id: z.string().uuid() });

async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!supabaseKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)"
    );
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

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function unauthorized(message?: string) {
  return NextResponse.json(
    { ok: false, error: "Unauthorized", message: message ?? "Auth session missing!" },
    { status: 401 }
  );
}

/**
 * Auth: allow either:
 *  - Supabase session (must be a participant on this assessment)
 *  - Invite link (email + token)
 */
async function authorizeForAssessment(req: NextRequest, assessmentId: string) {
  const url = req.nextUrl;
  const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  const token = (url.searchParams.get("token") ?? "").trim();

  // 1) Invite token path
  if (email && token) {
    const tokenHash = sha256Hex(token);

    const participant = await prisma.participant.findFirst({
      where: {
        assessment_id: assessmentId,
        email,
        invite_token_hash: tokenHash,
        OR: [{ invite_token_expires_at: null }, { invite_token_expires_at: { gt: new Date() } }],
      },
      select: { id: true, can_view_executive_insights: true },
    });

    if (!participant || !participant.can_view_executive_insights) return { ok: false as const };
    return { ok: true as const };
  }

  // 2) Supabase session path
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.id) return { ok: false as const };

  const membership = await prisma.participant.findFirst({
    where: { assessment_id: assessmentId, user_id: user.id },
    select: { id: true, can_view_executive_insights: true },
  });

  const isAdmin = isAdminEmail(user.email ?? null);
  if (!membership && !isAdmin) {
    return { ok: false as const };
  }
  if (membership && !isAdmin && !membership.can_view_executive_insights) {
    return { ok: false as const };
  }

  return { ok: true as const };
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const params = await context.params;
    const parsed = ParamsSchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid assessment id (UUID)" }, { status: 400 });
    }
    const assessmentId = parsed.data.id;

    const auth = await authorizeForAssessment(req, assessmentId);
    if (!auth.ok) return unauthorized();

    const completion = await getReportingParticipantCompletionStats(assessmentId);

    const latest = await prisma.assessmentNarrative.findFirst({
      where: { assessment_id: assessmentId },
      orderBy: [{ version: "desc" }],
    });

    return NextResponse.json(
      {
        ok: true,
        narrative: latest,
        participants_total: completion.participants_total,
        participants_completed: completion.participants_completed,
        all_participants_completed: completion.all_participants_completed,
        progress_message: completion.all_participants_completed
          ? null
          : ASSESSMENTS_IN_PROGRESS_MESSAGE,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("GET /api/assessments/[id]/narrative error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error.", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}