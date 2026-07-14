import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Department, Industry, AssessmentAiProcessingMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { copyPriorityQuestionsToAssessment } from "@/lib/priorityDiscovery/assessmentQuestions";

const ParamsSchema = z.object({ id: z.string().uuid() });

const CreateAssessmentSchema = z.object({
  name: z.string().min(1).max(200),
  assessmentType: z.enum(["READINESS", "PRIORITY_DISCOVERY"]),
  cohortName: z.string().max(120).optional(),
  aiProcessingMode: z.enum(["fast", "executive"]).optional(),
  parentAssessmentId: z.string().uuid().optional(),
  lockedDepartment: z.nativeEnum(Department).nullable().optional(),
  industry: z.nativeEnum(Industry).nullable().optional(),
  copyQuestionsFrom: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("default"), version: z.string().min(1).max(50).optional() }),
      z.object({ type: z.literal("assessment"), assessmentId: z.string().uuid() }),
      z.object({ type: z.literal("version"), version: z.string().min(1).max(50) }),
      z.object({ type: z.literal("none") }),
    ])
    .optional(),
});

function toClientAssessment(assessment: {
  id: string;
  organization_id: string;
  name: string;
  cohort_name: string | null;
  assessment_type: string;
  question_set_version: string;
  ai_processing_mode: string;
  parent_assessment_id: string | null;
  status: string;
  created_at: Date;
}) {
  return {
    id: assessment.id,
    organizationId: assessment.organization_id,
    name: assessment.name,
    cohortName: assessment.cohort_name,
    assessmentType: assessment.assessment_type,
    questionSetVersion: assessment.question_set_version,
    aiProcessingMode: assessment.ai_processing_mode === "FAST" ? "fast" : "executive",
    parentAssessmentId: assessment.parent_assessment_id,
    status: assessment.status,
    createdAt: assessment.created_at.toISOString(),
  };
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
    return NextResponse.json({ ok: false, error: "Invalid organization id" }, { status: 400 });
  }

  const assessments = await prisma.assessment.findMany({
    where: { organization_id: parsed.data.id },
    orderBy: { created_at: "desc" },
    select: {
      id: true,
      organization_id: true,
      name: true,
      cohort_name: true,
      assessment_type: true,
      question_set_version: true,
      ai_processing_mode: true,
      parent_assessment_id: true,
      status: true,
      locked_at: true,
      created_at: true,
    },
  });

  return NextResponse.json({
    ok: true,
    assessments: assessments.map((a) => ({
      ...toClientAssessment(a),
      lockedAt: a.locked_at?.toISOString() ?? null,
    })),
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
    return NextResponse.json({ ok: false, error: "Invalid organization id" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsedBody = CreateAssessmentSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false, error: "Invalid body", issues: parsedBody.error.issues }, { status: 400 });
  }

  const organization = await prisma.organization.findUnique({
    where: { id: parsedParams.data.id },
    select: { id: true },
  });
  if (!organization) {
    return NextResponse.json({ ok: false, error: "Organization not found" }, { status: 404 });
  }

  if (parsedBody.data.parentAssessmentId) {
    const parent = await prisma.assessment.findFirst({
      where: {
        id: parsedBody.data.parentAssessmentId,
        organization_id: organization.id,
      },
      select: { id: true },
    });
    if (!parent) {
      return NextResponse.json({ ok: false, error: "Parent assessment not found for this organization." }, { status: 400 });
    }
  }

  const assessment = await prisma.assessment.create({
    data: {
      organization_id: organization.id,
      name: parsedBody.data.name.trim(),
      cohort_name: parsedBody.data.cohortName?.trim() || null,
      assessment_type: parsedBody.data.assessmentType,
      parent_assessment_id: parsedBody.data.parentAssessmentId ?? null,
      question_set_version: "1",
      ai_processing_mode:
        parsedBody.data.aiProcessingMode === "fast"
          ? AssessmentAiProcessingMode.FAST
          : AssessmentAiProcessingMode.EXECUTIVE,
      locked_department: parsedBody.data.lockedDepartment ?? null,
      industry: parsedBody.data.industry ?? null,
    },
    select: {
      id: true,
      organization_id: true,
      name: true,
      cohort_name: true,
      assessment_type: true,
      question_set_version: true,
      ai_processing_mode: true,
      parent_assessment_id: true,
      status: true,
      created_at: true,
    },
  });

  let copiedQuestionCount = 0;
  if (parsedBody.data.assessmentType === "PRIORITY_DISCOVERY") {
    const copySource = parsedBody.data.copyQuestionsFrom ?? { type: "default" as const };
    if (copySource.type !== "none") {
      copiedQuestionCount = await copyPriorityQuestionsToAssessment({
        targetAssessmentId: assessment.id,
        source:
          copySource.type === "assessment"
            ? { type: "assessment", assessmentId: copySource.assessmentId }
            : copySource.type === "version"
              ? { type: "version", version: copySource.version }
              : { type: "default", version: copySource.version },
      });
    }
  }

  const refreshed = await prisma.assessment.findUniqueOrThrow({
    where: { id: assessment.id },
    select: {
      id: true,
      organization_id: true,
      name: true,
      cohort_name: true,
      assessment_type: true,
      question_set_version: true,
      ai_processing_mode: true,
      parent_assessment_id: true,
      status: true,
      created_at: true,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      assessment: toClientAssessment(refreshed),
      copiedQuestionCount,
    },
    { status: 201 }
  );
}
