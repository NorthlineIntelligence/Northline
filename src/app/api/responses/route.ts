import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

const ResponseItemSchema = z.object({
  question_id: z.string().uuid(),
  score: z.number().int().min(1).max(5),
  free_write: z.string().max(5000).optional(),
});

const SubmitResponsesSchema = z.object({
  assessment_id: z.string().uuid(),
  participant_id: z.string().uuid(),
  responses: z.array(ResponseItemSchema).min(1).max(500),
});

async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

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

export async function POST(req: Request) {
  try {
    // --- AUTH GATE: require logged-in user (server-trusted) ---
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      return NextResponse.json(
        { error: "Unauthorized", message: userError.message },
        { status: 401 }
      );
    }

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // --- END AUTH GATE ---

    const body = await req.json();
    const { assessment_id, participant_id, responses } =
      SubmitResponsesSchema.parse(body);

    // 1) Verify participant belongs to assessment + secure-bind user_id
    const participant = await prisma.participant.findFirst({
      where: { id: participant_id, assessment_id },
      select: { id: true, user_id: true },
    });

    if (!participant) {
      return NextResponse.json(
        { error: "Participant not found for this assessment." },
        { status: 404 }
      );
    }

    // Auto-bind user_id on first write if missing; otherwise enforce identity match.
    if (!participant.user_id) {
      await prisma.participant.update({
        where: { id: participant.id },
        data: { user_id: user.id },
      });
    } else if (participant.user_id !== user.id) {
      return NextResponse.json(
        { error: "Forbidden", message: "Participant does not belong to this user." },
        { status: 403 }
      );
    }

    // 2) Ensure questions exist
    const questionIds = Array.from(new Set(responses.map((r) => r.question_id)));

    const existingQuestions = await prisma.question.findMany({
      where: { id: { in: questionIds } },
      select: { id: true },
    });

    if (existingQuestions.length !== questionIds.length) {
      const existingSet = new Set(existingQuestions.map((q) => q.id));
      const missing = questionIds.filter((id) => !existingSet.has(id));
      return NextResponse.json(
        { error: "One or more questions not found.", missingQuestionIds: missing },
        { status: 400 }
      );
    }

    // 3) Pre-check duplicates (nice 409)
    const existing = await prisma.response.findMany({
      where: {
        assessment_id,
        participant_id,
        question_id: { in: questionIds },
      },
      select: { question_id: true },
    });

    if (existing.length > 0) {
      return NextResponse.json(
        {
          error: "Duplicate submission detected for one or more questions.",
          duplicateQuestionIds: existing.map((e) => e.question_id),
        },
        { status: 409 }
      );
    }

    // 4) Insert
    await prisma.response.createMany({
      data: responses.map((r) => ({
        assessment_id,
        participant_id,
        question_id: r.question_id,
        score: r.score,
        free_write: r.free_write ?? null,
      })),
    });

    return NextResponse.json(
      { ok: true, created: responses.length },
      { status: 201 }
    );
  } catch (err: any) {
    if (err?.name === "ZodError") {
      return NextResponse.json(
        { error: "Invalid request body.", issues: err.issues },
        { status: 400 }
      );
    }

    // Unique constraint fallback
    if (err?.code === "P2002") {
      return NextResponse.json(
        { error: "Duplicate submission (unique constraint).", details: err.meta },
        { status: 409 }
      );
    }

    console.error("POST /api/responses error:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}