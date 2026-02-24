import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Pillar } from "@prisma/client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const active = (searchParams.get("active") ?? "true") === "true";
  const version = searchParams.get("version") ?? "1";

  const questions = await prisma.question.findMany({
    where: { active, version },
    orderBy: [{ pillar: "asc" }, { display_order: "asc" }],
    select: {
      id: true,
      pillar: true,
      question_text: true,
      display_order: true,
      weight: true,
      version: true,
    },
  });

  const grouped: Record<Pillar, typeof questions> = {
    SYSTEM_INTEGRITY: [],
    HUMAN_ALIGNMENT: [],
    STRATEGIC_COHERENCE: [],
    SUSTAINABILITY_PRACTICE: [],
  };

  for (const q of questions) grouped[q.pillar].push(q);

  return NextResponse.json({ version, active, pillars: grouped });
}