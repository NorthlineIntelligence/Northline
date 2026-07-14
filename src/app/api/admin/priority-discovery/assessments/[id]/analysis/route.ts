/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { Prisma, PriorityConfidenceLevel, PriorityEstimatedEffort, PriorityTimeHorizon } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { buildAssessmentResultsPayload } from "@/lib/assessmentResultsEngine";
import {
  analyzePriorityDiscoveryAssessment,
  type PriorityDiscoveryAnalysisInput,
  type PriorityProjectOutput,
} from "@/lib/priorityDiscovery/analysis";
import { sanitizeConsultantNotesHtml } from "@/lib/priorityDiscovery/sanitizeConsultantNotesHtml";

const patchConsultantNotesSchema = z.object({
  analysisId: z.string().uuid(),
  consultantNotesHtml: z.union([z.string().max(50000), z.null()]),
});

function effortToEnum(value: PriorityProjectOutput["estimatedEffort"]) {
  if (value === "low") return PriorityEstimatedEffort.LOW;
  if (value === "high") return PriorityEstimatedEffort.HIGH;
  return PriorityEstimatedEffort.MEDIUM;
}

function horizonToEnum(value: PriorityProjectOutput["estimatedTimeHorizon"]) {
  if (value === "0-30 days") return PriorityTimeHorizon.DAYS_0_30;
  if (value === "90-180 days") return PriorityTimeHorizon.DAYS_90_180;
  if (value === "6-12 months") return PriorityTimeHorizon.MONTHS_6_12;
  return PriorityTimeHorizon.DAYS_30_90;
}

function confidenceToEnum(value: PriorityProjectOutput["confidenceLevel"]) {
  if (value === "low") return PriorityConfidenceLevel.LOW;
  if (value === "high") return PriorityConfidenceLevel.HIGH;
  return PriorityConfidenceLevel.MEDIUM;
}

function toClientAnalysis(analysis: any) {
  return {
    id: analysis.id,
    assessmentId: analysis.assessment_id,
    organizationId: analysis.organization_id,
    aiModelUsed: analysis.ai_model_used,
    inputHash: analysis.input_hash,
    outputJson: analysis.output_json,
    executiveSummary: analysis.executive_summary,
    overallSynergyScore: analysis.overall_synergy_score,
    consultantNotesHtml: analysis.consultant_notes_html,
    createdAt: analysis.created_at,
    projects: (analysis.projects ?? []).map((p: any) => ({
      id: p.id,
      rank: p.rank,
      projectName: p.project_name,
      problemStatement: p.problem_statement,
      recommendedSolution: p.recommended_solution,
      shortTermImpact: p.short_term_impact,
      longTermImpact: p.long_term_impact,
      implementationRisk: p.implementation_risk,
      readinessDependency: p.readiness_dependency,
      firstStep: p.first_step,
      estimatedEffort: p.estimated_effort?.toLowerCase?.() ?? null,
      estimatedTimeHorizon: p.estimated_time_horizon,
      aiSuitabilityScore: p.ai_suitability_score,
      automationSuitabilityScore: p.automation_suitability_score,
      businessImpactScore: p.business_impact_score,
      urgencyScore: p.urgency_score,
      synergyScore: p.synergy_score,
      riskScore: p.risk_score,
      priorityScore: p.priority_score,
      confidenceLevel: p.confidence_level?.toLowerCase?.() ?? null,
      evidenceJson: p.evidence_json,
    })),
  };
}

function csvEscape(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

async function buildInput(assessmentId: string): Promise<PriorityDiscoveryAnalysisInput | null> {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          industry: true,
          context_notes: true,
          tech_stack_notes: true,
          integration_notes: true,
          process_workflow_notes: true,
          assessments: {
            where: { assessment_type: "READINESS" },
            orderBy: { created_at: "desc" },
            take: 1,
            select: { id: true },
          },
          documents: {
            orderBy: { created_at: "desc" },
            take: 8,
            select: { title: true, text_extracted: true },
          },
        },
      },
      Participant: {
        select: {
          id: true,
          email: true,
          role: true,
          seniority_level: true,
          department: true,
        },
      },
    },
  });

  if (!assessment || assessment.assessment_type !== "PRIORITY_DISCOVERY") return null;

  const responses = await prisma.priorityResponse.findMany({
    where: { assessment_id: assessmentId },
    include: {
      Question: true,
    },
    orderBy: { created_at: "asc" },
  });

  const readinessAssessmentId = assessment.organization.assessments[0]?.id ?? null;
  const readinessResults = readinessAssessmentId
    ? (await buildAssessmentResultsPayload({ assessmentId: readinessAssessmentId })).body
    : null;

  const documentNotes = assessment.organization.documents
    .map((d) => `${d.title}: ${(d.text_extracted ?? "").slice(0, 4000)}`)
    .filter((entry) => entry.trim().length > 0)
    .join("\n\n");

  return {
    organization: {
      id: assessment.organization.id,
      name: assessment.organization.name,
      industry: assessment.organization.industry,
      contextNotes: assessment.organization.context_notes,
      techStackNotes: assessment.organization.tech_stack_notes,
      integrationNotes: assessment.organization.integration_notes,
      processWorkflowNotes: assessment.organization.process_workflow_notes,
    },
    assessmentId,
    participants: assessment.Participant.map((p) => ({
      id: p.id,
      email: p.email,
      role: p.role,
      seniorityLevel: p.seniority_level,
      department: p.department,
    })),
    responses: responses.map((r) => ({
      participantId: r.participant_id,
      questionId: r.question_id,
      section: r.Question.section,
      questionText: r.Question.question_text,
      responseType: r.Question.response_type,
      scoringDimension: r.Question.scoring_dimension,
      answerText: r.answer_text,
      answerNumber: r.answer_number,
      answerJson: r.answer_json,
    })),
    readinessResults,
    notes: documentNotes || null,
    questionSetVersion: assessment.question_set_version,
    aiProcessingMode: assessment.ai_processing_mode === "FAST" ? "fast" : "executive",
  };
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const analysis = await prisma.priorityAnalysis.findFirst({
    where: { assessment_id: id },
    orderBy: { created_at: "desc" },
    include: { projects: { orderBy: { rank: "asc" } } },
  });

  if (!analysis) return NextResponse.json({ ok: true, analysis: null });

  const format = req.nextUrl.searchParams.get("format");
  if (format === "responses_csv") {
    const input = await buildInput(id);
    if (!input) return NextResponse.json({ ok: false, error: "Priority Discovery assessment not found" }, { status: 404 });
    const rows = [
      "participantId,role,seniorityLevel,department,section,question,responseType,scoringDimension,answer",
      ...input.responses.map((r) => {
        const participant = input.participants.find((p) => p.id === r.participantId);
        const answer =
          r.answerText ??
          r.answerNumber ??
          (Array.isArray(r.answerJson) ? r.answerJson.join(" | ") : r.answerJson ? JSON.stringify(r.answerJson) : "");
        return [
          r.participantId,
          participant?.role,
          participant?.seniorityLevel,
          participant?.department,
          r.section,
          r.questionText,
          r.responseType,
          r.scoringDimension,
          answer,
        ].map(csvEscape).join(",");
      }),
    ];
    return new NextResponse(rows.join("\n") + "\n", {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="priority-discovery-responses-${id}.csv"`,
      },
    });
  }
  if (format === "json") {
    return NextResponse.json(analysis.output_json);
  }

  return NextResponse.json({ ok: true, analysis: toClientAnalysis(analysis) });
}

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const input = await buildInput(id);
  if (!input) return NextResponse.json({ ok: false, error: "Priority Discovery assessment not found" }, { status: 404 });
  if (input.responses.length === 0) {
    return NextResponse.json({ ok: false, error: "No responses available to analyze." }, { status: 400 });
  }

  const result = await analyzePriorityDiscoveryAssessment(input);
  const output = result.output;

  const previousAnalysis = await prisma.priorityAnalysis.findFirst({
    where: { assessment_id: id },
    orderBy: { created_at: "desc" },
    select: { consultant_notes_html: true },
  });

  const created = await prisma.$transaction(async (tx) => {
    const analysis = await tx.priorityAnalysis.create({
      data: {
        assessment_id: input.assessmentId,
        organization_id: input.organization.id,
        ai_model_used: result.modelUsed,
        input_hash: result.inputHash,
        output_json: output as unknown as Prisma.InputJsonValue,
        executive_summary: output.executiveSummary,
        overall_synergy_score: output.alignmentAnalysis.overallSynergyScore,
        consultant_notes_html: previousAnalysis?.consultant_notes_html ?? null,
      },
    });

    await tx.priorityProject.createMany({
      data: output.topPriorityProjects.slice(0, 5).map((project) => ({
        priority_analysis_id: analysis.id,
        rank: project.rank,
        project_name: project.projectName,
        problem_statement: project.problemStatement,
        recommended_solution: project.recommendedSolution,
        short_term_impact: project.shortTermImpact,
        long_term_impact: project.longTermImpact,
        implementation_risk: project.implementationRisk,
        readiness_dependency: project.readinessDependency,
        first_step: project.firstStep,
        estimated_effort: effortToEnum(project.estimatedEffort),
        estimated_time_horizon: horizonToEnum(project.estimatedTimeHorizon),
        ai_suitability_score: project.aiSuitabilityScore,
        automation_suitability_score: project.automationSuitabilityScore,
        business_impact_score: project.businessImpactScore,
        urgency_score: project.urgencyScore,
        synergy_score: project.synergyScore,
        risk_score: project.riskScore,
        priority_score: project.priorityScore,
        confidence_level: confidenceToEnum(project.confidenceLevel),
        evidence_json: project.evidenceFromResponses as unknown as Prisma.InputJsonValue,
      })),
    });

    return tx.priorityAnalysis.findUniqueOrThrow({
      where: { id: analysis.id },
      include: { projects: { orderBy: { rank: "asc" } } },
    });
  });

  return NextResponse.json({
    ok: true,
    analysis: toClientAnalysis(created),
    modelUsed: result.modelUsed,
    modeUsed: result.modeUsed,
    providerUsed: result.providerUsed,
    warnings: result.warnings,
  });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const parsed = patchConsultantNotesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const assessment = await prisma.assessment.findUnique({
    where: { id },
    select: { id: true, assessment_type: true },
  });
  if (!assessment || assessment.assessment_type !== "PRIORITY_DISCOVERY") {
    return NextResponse.json({ ok: false, error: "Priority Discovery assessment not found" }, { status: 404 });
  }

  const existing = await prisma.priorityAnalysis.findFirst({
    where: { id: parsed.data.analysisId, assessment_id: id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Analysis not found for this assessment." }, { status: 404 });
  }

  const consultantNotesHtml =
    parsed.data.consultantNotesHtml === null
      ? null
      : sanitizeConsultantNotesHtml(parsed.data.consultantNotesHtml);

  const updated = await prisma.priorityAnalysis.update({
    where: { id: parsed.data.analysisId },
    data: { consultant_notes_html: consultantNotesHtml },
    include: { projects: { orderBy: { rank: "asc" } } },
  });

  return NextResponse.json({
    ok: true,
    consultantNotesHtml: updated.consultant_notes_html,
    analysis: toClientAnalysis(updated),
  });
}
