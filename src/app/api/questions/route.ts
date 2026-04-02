import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Department, Pillar } from "@prisma/client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const active = (searchParams.get("active") ?? "true") === "true";
  const version = searchParams.get("version") ?? "1";

  // Optional: scope the bank to an assessment configuration (admin setup).
  const assessmentId = searchParams.get("assessmentId");
  const participantId = searchParams.get("participantId");

  // Back-compat: if no assessmentId is provided, return the unfiltered bank
  let audienceFilter: Department[] | null = null;
  let assessmentType: string | null = null;

  if (assessmentId) {
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: { locked_department: true, type: true },
    });

    if (!assessment) {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }

    assessmentType = assessment.type;

    if (assessment.locked_department) {
      // Department-mode assessment (admin): org-wide items + locked department variants only.
      audienceFilter = [Department.ALL, assessment.locked_department];
    } else {
      // Org-wide assessment: ONLY audience ALL. Participant department (intake) is demographic
      // reporting only and must not pull department-specific question rows (e.g. OPS).
      audienceFilter = [Department.ALL];
    }

    if (participantId) {
      const participantExists = await prisma.participant.findFirst({
        where: { id: participantId, assessment_id: assessmentId },
        select: { id: true },
      });
      if (!participantExists) {
        return NextResponse.json({ error: "Participant not found for this assessment" }, { status: 404 });
      }
    }
  }

  const questions = await prisma.question.findMany({
    where: {
      active,
      version,
      ...(audienceFilter ? { audience: { in: audienceFilter } } : {}),
    },
    orderBy: [{ pillar: "asc" }, { display_order: "asc" }],
    select: {
      id: true,
      pillar: true,
      question_text: true,
      display_order: true,
      weight: true,
      version: true,
      audience: true, // helpful for debugging/verification
    },
  });

  const grouped: Record<Pillar, typeof questions> = {
    SYSTEM_INTEGRITY: [],
    HUMAN_ALIGNMENT: [],
    STRATEGIC_COHERENCE: [],
    SUSTAINABILITY_PRACTICE: [],
  };

  for (const q of questions) grouped[q.pillar].push(q);

  return NextResponse.json({
    version,
    active,
    assessmentId,
    participantId,
    assessmentType,
    audienceFilter,
    pillars: grouped,
  });
}