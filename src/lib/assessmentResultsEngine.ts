import { prisma } from "@/lib/prisma";

/**
 * NOTE:
 * This module is the single source of truth for diagnostic results computation.
 * Any narrative generation must consume this output to avoid drift between
 * dashboard readout and executive memo.
 */

type PillarKey = string;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function safeNumber(n: unknown): number | null {
  if (typeof n !== "number") return null;
  if (Number.isNaN(n)) return null;
  return n;
}

/**
 * Band classification using Northline brand colors.
 * Thresholds:
 * - <= 2.4 => stabilize
 * - <= 3.4 => proceed
 * - >  3.4 => ready
 */
function classifyScore(score: number | null) {
  if (score === null || Number.isNaN(score)) {
    return {
      band: null,
      key: "unknown" as const,
      color: "#cdd8df",
    };
  }

  if (score <= 2.4) {
    return {
      band: "Stabilize First" as const,
      key: "stabilize" as const,
      color: "#66819e",
    };
  }

  if (score <= 3.4) {
    return {
      band: "Proceed with Intention" as const,
      key: "proceed" as const,
      color: "#34b0b4",
    };
  }

  return {
    band: "Ready to Scale" as const,
    key: "ready" as const,
    color: "#173464",
  };
}

const legend = {
  stabilize: { band: "Stabilize First", color: "#66819e" },
  proceed: { band: "Proceed with Intention", color: "#34b0b4" },
  ready: { band: "Ready to Scale", color: "#173464" },
  unknown: { band: null, color: "#cdd8df" },
};

const reportingThresholds = {
  stabilize: {
    key: "stabilize",
    band: "Stabilize First",
    color: "#66819e",
    max: 2.4,
  },
  proceed: {
    key: "proceed",
    band: "Proceed with Intention",
    color: "#34b0b4",
    minExclusive: 2.4,
    max: 3.4,
  },
  ready: {
    key: "ready",
    band: "Ready to Scale",
    color: "#173464",
    minExclusive: 3.4,
  },
  unknown: {
    key: "unknown",
    band: null,
    color: "#cdd8df",
  },
};

/**
 * Protective overall score rules (executive truth):
 * - If any pillar < 2.5 => cap overall at 3.4
 * - If any pillar < 2.0 => cap overall at 2.4
 * - If variance (max-min) > 1.5 => subtract 0.3
 */
function applyProtectiveRules(args: {
  rawOverall: number | null;
  pillarAverages: Array<{ pillar: string; score: number | null }>;
}) {
  const { rawOverall, pillarAverages } = args;

  const raw = safeNumber(rawOverall);
  if (raw === null) {
    return {
      protectedScore: null as number | null,
      rules: {
        capAt34_dueToAnyPillarBelow25: false,
        capAt24_dueToAnyPillarBelow20: false,
        variancePenaltyApplied: false,
        variance: null as number | null,
      },
      explanation: "Insufficient data to compute overall score.",
    };
  }

  const validPillarScores = pillarAverages
    .map((p) => safeNumber(p.score))
    .filter((v): v is number => v !== null);

  let protectedScore = raw;

  const anyBelow25 = validPillarScores.some((s) => s < 2.5);
  const anyBelow20 = validPillarScores.some((s) => s < 2.0);

  // variance
  let variance: number | null = null;
  let variancePenaltyApplied = false;
  if (validPillarScores.length >= 2) {
    const max = Math.max(...validPillarScores);
    const min = Math.min(...validPillarScores);
    variance = round2(max - min);
    if (variance > 1.5) {
      protectedScore = protectedScore - 0.3;
      variancePenaltyApplied = true;
    }
  }

  // caps (apply after variance penalty; cap is final limiter)
  let capAt34_dueToAnyPillarBelow25 = false;
  let capAt24_dueToAnyPillarBelow20 = false;

  if (anyBelow25 && protectedScore > 3.4) {
    protectedScore = 3.4;
    capAt34_dueToAnyPillarBelow25 = true;
  }

  if (anyBelow20 && protectedScore > 2.4) {
    protectedScore = 2.4;
    capAt24_dueToAnyPillarBelow20 = true;
  }

  protectedScore = round2(protectedScore);

  const parts: string[] = [];
  parts.push(`Raw overall score: ${round2(raw)}.`);

  if (variance !== null) {
    parts.push(`Pillar variance (max-min): ${variance}.`);
  }

  if (variancePenaltyApplied) {
    parts.push("Variance > 1.5: applied -0.3 stability penalty.");
  }

  if (capAt34_dueToAnyPillarBelow25) {
    parts.push("At least one pillar < 2.5: capped overall at 3.4.");
  }

  if (capAt24_dueToAnyPillarBelow20) {
    parts.push("At least one pillar < 2.0: capped overall at 2.4.");
  }

  parts.push(`Protected overall score: ${protectedScore}.`);

  return {
    protectedScore,
    rules: {
      capAt34_dueToAnyPillarBelow25,
      capAt24_dueToAnyPillarBelow20,
      variancePenaltyApplied,
      variance,
    },
    explanation: parts.join(" "),
  };
}

/**
 * 4-tier maturity model (v1 doctrine).
 * Tier score source: PROTECTED overall score (executive truth).
 */
function classifyMaturityTier(score: number | null) {
  if (score === null || Number.isNaN(score)) {
    return {
      tier: null as
        | "FRAGMENTED"
        | "EMERGING"
        | "OPERATIONALIZING"
        | "INSTITUTIONALIZED"
        | null,
      label: null as
        | "Fragmented"
        | "Emerging"
        | "Operationalizing"
        | "Institutionalized"
        | null,
      posture: null as "Reactive" | "Structured" | "Systemic" | "Strategic" | null,
    };
  }

  if (score < 2.3) {
    return {
      tier: "FRAGMENTED" as const,
      label: "Fragmented" as const,
      posture: "Reactive" as const,
    };
  }

  if (score < 3.1) {
    return {
      tier: "EMERGING" as const,
      label: "Emerging" as const,
      posture: "Structured" as const,
    };
  }

  if (score < 4.1) {
    return {
      tier: "OPERATIONALIZING" as const,
      label: "Operationalizing" as const,
      posture: "Systemic" as const,
    };
  }

  return {
    tier: "INSTITUTIONALIZED" as const,
    label: "Institutionalized" as const,
    posture: "Strategic" as const,
  };
}

const maturityTierThresholds = {
  fragmented: { minInclusive: 1.0, maxExclusive: 2.3 },
  emerging: { minInclusive: 2.3, maxExclusive: 3.1 },
  operationalizing: { minInclusive: 3.1, maxExclusive: 4.1 },
  institutionalized: { minInclusive: 4.1, maxInclusive: 5.0 },
};

const maturityWeighting = {
  STRATEGIC_COHERENCE: 0.3,
  HUMAN_ALIGNMENT: 0.3,
  SYSTEM_INTEGRITY: 0.25,
  SUSTAINABILITY_PRACTICE: 0.15,
} as const;

type RiskFlagKey =
  | "CRITICAL_WEAKNESS"
  | "STRUCTURAL_IMBALANCE"
  | "ADOPTION_RISK";

function computeRiskFlags(args: {
  pillars: Record<PillarKey, { weightedAverage: number | null }>;
}) {
  const { pillars } = args;

  const pillarScores = Object.entries(pillars).map(([pillar, obj]) => ({
    pillar,
    score: safeNumber(obj.weightedAverage),
  }));

  const validScores = pillarScores
    .map((p) => p.score)
    .filter((v): v is number => v !== null);

  const flags: Array<{
    key: RiskFlagKey;
    title: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    details: any;
  }> = [];

  // Critical weakness: any pillar < 2.0
  const critical = pillarScores.filter((p) => p.score !== null && p.score < 2.0);
  if (critical.length > 0) {
    flags.push({
      key: "CRITICAL_WEAKNESS",
      title: "Critical Weakness Detected",
      severity: "HIGH",
      details: {
        pillars: critical.map((p) => ({ pillar: p.pillar, score: p.score })),
        rule: "any pillar < 2.0",
      },
    });
  }

  // Structural imbalance: variance > 1.5
  if (validScores.length >= 2) {
    const max = Math.max(...validScores);
    const min = Math.min(...validScores);
    const variance = round2(max - min);
    if (variance > 1.5) {
      flags.push({
        key: "STRUCTURAL_IMBALANCE",
        title: "Structural Imbalance Across Pillars",
        severity: "MEDIUM",
        details: {
          variance,
          rule: "variance (max-min) > 1.5",
          highest: max,
          lowest: min,
        },
      });
    }
  }

  // Adoption risk: HUMAN_ALIGNMENT < 2.5 AND SYSTEM_INTEGRITY > 3.5
  const human = safeNumber(pillars["HUMAN_ALIGNMENT"]?.weightedAverage ?? null);
  const system = safeNumber(pillars["SYSTEM_INTEGRITY"]?.weightedAverage ?? null);
  if (human !== null && system !== null && human < 2.5 && system > 3.5) {
    flags.push({
      key: "ADOPTION_RISK",
      title: "Adoption Risk: Systems Outpacing Human Alignment",
      severity: "HIGH",
      details: {
        rule: "HUMAN_ALIGNMENT < 2.5 AND SYSTEM_INTEGRITY > 3.5",
        HUMAN_ALIGNMENT: human,
        SYSTEM_INTEGRITY: system,
      },
    });
  }

  return flags;
}

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
          name: true,
        },
      },
    },
  });

  if (!assessment) {
    return { ok: false as const, status: 404 as const, body: { error: "Assessment not found" } };
  }

  const participant = await prisma.participant.findFirst({
    where: { assessment_id: assessmentId },
    select: { id: true },
  });

  const participantId = participant?.id ?? null;

  const questions = await prisma.question.findMany({
    where: { active: true, version: "1" },
    select: { id: true, pillar: true, weight: true, display_order: true },
    orderBy: [{ display_order: "asc" }],
  });

  const totalQuestions = questions.length;

  const totalQuestionsByPillar: Record<PillarKey, number> = {};
  const questionById = new Map<string, { pillar: PillarKey; weight: number }>();

  for (const q of questions) {
    const pillar = String(q.pillar);
    const weight = q.weight ?? 1;
    questionById.set(q.id, { pillar, weight });
    totalQuestionsByPillar[pillar] = (totalQuestionsByPillar[pillar] || 0) + 1;
  }

  const responses = await prisma.response.findMany({
    where: { assessment_id: assessmentId },
    select: { question_id: true, score: true },
  });

  const pillars: Record<
    PillarKey,
    {
      weightedAverage: number | null;
      datasetCoveragePct: number;
      avgParticipantCompletionPct: number;
      answeredResponses: number;
      possibleResponses: number;
      totalQuestions: number;
    }
  > = {};

  for (const [pillar, count] of Object.entries(totalQuestionsByPillar)) {
    pillars[pillar] = {
      weightedAverage: null,
      datasetCoveragePct: 0,
      avgParticipantCompletionPct: 0,
      answeredResponses: 0,
      possibleResponses: count,
      totalQuestions: count,
    };
  }

  const sumScoreWeightByPillar: Record<PillarKey, number> = {};
  const sumWeightByPillar: Record<PillarKey, number> = {};
  let overallScoreWeightSum = 0;
  let overallWeightSum = 0;

  let overallAnsweredResponses = 0;
  const answeredResponsesByPillar: Record<PillarKey, number> = {};

  for (const r of responses) {
    const q = questionById.get(r.question_id);
    if (!q) continue;

    const { pillar, weight } = q;

    sumScoreWeightByPillar[pillar] =
      (sumScoreWeightByPillar[pillar] || 0) + r.score * weight;
    sumWeightByPillar[pillar] = (sumWeightByPillar[pillar] || 0) + weight;

    overallScoreWeightSum += r.score * weight;
    overallWeightSum += weight;

    answeredResponsesByPillar[pillar] =
      (answeredResponsesByPillar[pillar] || 0) + 1;
    overallAnsweredResponses += 1;
  }

  for (const pillarKey of Object.keys(pillars)) {
    const weightSum = sumWeightByPillar[pillarKey] || 0;
    const scoreWeightSum = sumScoreWeightByPillar[pillarKey] || 0;

    const answered = answeredResponsesByPillar[pillarKey] || 0;
    const possible = pillars[pillarKey].possibleResponses;

    pillars[pillarKey].answeredResponses = answered;
    pillars[pillarKey].weightedAverage =
      weightSum === 0 ? null : round2(scoreWeightSum / weightSum);

    const coveragePct =
      possible === 0 ? 0 : round2((answered / possible) * 100);

    pillars[pillarKey].datasetCoveragePct = coveragePct;
    pillars[pillarKey].avgParticipantCompletionPct = coveragePct;
  }

  const overallWeightedAverage =
    overallWeightSum === 0 ? null : round2(overallScoreWeightSum / overallWeightSum);

  const overallPossibleResponses = totalQuestions;
  const overallCoveragePct =
    overallPossibleResponses === 0
      ? 0
      : round2((overallAnsweredResponses / overallPossibleResponses) * 100);

  // Bands
  const pillarBands: Record<PillarKey, { band: string | null; key: string; color: string }> = {};
  for (const [pillarKey, pillarObj] of Object.entries(pillars)) {
    pillarBands[pillarKey] = classifyScore(pillarObj.weightedAverage);
  }
  const overallBandRaw = classifyScore(overallWeightedAverage);

  // Reporting
  const radar = Object.entries(pillars).map(([pillarKey, pillarObj]) => {
    const b = pillarBands[pillarKey] ?? classifyScore(pillarObj.weightedAverage);
    return {
      key: pillarKey,
      label: pillarKey,
      value: pillarObj.weightedAverage,
      bandKey: b.key,
      band: b.band,
      color: b.color,
    };
  });

  // Protective overall score (executive truth)
  const protective = applyProtectiveRules({
    rawOverall: overallWeightedAverage,
    pillarAverages: Object.entries(pillars).map(([pillar, obj]) => ({
      pillar,
      score: obj.weightedAverage,
    })),
  });

  const protectedOverall = protective.protectedScore;
  const overallBandProtected = classifyScore(protectedOverall);

  // Maturity tier (uses PROTECTED overall score)
  const maturity = classifyMaturityTier(protectedOverall);

  // Risk flags
  const riskFlags = computeRiskFlags({ pillars });

  return {
    ok: true as const,
    status: 200 as const,
    body: {
        organizationName: assessment.organization?.name ?? null,
        assessment: {
          ...assessment,
          organization: {
            id: assessment.organization?.id ?? null,
            name: assessment.organization?.name ?? null,
          },
        },
      participantId,
      meta: {
        totalQuestions,
        totalQuestionsByPillar,
        responseCount: responses.length,
      },
      aggregate: {
        overall: {
          weightedAverageRaw: overallWeightedAverage,
          weightedAverage: protectedOverall,
          datasetCoveragePct: overallCoveragePct,
          avgParticipantCompletionPct: overallCoveragePct,
          answeredResponses: overallAnsweredResponses,
          possibleResponses: overallPossibleResponses,
        },
        pillars,
      },
      bands: {
        legend,
        overallRaw: overallBandRaw,
        overall: overallBandProtected,
        pillars: pillarBands,
      },
      reporting: {
        radar,
        thresholds: reportingThresholds,
      },
      maturity: {
        tier: maturity.tier,
        label: maturity.label,
        posture: maturity.posture,
        tierScore: protectedOverall,
        tierThresholds: maturityTierThresholds,
        weighting: maturityWeighting,
        scoreSource: "protected_overall" as const,
      },
      riskFlags,
      protectiveRules: protective.rules,
      protectionExplanation: protective.explanation,
    },
  };
}