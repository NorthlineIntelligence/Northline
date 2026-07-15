import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHash } from "crypto";
import { createServerClient } from "@supabase/ssr";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPriorityQuestionsForAssessment } from "@/lib/priorityDiscovery/assessmentQuestions";
import { maybeNotifyExecutiveInsightsViewers } from "@/lib/executiveInsightsNotifications";
import { getInviteOrigin } from "@/lib/assessmentInvites";

const ResponseSchema = z.object({
  questionId: z.string().uuid(),
  answerText: z.string().max(20000).nullable().optional(),
  answerNumber: z.number().int().min(0).max(100).nullable().optional(),
  answerJson: z.any().optional(),
});

const BodySchema = z.object({
  assessmentId: z.string().uuid(),
  participantId: z.string().uuid(),
  email: z.string().email().optional(),
  token: z.string().min(16).optional(),
  complete: z.boolean().default(false),
  responses: z.array(ResponseSchema).default([]),
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
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {}
      },
    },
  });
}

function sha256Hex(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

function hasAnswer(response: z.infer<typeof ResponseSchema>) {
  if (typeof response.answerText === "string" && response.answerText.trim()) return true;
  if (typeof response.answerNumber === "number") return true;
  if (response.answerJson === null || response.answerJson === undefined) return false;
  if (Array.isArray(response.answerJson)) return response.answerJson.length > 0;
  return true;
}

async function authorizeParticipant(args: {
  assessmentId: string;
  participantId: string;
  email?: string;
  token?: string;
}) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (!userError && user?.id) {
    const participant = await prisma.participant.findFirst({
      where: { id: args.participantId, assessment_id: args.assessmentId, user_id: user.id },
      select: { id: true, completed_at: true },
    });
    if (!participant) return { ok: false as const, status: 403, error: "Forbidden" };
    return { ok: true as const, participant };
  }

  const email = (args.email ?? "").trim().toLowerCase();
  const token = (args.token ?? "").trim();
  if (!email || !token) return { ok: false as const, status: 401, error: "Unauthorized" };

  const participant = await prisma.participant.findFirst({
    where: {
      id: args.participantId,
      assessment_id: args.assessmentId,
      email,
      invite_token_hash: sha256Hex(token),
      OR: [{ invite_token_expires_at: null }, { invite_token_expires_at: { gt: new Date() } }],
    },
    select: { id: true, completed_at: true },
  });
  if (!participant) return { ok: false as const, status: 401, error: "Invalid or expired invite link." };
  return { ok: true as const, participant };
}

export async function POST(req: NextRequest) {
  try {
    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
    }
    const body = parsed.data;

    const assessment = await prisma.assessment.findUnique({
      where: { id: body.assessmentId },
      select: { id: true, assessment_type: true, locked_at: true, status: true },
    });
    if (!assessment) return NextResponse.json({ ok: false, error: "Assessment not found" }, { status: 404 });
    if (assessment.assessment_type !== "PRIORITY_DISCOVERY") {
      return NextResponse.json({ ok: false, error: "Not a Priority Discovery assessment" }, { status: 400 });
    }
    if (assessment.locked_at || assessment.status === "CLOSED") {
      return NextResponse.json({ ok: false, error: "Assessment is locked. Responses are read-only." }, { status: 409 });
    }

    const auth = await authorizeParticipant({
      assessmentId: body.assessmentId,
      participantId: body.participantId,
      email: body.email,
      token: body.token,
    });
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    if (auth.participant.completed_at) {
      return NextResponse.json({ ok: false, code: "already_completed", error: "Assessment already completed." }, { status: 409 });
    }

    const { questions } = await getPriorityQuestionsForAssessment(body.assessmentId);
    const questionIds = new Set(questions.map((q) => q.id));
    const submittedIds = new Set(body.responses.map((r) => r.questionId));

    const invalidQuestionIds = body.responses.map((r) => r.questionId).filter((id) => !questionIds.has(id));
    if (invalidQuestionIds.length) {
      return NextResponse.json({ ok: false, error: "Invalid question ids", invalidQuestionIds }, { status: 400 });
    }

    if (body.complete) {
      const missingRequired = questions
        .filter((q) => q.required)
        .filter((q) => {
          const response = body.responses.find((r) => r.questionId === q.id);
          return !response || !hasAnswer(response);
        })
        .map((q) => q.id);
      if (missingRequired.length) {
        return NextResponse.json({ ok: false, error: "Required questions missing", missingRequired }, { status: 400 });
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const response of body.responses) {
        if (!hasAnswer(response)) continue;
        await tx.priorityResponse.upsert({
          where: {
            assessment_id_participant_id_question_id: {
              assessment_id: body.assessmentId,
              participant_id: body.participantId,
              question_id: response.questionId,
            },
          },
          create: {
            assessment_id: body.assessmentId,
            participant_id: body.participantId,
            question_id: response.questionId,
            answer_text: response.answerText?.trim() || null,
            answer_number: response.answerNumber ?? null,
            answer_json:
              response.answerJson === undefined || response.answerJson === null
                ? Prisma.JsonNull
                : (response.answerJson as Prisma.InputJsonValue),
          },
          update: {
            answer_text: response.answerText?.trim() || null,
            answer_number: response.answerNumber ?? null,
            answer_json:
              response.answerJson === undefined || response.answerJson === null
                ? Prisma.JsonNull
                : (response.answerJson as Prisma.InputJsonValue),
          },
        });
      }

      if (body.complete) {
        await tx.participant.update({
          where: { id: body.participantId },
          data: { completed_at: new Date() },
        });

        const participants = await tx.participant.findMany({
          where: { assessment_id: body.assessmentId },
          select: { completed_at: true },
        });
        if (participants.length > 0 && participants.every((p) => p.completed_at)) {
          await tx.assessment.update({
            where: { id: body.assessmentId },
            data: { locked_at: new Date() },
          });
        }
      }
    });

    void maybeNotifyExecutiveInsightsViewers({
      assessmentId: body.assessmentId,
      originFallback: getInviteOrigin(req.nextUrl.origin),
    }).catch((err) => {
      console.error("[priority-discovery/responses] executive insights notify failed:", err);
    });

    return NextResponse.json({
      ok: true,
      saved: body.responses.filter((r) => submittedIds.has(r.questionId) && hasAnswer(r)).length,
      completed: body.complete,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: "Internal server error", message }, { status: 500 });
  }
}
