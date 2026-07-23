import { Prisma, PriorityConfidenceLevel, PriorityEstimatedEffort, PriorityReadoutProfile, PriorityTimeHorizon } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildAssessmentResultsPayload } from "@/lib/assessmentResultsEngine";
import {
  analyzePriorityDiscoveryAssessment,
  type PriorityDiscoveryAnalysisInput,
  type PriorityProjectOutput,
} from "@/lib/priorityDiscovery/analysis";

export type ReadoutProfileSlug = "standard" | "client_specific";

function toDbReadoutProfile(profile: ReadoutProfileSlug): PriorityReadoutProfile {
  return profile === "client_specific"
    ? PriorityReadoutProfile.CLIENT_SPECIFIC
    : PriorityReadoutProfile.STANDARD;
}

function fromDbReadoutProfile(profile: PriorityReadoutProfile): ReadoutProfileSlug {
  return profile === PriorityReadoutProfile.CLIENT_SPECIFIC ? "client_specific" : "standard";
}

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
  readout_profile?: PriorityReadoutProfile;
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
    readoutProfile: fromDbReadoutProfile(analysis.readout_profile ?? PriorityReadoutProfile.STANDARD),
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

function formatPriorityAnswer(response: {
  answer_text?: string | null;
  answer_number?: number | null;
  answer_json?: unknown;
}) {
  if (response.answer_text?.trim()) return response.answer_text.trim();
  if (response.answer_number != null) return String(response.answer_number);
  if (Array.isArray(response.answer_json)) {
    return response.answer_json.map((entry) => String(entry ?? "").trim()).filter(Boolean).join(" | ");
  }
  if (response.answer_json != null) return JSON.stringify(response.answer_json);
  return "";
}

export async function buildPriorityAnalysisInput(
  assessmentId: string,
  options?: { readoutProfile?: "standard" | "client_specific" }
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
          workflow_map_ai_summary: true,
          assessments: {
            where: { assessment_type: "READINESS" },
            orderBy: { created_at: "desc" },
            take: 1,
            select: { id: true },
          },
          documents: {
            orderBy: { created_at: "desc" },
            take: 12,
            select: { title: true, text_extracted: true, source_type: true },
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

  const documentExcerpts = assessment.organization.documents
    .map((doc) => {
      const fullText = doc.text_extracted ?? "";
      const excerptLimit = options?.readoutProfile === "client_specific" ? 12000 : 6000;
      return {
        title: doc.title,
        sourceType: doc.source_type,
        excerpt: fullText.slice(0, excerptLimit),
        truncated: fullText.length > excerptLimit,
      };
    })
    .filter((doc) => doc.excerpt.trim().length > 0);

  const documentNotes = documentExcerpts
    .map((doc) => `${doc.title}: ${doc.excerpt}`)
    .join("\n\n");

  const participantById = new Map(
    assessment.Participant.map((participant) => [participant.id, participant])
  );

  const mappedResponses = responses.map((response) => ({
    participantId: response.participant_id,
    questionId: response.question_id,
    section: response.Question.section,
    questionText: response.Question.question_text,
    responseType: response.Question.response_type,
    scoringDimension: response.Question.scoring_dimension,
    answerText: response.answer_text,
    answerNumber: response.answer_number,
    answerJson: response.answer_json,
  }));

  const evidenceDigest = mappedResponses
    .map((response) => {
      const participant = participantById.get(response.participantId);
      const answer = formatPriorityAnswer({
        answer_text: response.answerText,
        answer_number: response.answerNumber,
        answer_json: response.answerJson,
      });
      if (!answer) return null;
      return {
        section: response.section,
        question: response.questionText,
        answer,
        participantRole: participant?.role ?? null,
        participantDepartment: participant?.department ?? null,
        participantSeniority: participant?.seniority_level ?? null,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry != null);

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
    responses: mappedResponses,
    readinessResults,
    notes: documentNotes || null,
    questionSetVersion: assessment.question_set_version,
    aiProcessingMode: assessment.ai_processing_mode === "FAST" ? "fast" : "executive",
    readoutProfile: options?.readoutProfile ?? "standard",
    documentExcerpts,
    workflowMapSummary: assessment.organization.workflow_map_ai_summary,
    evidenceDigest,
  };
}

export async function getLatestPriorityAnalysis(
  assessmentId: string,
  readoutProfile: ReadoutProfileSlug = "standard"
) {
  return prisma.priorityAnalysis.findFirst({
    where: {
      assessment_id: assessmentId,
      readout_profile: toDbReadoutProfile(readoutProfile),
    },
    orderBy: { created_at: "desc" },
    include: { projects: { orderBy: { rank: "asc" } } },
  });
}

export async function getPriorityAnalysisForAdminRoadmaps(assessmentId: string) {
  return (
    (await getLatestPriorityAnalysis(assessmentId, "client_specific")) ??
    (await getLatestPriorityAnalysis(assessmentId, "standard"))
  );
}

export async function createPriorityAnalysisRecord(input: PriorityDiscoveryAnalysisInput) {
  const result = await analyzePriorityDiscoveryAssessment(input);
  const output = result.output;

  const readoutProfile = input.readoutProfile ?? "standard";

  const previousAnalysis = await prisma.priorityAnalysis.findFirst({
    where: {
      assessment_id: input.assessmentId,
      readout_profile: toDbReadoutProfile(readoutProfile),
    },
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
        readout_profile: toDbReadoutProfile(readoutProfile),
        output_json: {
          ...output,
          readoutProfile,
        } as unknown as Prisma.InputJsonValue,
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
  readoutProfile?: "standard" | "client_specific";
}) {
  const readoutProfile = args.readoutProfile ?? "standard";

  if (!args.force) {
    const existing = await getLatestPriorityAnalysis(args.assessmentId, readoutProfile);
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

  const input = await buildPriorityAnalysisInput(args.assessmentId, {
    readoutProfile,
  });
  if (!input) {
    throw new Error("Priority Discovery assessment not found");
  }
  if (input.responses.length === 0) {
    throw new Error("No responses available to analyze.");
  }

  return createPriorityAnalysisRecord(input);
}
