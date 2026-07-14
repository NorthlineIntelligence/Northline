import { Prisma, PriorityResponseType, PriorityScoringDimension } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PRIORITY_DISCOVERY_SEED_QUESTIONS } from "@/lib/priorityDiscovery/questions";

export type PriorityQuestionRecord = {
  id: string;
  section: string;
  question_text: string;
  question_help_text: string | null;
  response_type: string;
  options: unknown;
  scale_min: number | null;
  scale_max: number | null;
  scale_labels: unknown;
  required: boolean;
  order: number;
  tags: unknown;
  scoring_dimension: string | null;
  is_active: boolean;
};

export function toClientPriorityQuestion(q: PriorityQuestionRecord) {
  return {
    id: q.id,
    section: q.section,
    questionText: q.question_text,
    questionHelpText: q.question_help_text,
    responseType: q.response_type,
    options: Array.isArray(q.options) ? q.options : [],
    scaleMin: q.scale_min,
    scaleMax: q.scale_max,
    scaleLabels: q.scale_labels && typeof q.scale_labels === "object" ? q.scale_labels : null,
    required: q.required,
    order: q.order,
    tags: Array.isArray(q.tags) ? q.tags : [],
    scoringDimension: q.scoring_dimension,
    isActive: q.is_active,
  };
}

export async function assessmentUsesCustomPriorityQuestions(assessmentId: string) {
  const count = await prisma.priorityQuestion.count({
    where: { assessment_id: assessmentId },
  });
  return count > 0;
}

export async function getPriorityQuestionsForAssessment(assessmentId: string, options?: { includeInactive?: boolean }) {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: { id: true, assessment_type: true, question_set_version: true },
  });
  if (!assessment || assessment.assessment_type !== "PRIORITY_DISCOVERY") {
    return { assessment, questions: [] as PriorityQuestionRecord[], usesCustomQuestions: false };
  }

  const usesCustomQuestions = await assessmentUsesCustomPriorityQuestions(assessmentId);
  const questions = await prisma.priorityQuestion.findMany({
    where: usesCustomQuestions
      ? {
          assessment_id: assessmentId,
          ...(options?.includeInactive ? {} : { is_active: true }),
        }
      : {
          assessment_id: null,
          assessment_type: "PRIORITY_DISCOVERY",
          question_set_version: assessment.question_set_version,
          ...(options?.includeInactive ? {} : { is_active: true }),
        },
    orderBy: [{ order: "asc" }, { created_at: "asc" }],
  });

  return { assessment, questions, usesCustomQuestions };
}

type CopySource =
  | { type: "default"; version?: string }
  | { type: "assessment"; assessmentId: string }
  | { type: "version"; version: string };

export async function copyPriorityQuestionsToAssessment(args: {
  targetAssessmentId: string;
  source: CopySource;
}) {
  let sourceQuestions: Array<{
    section: string;
    question_text: string;
    question_help_text: string | null;
    response_type: PriorityResponseType;
    options: Prisma.JsonValue | null;
    scale_min: number | null;
    scale_max: number | null;
    scale_labels: Prisma.JsonValue | null;
    required: boolean;
    order: number;
    tags: Prisma.JsonValue | null;
    scoring_dimension: PriorityScoringDimension | null;
    is_active: boolean;
  }> = [];

  if (args.source.type === "assessment") {
    const { questions } = await getPriorityQuestionsForAssessment(args.source.assessmentId, {
      includeInactive: true,
    });
    sourceQuestions = questions.map((q) => ({
      section: q.section,
      question_text: q.question_text,
      question_help_text: q.question_help_text,
      response_type: q.response_type as PriorityResponseType,
      options: (q.options ?? null) as Prisma.JsonValue | null,
      scale_min: q.scale_min,
      scale_max: q.scale_max,
      scale_labels: (q.scale_labels ?? null) as Prisma.JsonValue | null,
      required: q.required,
      order: q.order,
      tags: (q.tags ?? null) as Prisma.JsonValue | null,
      scoring_dimension: (q.scoring_dimension as PriorityScoringDimension | null) ?? null,
      is_active: q.is_active,
    }));
  } else {
    const version = args.source.type === "version" ? args.source.version : args.source.version ?? "1";
    const existing = await prisma.priorityQuestion.findMany({
      where: {
        assessment_id: null,
        assessment_type: "PRIORITY_DISCOVERY",
        question_set_version: version,
      },
      orderBy: [{ order: "asc" }, { created_at: "asc" }],
    });

    if (existing.length === 0 && version === "1") {
      sourceQuestions = PRIORITY_DISCOVERY_SEED_QUESTIONS.map((q) => ({
        section: q.section,
        question_text: q.questionText,
        question_help_text: q.questionHelpText || null,
        response_type: q.responseType as PriorityResponseType,
        options: (q.options ?? []) as Prisma.JsonValue,
        scale_min: q.scaleMin ?? null,
        scale_max: q.scaleMax ?? null,
        scale_labels: (q.scaleLabels ?? null) as Prisma.JsonValue,
        required: q.required,
        order: q.order,
        tags: (q.tags ?? []) as Prisma.JsonValue,
        scoring_dimension: (q.scoringDimension ?? null) as PriorityScoringDimension | null,
        is_active: q.isActive,
      }));
    } else {
      sourceQuestions = existing.map((q) => ({
        section: q.section,
        question_text: q.question_text,
        question_help_text: q.question_help_text,
        response_type: q.response_type,
        options: q.options as Prisma.JsonValue | null,
        scale_min: q.scale_min,
        scale_max: q.scale_max,
        scale_labels: q.scale_labels as Prisma.JsonValue | null,
        required: q.required,
        order: q.order,
        tags: q.tags as Prisma.JsonValue | null,
        scoring_dimension: q.scoring_dimension,
        is_active: q.is_active,
      }));
    }
  }

  if (sourceQuestions.length === 0) {
    throw new Error("No source questions found to copy.");
  }

  await prisma.priorityQuestion.deleteMany({
    where: { assessment_id: args.targetAssessmentId },
  });

  await prisma.priorityQuestion.createMany({
    data: sourceQuestions.map((q) => ({
      assessment_id: args.targetAssessmentId,
      assessment_type: "PRIORITY_DISCOVERY",
      question_set_version: "custom",
      section: q.section,
      question_text: q.question_text,
      question_help_text: q.question_help_text,
      response_type: q.response_type,
      options: q.options === null ? Prisma.JsonNull : q.options,
      scale_min: q.scale_min,
      scale_max: q.scale_max,
      scale_labels: q.scale_labels === null ? Prisma.JsonNull : q.scale_labels,
      required: q.required,
      order: q.order,
      tags: q.tags === null ? Prisma.JsonNull : q.tags,
      scoring_dimension: q.scoring_dimension,
      is_active: q.is_active,
    })),
  });

  await prisma.assessment.update({
    where: { id: args.targetAssessmentId },
    data: { question_set_version: "custom" },
  });

  return sourceQuestions.length;
}
