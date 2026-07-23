import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";

const ParamsSchema = z.object({
  id: z.string().uuid(),
  participantId: z.string().uuid(),
});

function formatPriorityAnswer(response: {
  answer_text: string | null;
  answer_number: number | null;
  answer_json: unknown;
}) {
  if (response.answer_text?.trim()) return response.answer_text.trim();
  if (response.answer_number != null) return String(response.answer_number);
  if (Array.isArray(response.answer_json)) {
    return response.answer_json.map((entry) => String(entry ?? "").trim()).filter(Boolean).join(" | ");
  }
  if (response.answer_json != null) return JSON.stringify(response.answer_json);
  return "";
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string; participantId: string }> }
) {
  const admin = await requireAdmin();
  if (!admin.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const { id: assessmentId, participantId } = parsed.data;

  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      name: true,
      assessment_type: true,
      organization: { select: { id: true, name: true } },
    },
  });
  if (!assessment) {
    return NextResponse.json({ ok: false, error: "Assessment not found" }, { status: 404 });
  }

  const participant = await prisma.participant.findFirst({
    where: { id: participantId, assessment_id: assessmentId },
    select: {
      id: true,
      email: true,
      role: true,
      department: true,
      seniority_level: true,
      completed_at: true,
      created_at: true,
    },
  });
  if (!participant) {
    return NextResponse.json({ ok: false, error: "Participant not found" }, { status: 404 });
  }

  if (assessment.assessment_type === "PRIORITY_DISCOVERY") {
    const responses = await prisma.priorityResponse.findMany({
      where: { assessment_id: assessmentId, participant_id: participantId },
      include: {
        Question: {
          select: {
            section: true,
            question_text: true,
            question_help_text: true,
            response_type: true,
            order: true,
          },
        },
      },
      orderBy: { created_at: "asc" },
    });

    return NextResponse.json({
      ok: true,
      assessment: {
        id: assessment.id,
        name: assessment.name,
        assessmentType: assessment.assessment_type,
        organizationName: assessment.organization.name,
      },
      participant,
      responses: responses
        .map((response) => ({
          id: response.id,
          section: response.Question.section,
          questionText: response.Question.question_text,
          questionHelpText: response.Question.question_help_text,
          responseType: response.Question.response_type,
          order: response.Question.order,
          answer: formatPriorityAnswer(response),
          createdAt: response.created_at.toISOString(),
        }))
        .sort((a, b) => a.order - b.order),
    });
  }

  const responses = await prisma.response.findMany({
    where: { assessment_id: assessmentId, participant_id: participantId },
    include: {
      Question: {
        select: {
          pillar: true,
          question_text: true,
          question_core: true,
          display_order: true,
        },
      },
    },
    orderBy: { created_at: "asc" },
  });

  return NextResponse.json({
    ok: true,
    assessment: {
      id: assessment.id,
      name: assessment.name,
      assessmentType: assessment.assessment_type,
      organizationName: assessment.organization.name,
    },
    participant,
    responses: responses
      .map((response) => ({
        id: response.id,
        pillar: response.Question.pillar,
        questionText: response.Question.question_text,
        questionCore: response.Question.question_core,
        displayOrder: response.Question.display_order,
        score: response.score,
        freeWrite: response.free_write,
        createdAt: response.created_at.toISOString(),
      }))
      .sort((a, b) => a.displayOrder - b.displayOrder),
  });
}
