import { prisma } from "@/lib/prisma";

type PillarKey = string;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function safeNumber(n: unknown): number | null {
  if (typeof n !== "number") return null;
  if (Number.isNaN(n)) return null;
  return n;
}

function normalizeText(value: string | null | undefined) {
  return value?.trim() || null;
}

/**
 * -------------------------------
 * Narrative Reference (NO NAME)
 * -------------------------------
 */

function getCompanyDescriptor(args: {
  industry?: string | null;
  contextNotes?: string | null;
  website?: string | null;
}) {
  const combined = [
    args.industry ?? "",
    args.contextNotes ?? "",
    args.website ?? "",
  ]
    .join(" ")
    .toLowerCase();

  if (
    combined.includes("logistics") ||
    combined.includes("freight") ||
    combined.includes("transport") ||
    combined.includes("trucking") ||
    combined.includes("supply chain")
  ) {
    return "the logistics company";
  }

  if (args.industry) {
    return `the ${args.industry.toLowerCase()} company`;
  }

  return "the company";
}

/**
 * -------------------------------
 * Score classification
 * -------------------------------
 */

function classifyScore(score: number | null) {
  if (score === null) {
    return { band: null, key: "unknown", color: "#cdd8df" };
  }
  if (score <= 2.4) {
    return { band: "Stabilize First", key: "stabilize", color: "#66819e" };
  }
  if (score <= 3.4) {
    return { band: "Proceed with Intention", key: "proceed", color: "#34b0b4" };
  }
  return { band: "Ready to Scale", key: "ready", color: "#173464" };
}

/**
 * -------------------------------
 * Main Builder
 * -------------------------------
 */

export async function buildAssessmentResultsPayload(args: { assessmentId: string }) {
  const { assessmentId } = args;

  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      name: true,
      organization_id: true,
      type: true,
      status: true,
      created_at: true,
      organization: {
        select: {
          id: true,
          industry: true,
          website: true,
          context_notes: true,
          primary_pressures: true,
          growth_stage: true,
          size: true,
        },
      },
    },
  });

  if (!assessment) {
    return { ok: false, status: 404, body: { error: "Assessment not found" } };
  }

  const questions = await prisma.question.findMany({
    where: { active: true },
    select: {
      id: true,
      pillar: true,
      weight: true,
      question_text: true,
    },
  });

  const responses = await prisma.response.findMany({
    where: { assessment_id: assessmentId },
    select: {
      question_id: true,
      score: true,
      free_write: true,
      Participant: {
        select: {
          role: true,
          seniority_level: true,
          department: true,
          ai_opportunities_notes: true,
        },
      },
    },
  });

  /**
   * -------------------------------
   * Scoring
   * -------------------------------
   */

  const pillarScores: Record<string, number[]> = {};

  for (const r of responses) {
    const q = questions.find((q) => q.id === r.question_id);
    if (!q) continue;

    const pillar = String(q.pillar);

    if (!pillarScores[pillar]) pillarScores[pillar] = [];
    pillarScores[pillar].push(r.score);
  }

  const pillars: Record<string, { weightedAverage: number | null }> = {};

  for (const [pillar, scores] of Object.entries(pillarScores)) {
    if (!scores.length) {
      pillars[pillar] = { weightedAverage: null };
    } else {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      pillars[pillar] = { weightedAverage: round2(avg) };
    }
  }

  const allScores = Object.values(pillarScores).flat();
  const overall =
    allScores.length > 0
      ? round2(allScores.reduce((a, b) => a + b, 0) / allScores.length)
      : null;

  /**
   * -------------------------------
   * Narrative Context
   * -------------------------------
   */

  const companyDescriptor = getCompanyDescriptor({
    industry: assessment.organization?.industry,
    contextNotes: assessment.organization?.context_notes,
    website: assessment.organization?.website,
  });

  const freeTextResponses = responses
    .map((r) => {
      const q = questions.find((q) => q.id === r.question_id);
      const text = normalizeText(r.free_write);
      if (!q || !text) return null;

      return {
        question: q.question_text,
        pillar: q.pillar,
        answer: text,
        role: r.Participant.role,
        seniority: r.Participant.seniority_level,
      };
    })
    .filter(Boolean);

  const participantNotes = responses
    .map((r) => normalizeText(r.Participant.ai_opportunities_notes))
    .filter(Boolean);

  /**
   * -------------------------------
   * Final Payload
   * -------------------------------
   */

  return {
    ok: true,
    status: 200,
    body: {
      assessment: {
        id: assessment.id,
        name: assessment.name,
        organization_id: assessment.organization_id,
        type: assessment.type,
        status: assessment.status,
        created_at: assessment.created_at,
      },
      aggregate: {
        overall,
        pillars,
      },
      narrativeContext: {
        reference: {
          companyDescriptor,
          namingPolicy: "DO NOT USE COMPANY NAME",
        },
        businessContext: {
          industry: assessment.organization?.industry,
          contextNotes: assessment.organization?.context_notes,
          website: assessment.organization?.website,
          primaryPressures: assessment.organization?.primary_pressures,
          growthStage: assessment.organization?.growth_stage,
          size: assessment.organization?.size,
        },
        evidence: {
          freeTextResponses,
          participantNotes,
        },
      },
    },
  };
}