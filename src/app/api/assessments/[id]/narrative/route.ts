// src/app/api/assessments/[id]/narrative/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { prisma } from "@/lib/prisma";

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
      select: { id: true },
    });

    if (!participant) return { ok: false as const };
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
    select: { id: true },
  });

  if (!membership) return { ok: false as const };

  return { ok: true as const };
}

async function enforceAllParticipantsCompleted(assessmentId: string) {
  const participants = await prisma.participant.findMany({
    where: { assessment_id: assessmentId },
    select: { completed_at: true },
  });

  const total = participants.length;
  const completed = participants.filter((p) => p.completed_at !== null).length;

  if (total === 0 || completed < total) {
    return {
      ok: false as const,
      status: 409 as const,
      body: {
        ok: false,
        error:
          "All participants have not completed the assessment. Please check back once the administrator confirms completion.",
      },
    };
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

    // ✅ Feature: don't allow narrative until all participants completed
    const gate = await enforceAllParticipantsCompleted(assessmentId);
    if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

    const latest = await prisma.assessmentNarrative.findFirst({
      where: { assessment_id: assessmentId },
      orderBy: [{ version: "desc" }],
    });

    if (!latest) {
      return NextResponse.json({ ok: false, error: "Narrative not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, narrative: latest }, { status: 200 });
  } catch (err: any) {
    console.error("GET /api/assessments/[id]/narrative error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error.", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}