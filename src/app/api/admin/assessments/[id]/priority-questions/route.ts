/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import {
  PriorityQuestionInputSchema,
  PRIORITY_RESPONSE_TYPES,
  PRIORITY_SCORING_DIMENSIONS,
} from "@/lib/priorityDiscovery/questions";
import {
  assessmentUsesCustomPriorityQuestions,
  copyPriorityQuestionsToAssessment,
  getPriorityQuestionsForAssessment,
  toClientPriorityQuestion,
} from "@/lib/priorityDiscovery/assessmentQuestions";

const ParamsSchema = z.object({ id: z.string().uuid() });

const PostSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("initialize"),
    source: z
      .discriminatedUnion("type", [
        z.object({ type: z.literal("default"), version: z.string().optional() }),
        z.object({ type: z.literal("assessment"), assessmentId: z.string().uuid() }),
        z.object({ type: z.literal("version"), version: z.string().min(1) }),
      ])
      .optional(),
  }),
  z.object({
    action: z.literal("create"),
    question: PriorityQuestionInputSchema,
  }),
]);

const PatchSchema = z.object({
  id: z.string().uuid(),
  question: PriorityQuestionInputSchema.partial().extend({
    section: z.string().min(1).max(200).optional(),
    questionText: z.string().min(1).max(8000).optional(),
    responseType: z.enum(PRIORITY_RESPONSE_TYPES).optional(),
    required: z.boolean().optional(),
    order: z.number().int().min(1).max(100000).optional(),
    isActive: z.boolean().optional(),
    scoringDimension: z.enum(PRIORITY_SCORING_DIMENSIONS).nullable().optional(),
  }),
});

function jsonOrNull(value: unknown) {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

async function loadAssessment(assessmentId: string) {
  return prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: { id: true, assessment_type: true, question_set_version: true },
  });
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const params = await context.params;
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid assessment id" }, { status: 400 });
  }

  const assessment = await loadAssessment(parsed.data.id);
  if (!assessment || assessment.assessment_type !== "PRIORITY_DISCOVERY") {
    return NextResponse.json({ ok: false, error: "Priority Discovery assessment not found" }, { status: 404 });
  }

  const { questions, usesCustomQuestions } = await getPriorityQuestionsForAssessment(parsed.data.id, {
    includeInactive: true,
  });

  return NextResponse.json({
    ok: true,
    usesCustomQuestions,
    questionSetVersion: assessment.question_set_version,
    questions: questions.map(toClientPriorityQuestion),
  });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const params = await context.params;
  const parsedParams = ParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ ok: false, error: "Invalid assessment id" }, { status: 400 });
  }

  const assessment = await loadAssessment(parsedParams.data.id);
  if (!assessment || assessment.assessment_type !== "PRIORITY_DISCOVERY") {
    return NextResponse.json({ ok: false, error: "Priority Discovery assessment not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsedBody = PostSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false, error: "Invalid body", issues: parsedBody.error.issues }, { status: 400 });
  }

  if (parsedBody.data.action === "initialize") {
    const source = parsedBody.data.source ?? { type: "default" as const };
    const count = await copyPriorityQuestionsToAssessment({
      targetAssessmentId: parsedParams.data.id,
      source:
        source.type === "assessment"
          ? { type: "assessment", assessmentId: source.assessmentId }
          : source.type === "version"
            ? { type: "version", version: source.version }
            : { type: "default", version: source.version },
    });
    return NextResponse.json({ ok: true, initialized: true, count }, { status: 201 });
  }

  const usesCustom = await assessmentUsesCustomPriorityQuestions(parsedParams.data.id);
  if (!usesCustom) {
    return NextResponse.json(
      { ok: false, error: "Initialize a custom question set before adding assessment-specific questions." },
      { status: 409 }
    );
  }

  const q = parsedBody.data.question;
  const created = await prisma.priorityQuestion.create({
    data: {
      assessment_id: parsedParams.data.id,
      assessment_type: "PRIORITY_DISCOVERY",
      question_set_version: "custom",
      section: q.section,
      question_text: q.questionText,
      question_help_text: q.questionHelpText || null,
      response_type: q.responseType,
      options: jsonOrNull(q.options ?? []),
      scale_min: q.scaleMin ?? null,
      scale_max: q.scaleMax ?? null,
      scale_labels: jsonOrNull(q.scaleLabels ?? null),
      required: q.required,
      order: q.order,
      tags: jsonOrNull(q.tags ?? []),
      scoring_dimension: q.scoringDimension ?? null,
      is_active: q.isActive,
    },
  });

  return NextResponse.json({ ok: true, question: toClientPriorityQuestion(created) }, { status: 201 });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const params = await context.params;
  const parsedParams = ParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ ok: false, error: "Invalid assessment id" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsedBody = PatchSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false, error: "Invalid body", issues: parsedBody.error.issues }, { status: 400 });
  }

  const existing = await prisma.priorityQuestion.findFirst({
    where: { id: parsedBody.data.id, assessment_id: parsedParams.data.id },
  });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Assessment question not found" }, { status: 404 });
  }

  const q = parsedBody.data.question;
  const updated = await prisma.priorityQuestion.update({
    where: { id: parsedBody.data.id },
    data: {
      ...(q.section !== undefined ? { section: q.section } : {}),
      ...(q.questionText !== undefined ? { question_text: q.questionText } : {}),
      ...(q.questionHelpText !== undefined ? { question_help_text: q.questionHelpText } : {}),
      ...(q.responseType !== undefined ? { response_type: q.responseType } : {}),
      ...(q.options !== undefined ? { options: jsonOrNull(q.options) } : {}),
      ...(q.scaleMin !== undefined ? { scale_min: q.scaleMin } : {}),
      ...(q.scaleMax !== undefined ? { scale_max: q.scaleMax } : {}),
      ...(q.scaleLabels !== undefined ? { scale_labels: jsonOrNull(q.scaleLabels) } : {}),
      ...(q.required !== undefined ? { required: q.required } : {}),
      ...(q.order !== undefined ? { order: q.order } : {}),
      ...(q.tags !== undefined ? { tags: jsonOrNull(q.tags) } : {}),
      ...(q.scoringDimension !== undefined ? { scoring_dimension: q.scoringDimension } : {}),
      ...(q.isActive !== undefined ? { is_active: q.isActive } : {}),
    },
  });

  return NextResponse.json({ ok: true, question: toClientPriorityQuestion(updated) });
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const params = await context.params;
  const parsedParams = ParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ ok: false, error: "Invalid assessment id" }, { status: 400 });
  }

  const questionId = req.nextUrl.searchParams.get("questionId");
  if (!questionId) {
    return NextResponse.json({ ok: false, error: "questionId is required" }, { status: 400 });
  }

  const updated = await prisma.priorityQuestion.updateMany({
    where: { id: questionId, assessment_id: parsedParams.data.id },
    data: { is_active: false },
  });

  if (updated.count === 0) {
    return NextResponse.json({ ok: false, error: "Assessment question not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
