import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Department, Industry, Pillar } from "@prisma/client";
import { normalizeIndustryText } from "@/lib/assessmentIndustry";
import { renderQuestionText } from "@/lib/questionContextRenderer";

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
  let industryFilter: Industry[] | null = null;
  let resolvedAssessmentIndustry: Industry = "ALL_INDUSTRIES";
  let resolvedLockedDepartment: Department | null = null;

  if (assessmentId) {
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        locked_department: true,
        type: true,
        industry: true,
        organization: { select: { industry: true } },
      },
    });

    if (!assessment) {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }

    assessmentType = assessment.type;
    resolvedLockedDepartment = assessment.locked_department ?? null;
    resolvedAssessmentIndustry =
      assessment.industry ??
      normalizeIndustryText(assessment.organization?.industry) ??
      "ALL_INDUSTRIES";

    industryFilter =
      resolvedAssessmentIndustry === "ALL_INDUSTRIES"
        ? ["ALL_INDUSTRIES"]
        : ["ALL_INDUSTRIES", resolvedAssessmentIndustry];

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
      ...(industryFilter ? { industry: { in: industryFilter } } : {}),
    },
    orderBy: [{ pillar: "asc" }, { display_order: "asc" }],
    select: {
      id: true,
      pillar: true,
      question_core: true,
      question_text: true,
      context_mode: true,
      industry_context_json: true,
      display_order: true,
      weight: true,
      version: true,
      audience: true, // helpful for debugging/verification
      industry: true,
    },
  });

  const renderedQuestions = questions.map((q) => {
    const renderedText = renderQuestionText({
      questionCore: q.question_core || q.question_text,
      contextMode: q.context_mode,
      selectedIndustry: resolvedAssessmentIndustry,
      industryContextJson: q.industry_context_json,
    });
    return {
      ...q,
      question_text: renderedText || q.question_text,
    };
  });

  // Deduplicate to one question per pillar+display_order.
  // Prefer exact industry and exact locked department when available.
  function rankQuestion(q: (typeof renderedQuestions)[number]) {
    // Prefer the new canonical model rows (question_core/context render capable)
    // over legacy hardcoded question_text-only rows.
    const modelRank = q.question_core && q.question_core.trim().length > 0 ? 100 : 0;
    const industryRank =
      q.industry === resolvedAssessmentIndustry ? 2 : q.industry === "ALL_INDUSTRIES" ? 1 : 0;
    const audienceRank = resolvedLockedDepartment
      ? q.audience === resolvedLockedDepartment
        ? 2
        : q.audience === Department.ALL
          ? 1
          : 0
      : q.audience === Department.ALL
        ? 2
        : 0;
    return modelRank + industryRank * 10 + audienceRank;
  }

  const dedupedQuestionsMap = new Map<string, (typeof renderedQuestions)[number]>();
  for (const q of renderedQuestions) {
    const key = `${q.pillar}::${q.display_order}`;
    const current = dedupedQuestionsMap.get(key);
    if (!current) {
      dedupedQuestionsMap.set(key, q);
      continue;
    }
    if (rankQuestion(q) > rankQuestion(current)) {
      dedupedQuestionsMap.set(key, q);
    }
  }

  const dedupedQuestions = Array.from(dedupedQuestionsMap.values()).sort((a, b) => {
    if (a.pillar !== b.pillar) return a.pillar.localeCompare(b.pillar);
    return a.display_order - b.display_order;
  });

  const grouped: Record<Pillar, typeof questions> = {
    SYSTEM_INTEGRITY: [],
    HUMAN_ALIGNMENT: [],
    STRATEGIC_COHERENCE: [],
    SUSTAINABILITY_PRACTICE: [],
  };

  for (const q of dedupedQuestions) grouped[q.pillar].push(q);

  return NextResponse.json({
    version,
    active,
    assessmentId,
    participantId,
    assessmentType,
    assessmentIndustry: resolvedAssessmentIndustry,
    industryFilter,
    audienceFilter,
    pillars: grouped,
  });
}