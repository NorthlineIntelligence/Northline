import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Department, Pillar } from "@prisma/client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const active = (searchParams.get("active") ?? "true") === "true";
  const version = searchParams.get("version") ?? "1";

  // New: optional context for audience filtering
  const assessmentId = searchParams.get("assessmentId");
  const participantId = searchParams.get("participantId");

  // Back-compat: if no assessmentId is provided, return the unfiltered bank (current behavior)
  let audienceFilter: Department[] | null = null;

  if (assessmentId) {
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: { locked_department: true },
    });

    if (!assessment) {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }

    if (assessment.locked_department) {
      // Team-only locked: ALL + locked_department
      audienceFilter = [Department.ALL, assessment.locked_department];
    } else {
      // Org-wide: ALL + participant.department (if missing/null => ALL only)
      if (participantId) {
        const participant = await prisma.participant.findUnique({
          where: { id: participantId },
          select: { department: true },
        });

        if (!participant) {
          return NextResponse.json({ error: "Participant not found" }, { status: 404 });
        }

        audienceFilter = participant.department
          ? [Department.ALL, participant.department]
          : [Department.ALL];
      } else {
        // No participant provided => treat as ALL
        audienceFilter = [Department.ALL];
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
    audienceFilter,
    pillars: grouped,
  });
}