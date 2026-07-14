/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { getPriorityQuestionsForAssessment, toClientPriorityQuestion } from "@/lib/priorityDiscovery/assessmentQuestions";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const assessmentId = req.nextUrl.searchParams.get("assessmentId");
  const participantId = req.nextUrl.searchParams.get("participantId");
  if (!assessmentId) {
    return NextResponse.json({ ok: false, error: "Missing assessmentId" }, { status: 400 });
  }

  const assessmentRow = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      assessment_type: true,
      question_set_version: true,
      organization: { select: { id: true, name: true } },
    },
  });

  if (!assessmentRow) return NextResponse.json({ ok: false, error: "Assessment not found" }, { status: 404 });
  if (assessmentRow.assessment_type !== "PRIORITY_DISCOVERY") {
    return NextResponse.json({ ok: false, error: "Not a Priority Discovery assessment" }, { status: 400 });
  }

  if (participantId) {
    const participant = await prisma.participant.findFirst({
      where: { id: participantId, assessment_id: assessmentId },
      select: { id: true },
    });
    if (!participant) return NextResponse.json({ ok: false, error: "Participant not found" }, { status: 404 });
  }

  const { questions, usesCustomQuestions } = await getPriorityQuestionsForAssessment(assessmentId);

  const responses = participantId
    ? await prisma.priorityResponse.findMany({
        where: { assessment_id: assessmentId, participant_id: participantId },
      })
    : [];

  return NextResponse.json({
    ok: true,
    assessment: {
      id: assessmentRow.id,
      assessmentType: "priority_discovery",
      questionSetVersion: assessmentRow.question_set_version,
      usesCustomQuestions,
      organization: assessmentRow.organization,
    },
    questions: questions.map(toClientPriorityQuestion),
    responses: responses.map((r) => ({
      questionId: r.question_id,
      answerText: r.answer_text,
      answerNumber: r.answer_number,
      answerJson: r.answer_json,
    })),
  });
}
