import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { loadAssessmentParticipantResponses } from "@/lib/assessmentParticipantResponses";

const ParamsSchema = z.object({
  id: z.string().uuid(),
  participantId: z.string().uuid(),
});

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

  const responses = await loadAssessmentParticipantResponses({
    assessmentId,
    participantId,
    assessmentType: assessment.assessment_type,
  });

  return NextResponse.json({
    ok: true,
    assessment: {
      id: assessment.id,
      name: assessment.name,
      assessmentType: assessment.assessment_type,
      organizationName: assessment.organization.name,
    },
    participant: {
      ...participant,
      completed_at: participant.completed_at?.toISOString() ?? null,
      created_at: participant.created_at.toISOString(),
    },
    responses,
  });
}
