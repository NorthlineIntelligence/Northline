import { Prisma, PriorityConfidenceLevel, PriorityEstimatedEffort, PriorityTimeHorizon } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildAssessmentResultsPayload } from "@/lib/assessmentResultsEngine";
import {
  analyzePriorityDiscoveryAssessment,
  type PriorityDiscoveryAnalysisInput,
  type PriorityProjectOutput,
} from "@/lib/priorityDiscovery/analysis";

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

export function toClientPriorityAnalysis(analysis: {
  id: string;
  assessment_id: string;
  organization_id: string;
  ai_model_used: string | null;
  input_hash: string;
  output_json: Prisma.JsonValue;
  executive_summary: string | null;
  overall_synergy_score: number | null;
  consultant_notes_html: string | null;
  created_at: Date;
  projects?: Array<Record<string, unknown>>;
}) {
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
    createdAt: analysis.created_at.toISOString(),
    projects: (analysis.projects ?? []).map((project) => ({
      id: String(project.id),
      rank: Number(project.rank),
      projectName: String(project.project_name),
      problemStatement: String(project.problem_statement ?? ""),
      recommendedSolution: String(project.recommended_solution ?? ""),
      shortTermImpact: String(project.short_term_impact ?? ""),
      longTermImpact: String(project.long_term_impact ?? ""),
      implementationRisk: String(project.implementation_risk ?? ""),
      readinessDependency: String(project.readiness_dependency ?? ""),
      firstStep: String(project.first_step ?? ""),
      estimatedEffort:
        project.estimated_effort && typeof project.estimated_effort === "string"
          ? project.estimated_effort.toLowerCase()
          : project.estimated_effort && typeof project.estimated_effort === "object"
            ? String(project.estimated_effort).toLowerCase()
            : null,
      estimatedTimeHorizon: project.estimated_time_horizon ?? null,
      aiSuitabilityScore: Number(project.ai_suitability_score ?? 0),
      automationSuitabilityScore: Number(project.automation_suitability_score ?? 0),
      businessImpactScore: Number(project.business_impact_score ?? 0),
      urgencyScore: Number(project.urgency_score ?? 0),
      synergyScore: Number(project.synergy_score ?? 0),
      riskScore: Number(project.risk_score ?? 0),
      priorityScore: Number(project.priority_score ?? 0),
      confidenceLevel:
        project.confidence_level && typeof project.confidence_level === "string"
          ? project.confidence_level.toLowerCase()
          : null,
      evidenceJson: project.evidence_json ?? null,
    })),
  };
}

export async function buildPriorityAnalysisInput(
  assessmentId: string
): Promise<PriorityDiscoveryAnalysisInput | null> {
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
    include: { Question: true },
    orderBy: { created_at: "asc" },
  });

  const readinessAssessmentId = assessment.organization.assessments[0]?.id ?? null;
  const readinessResults = readinessAssessmentId
    ? (await buildAssessmentResultsPayload({ assessmentId: readinessAssessmentId })).body
    : null;

  const documentNotes = assessment.organization.documents
    .map((doc) => `${doc.title}: ${(doc.text_extracted ?? "").slice(0, 4000)}`)
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
    participants: assessment.Participant.map((participant) => ({
      id: participant.id,
      email: participant.email,
      role: participant.role,
      seniorityLevel: participant.seniority_level,
      department: participant.department,
    })),
    responses: responses.map((response) => ({
      participantId: response.participant_id,
      questionId: response.question_id,
      section: response.Question.section,
      questionText: response.Question.question_text,
      responseType: response.Question.response_type,
      scoringDimension: response.Question.scoring_dimension,
      answerText: response.answer_text,
      answerNumber: response.answer_number,
      answerJson: response.answer_json,
    })),
    readinessResults,
    notes: documentNotes || null,
    questionSetVersion: assessment.question_set_version,
    aiProcessingMode: assessment.ai_processing_mode === "FAST" ? "fast" : "executive",
  };
}

export async function getLatestPriorityAnalysis(assessmentId: string) {
  return prisma.priorityAnalysis.findFirst({
    where: { assessment_id: assessmentId },
    orderBy: { created_at: "desc" },
    include: { projects: { orderBy: { rank: "asc" } } },
  });
}

export async function createPriorityAnalysisRecord(input: PriorityDiscoveryAnalysisInput) {
  const result = await analyzePriorityDiscoveryAssessment(input);
  const output = result.output;

  const previousAnalysis = await prisma.priorityAnalysis.findFirst({
    where: { assessment_id: input.assessmentId },
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

  return {
    analysis: created,
    modelUsed: result.modelUsed,
    modeUsed: result.modeUsed,
    providerUsed: result.providerUsed,
    warnings: result.warnings,
    cached: false as const,
  };
}

export async function getOrGeneratePriorityAnalysis(args: {
  assessmentId: string;
  force?: boolean;
}) {
  if (!args.force) {
    const existing = await getLatestPriorityAnalysis(args.assessmentId);
    if (existing) {
      return {
        analysis: existing,
        cached: true as const,
        modelUsed: existing.ai_model_used,
        modeUsed: null,
        providerUsed: null,
        warnings: [] as string[],
      };
    }
  }

  const input = await buildPriorityAnalysisInput(args.assessmentId);
  if (!input) {
    throw new Error("Priority Discovery assessment not found");
  }
  if (input.responses.length === 0) {
    throw new Error("No responses available to analyze.");
  }

  return createPriorityAnalysisRecord(input);
}
