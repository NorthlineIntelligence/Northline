import { prisma } from "@/lib/prisma";

export type ParticipantSummary = {
  id: string;
  email: string | null;
  role: string | null;
  department: string | null;
  seniority_level: string | null;
  completed_at: Date | null;
  created_at: Date;
};

export type ReadinessAnswerRow = {
  id: string;
  pillar: string;
  questionText: string;
  questionCore: string | null;
  displayOrder: number;
  score: number;
  freeWrite: string | null;
  createdAt: string;
};

export type PriorityAnswerRow = {
  id: string;
  section: string;
  questionText: string;
  questionHelpText: string | null;
  responseType: string;
  order: number;
  answer: string;
  createdAt: string;
};

export function formatPriorityAnswer(response: {
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

export async function loadAssessmentParticipantResponses(args: {
  assessmentId: string;
  participantId: string;
  assessmentType: "READINESS" | "PRIORITY_DISCOVERY";
}) {
  if (args.assessmentType === "PRIORITY_DISCOVERY") {
    const responses = await prisma.priorityResponse.findMany({
      where: { assessment_id: args.assessmentId, participant_id: args.participantId },
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

    return responses
      .map(
        (response): PriorityAnswerRow => ({
          id: response.id,
          section: response.Question.section,
          questionText: response.Question.question_text,
          questionHelpText: response.Question.question_help_text,
          responseType: response.Question.response_type,
          order: response.Question.order,
          answer: formatPriorityAnswer(response),
          createdAt: response.created_at.toISOString(),
        })
      )
      .sort((a, b) => a.order - b.order);
  }

  const responses = await prisma.response.findMany({
    where: { assessment_id: args.assessmentId, participant_id: args.participantId },
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

  return responses
    .map(
      (response): ReadinessAnswerRow => ({
        id: response.id,
        pillar: response.Question.pillar,
        questionText: response.Question.question_text,
        questionCore: response.Question.question_core,
        displayOrder: response.Question.display_order,
        score: response.score,
        freeWrite: response.free_write,
        createdAt: response.created_at.toISOString(),
      })
    )
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

export async function loadAllAssessmentParticipantResponses(assessmentId: string) {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      name: true,
      assessment_type: true,
      organization: { select: { name: true } },
      Participant: {
        select: {
          id: true,
          email: true,
          role: true,
          department: true,
          seniority_level: true,
          completed_at: true,
          created_at: true,
        },
        orderBy: { created_at: "asc" },
      },
    },
  });

  if (!assessment) return null;

  const participants = await Promise.all(
    assessment.Participant.map(async (participant) => ({
      participant,
      responses: await loadAssessmentParticipantResponses({
        assessmentId,
        participantId: participant.id,
        assessmentType: assessment.assessment_type,
      }),
    }))
  );

  return {
    assessment: {
      id: assessment.id,
      name: assessment.name,
      assessmentType: assessment.assessment_type,
      organizationName: assessment.organization.name,
    },
    participants,
  };
}
