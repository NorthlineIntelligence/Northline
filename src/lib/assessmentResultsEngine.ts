import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Row shape for organization fields used in assessment results (must match Prisma schema). */
type OrganizationResultsRow = {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  context_notes: string | null;
  primary_pressures: string | null;
  growth_stage: string | null;
  size: string | null;
  show_admin_controls: boolean;
  show_project_scope_review: boolean;
};

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
}) {
  const combined = [args.industry ?? "", args.contextNotes ?? ""].join(" ").toLowerCase();

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
 * Protective scoring (aligned with organization results route).
 */
function applyProtectiveRules(weightedAverageRaw: number | null, pillarAverages: Array<number | null>) {
  const SUMMARY =
    "Your overall score reflects weighted scoring and structural stability safeguards. Certain questions carry greater strategic weight, and significant imbalance across pillars reduces the final score to reflect operational risk rather than isolated strength.";

  if (weightedAverageRaw === null || Number.isNaN(weightedAverageRaw)) {
    return {
      weightedAverageRaw: null,
      weightedAverage: null,
      protectiveRules: {
        triggered: false,
        anyPillarBelow25: false,
        anyPillarBelow20: false,
        varianceTriggered: false,
        minPillar: null as number | null,
        maxPillar: null as number | null,
        variance: null as number | null,
        caps: { applied: null as number | null },
        variancePenalty: { applied: false, amount: 0 },
      },
      protectionExplanation: {
        summary: null as string | null,
      },
    };
  }

  const validPillars = pillarAverages.filter((n): n is number => n !== null && !Number.isNaN(n));

  const minPillar = validPillars.length ? Math.min(...validPillars) : null;
  const maxPillar = validPillars.length ? Math.max(...validPillars) : null;
  const variance = minPillar === null || maxPillar === null ? null : round2(maxPillar - minPillar);

  const anyPillarBelow25 = validPillars.some((n) => n < 2.5);
  const anyPillarBelow20 = validPillars.some((n) => n < 2.0);
  const varianceTriggered = variance !== null ? variance > 1.5 : false;

  let protectedScore = weightedAverageRaw;
  let capApplied: number | null = null;

  if (anyPillarBelow25) {
    protectedScore = Math.min(protectedScore, 3.4);
    capApplied = 3.4;
  }
  if (anyPillarBelow20) {
    protectedScore = Math.min(protectedScore, 2.4);
    capApplied = 2.4;
  }

  let variancePenaltyApplied = false;
  const variancePenaltyAmount = 0.3;
  if (varianceTriggered) {
    protectedScore = protectedScore - variancePenaltyAmount;
    variancePenaltyApplied = true;
  }

  protectedScore = Math.max(0, Math.min(5, protectedScore));

  const weightedAverage = round2(protectedScore);

  const triggered = anyPillarBelow25 || anyPillarBelow20 || varianceTriggered;

  return {
    weightedAverageRaw: round2(weightedAverageRaw),
    weightedAverage,
    protectiveRules: {
      triggered,
      anyPillarBelow25,
      anyPillarBelow20,
      varianceTriggered,
      minPillar,
      maxPillar,
      variance,
      caps: { applied: capApplied },
      variancePenalty: {
        applied: variancePenaltyApplied,
        amount: variancePenaltyApplied ? variancePenaltyAmount : 0,
      },
    },
    protectionExplanation: {
      summary: triggered ? SUMMARY : null,
    },
  };
}

/** Band classification — thresholds aligned with organization /api/organizations/[id]/results */
function classifyScore(score: number | null) {
  if (score === null || Number.isNaN(score)) {
    return { band: null, key: "unknown" as const, color: "#cdd8df" };
  }

  if (score <= 2.4) {
    return { band: "Stabilize First" as const, key: "stabilize" as const, color: "#66819e" };
  }

  if (score <= 3.9) {
    return { band: "Proceed with Intention" as const, key: "proceed" as const, color: "#34b0b4" };
  }

  return { band: "Ready to Scale" as const, key: "ready" as const, color: "#173464" };
}

const bandsLegend = {
  stabilize: { band: "Stabilize First", color: "#66819e" },
  proceed: { band: "Proceed with Intention", color: "#34b0b4" },
  ready: { band: "Ready to Scale", color: "#173464" },
  unknown: { band: null as string | null, color: "#cdd8df" },
};

const PILLAR_LABELS: Record<string, string> = {
  SYSTEM_INTEGRITY: "System Integrity",
  HUMAN_ALIGNMENT: "Human Alignment",
  STRATEGIC_COHERENCE: "Strategic Coherence",
  SUSTAINABILITY_PRACTICE: "Sustainability Practice",
};

const PILLAR_ORDER = [
  "SYSTEM_INTEGRITY",
  "HUMAN_ALIGNMENT",
  "STRATEGIC_COHERENCE",
  "SUSTAINABILITY_PRACTICE",
] as const;

function formatPillarLabel(pillarKey: string) {
  return (
    PILLAR_LABELS[pillarKey] ??
    pillarKey
      .toLowerCase()
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

function buildMaturity(args: {
  protectedScore: number | null;
  overallBandKey: string;
  varianceTriggered: boolean;
}) {
  const { protectedScore, overallBandKey, varianceTriggered } = args;
  const posture = varianceTriggered ? "Fragmented" : "Structured";

  let label: string;
  let tier: string;
  if (overallBandKey === "stabilize") {
    label = "Stabilize First";
    tier = "FRAGMENTED";
  } else if (overallBandKey === "proceed") {
    label = "Emerging";
    tier = "EMERGING";
  } else if (overallBandKey === "ready") {
    label = "Ready to Scale";
    tier = "INSTITUTIONALIZED";
  } else {
    label = "Unknown";
    tier = "";
  }

  return {
    label,
    posture,
    tier: tier || null,
    tierScore: protectedScore,
  };
}

function buildDoctrineRiskFlags(args: {
  protectiveRules: {
    anyPillarBelow20: boolean;
    varianceTriggered: boolean;
    variance: number | null;
    minPillar: number | null;
    maxPillar: number | null;
  };
  pillarEntries: Array<{ pillar: string; score: number | null }>;
}) {
  const { protectiveRules, pillarEntries } = args;
  const flags: any[] = [];

  if (protectiveRules.anyPillarBelow20) {
    const below = pillarEntries.filter((p) => p.score !== null && (p.score as number) < 2.0);
    flags.push({
      key: "MINIMUM_PILLAR",
      severity: "HIGH",
      title: "Minimum pillar threshold triggered",
      details: {
        rule: "any pillar < 2.0",
        pillars: below.map((p) => ({ pillar: p.pillar, score: p.score })),
      },
    });
  }

  if (protectiveRules.varianceTriggered) {
    flags.push({
      key: "STRUCTURAL_IMBALANCE",
      severity: "MEDIUM",
      title: "Pillar imbalance detected",
      details: {
        rule: "variance (max-min) > 1.5",
        variance: protectiveRules.variance,
        highest: protectiveRules.maxPillar,
        lowest: protectiveRules.minPillar,
      },
    });
  }

  return flags;
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
    },
  });

  if (!assessment) {
    return { ok: false, status: 404, body: { error: "Assessment not found" } };
  }

  const organization = (await prisma.organization.findUnique({
    where: { id: assessment.organization_id },
    select: {
      id: true,
      name: true,
      industry: true,
      website: true,
      context_notes: true,
      primary_pressures: true,
      growth_stage: true,
      size: true,
      show_admin_controls: true,
      show_project_scope_review: true,
    } as Prisma.OrganizationSelect,
  })) as OrganizationResultsRow | null;

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

  const pillarScores: Record<string, { score: number; weight: number }[]> = {};

  for (const r of responses) {
    const q = questions.find((qq) => qq.id === r.question_id);
    if (!q) continue;

    const pillar = String(q.pillar);
    const score = safeNumber(r.score);
    if (score === null) continue;

    const weight = typeof q.weight === "number" && q.weight > 0 ? q.weight : 1;

    if (!pillarScores[pillar]) pillarScores[pillar] = [];
    pillarScores[pillar].push({ score, weight });
  }

  const pillars: Record<string, { weightedAverage: number | null }> = {};

  for (const pillarKey of PILLAR_ORDER) {
    const entries = pillarScores[pillarKey] ?? [];

    if (!entries.length) {
      pillars[pillarKey] = { weightedAverage: null };
      continue;
    }

    const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
    const weightedSum = entries.reduce((sum, entry) => sum + entry.score * entry.weight, 0);

    pillars[pillarKey] = {
      weightedAverage: totalWeight > 0 ? round2(weightedSum / totalWeight) : null,
    };
  }

  const allEntries = Object.values(pillarScores).flat();
  const overallWeightedAverageRaw =
    allEntries.length > 0
      ? round2(
          allEntries.reduce((sum, entry) => sum + entry.score * entry.weight, 0) /
            allEntries.reduce((sum, entry) => sum + entry.weight, 0)
        )
      : null;

  const pillarAveragesForProtection = PILLAR_ORDER.map((k) => pillars[k]?.weightedAverage ?? null);

  const protectedOverall = applyProtectiveRules(overallWeightedAverageRaw, pillarAveragesForProtection);

  const pillarBands: Record<string, { band: string | null; key: string; color: string }> = {};
  for (const pillarKey of PILLAR_ORDER) {
    pillarBands[pillarKey] = classifyScore(pillars[pillarKey]?.weightedAverage ?? null);
  }

  const overallBand = classifyScore(protectedOverall.weightedAverage);

  const radarPillars = PILLAR_ORDER.map((pillarKey) => {
    const score = pillars[pillarKey]?.weightedAverage ?? null;
    const band = pillarBands[pillarKey] ?? classifyScore(score);
    return {
      key: pillarKey,
      label: formatPillarLabel(pillarKey),
      score,
      value: score,
      band: band.band,
      bandKey: band.key,
      color: band.color,
    };
  });

  const pillarEntries = PILLAR_ORDER.map((pillar) => ({
    pillar,
    score: pillars[pillar]?.weightedAverage ?? null,
    classification: classifyScore(pillars[pillar]?.weightedAverage ?? null),
  }));

  const weakestPillars = pillarEntries
    .filter((p): p is typeof p & { score: number } => p.score !== null)
    .sort((a, b) => a.score - b.score);

  const riskSignalsBase = weakestPillars.filter((p) => (p.score ?? 999) <= 2.9).slice(0, 3);

  const riskSignalsSource =
    riskSignalsBase.length > 0 ? riskSignalsBase : weakestPillars.slice(0, 2);

  const humanPillar = (key: string) => formatPillarLabel(key).toLowerCase();

  const riskSignals = riskSignalsSource.map((p) => ({
    pillar: p.pillar,
    score: p.score,
    severity: (p.score ?? 999) <= 2.3 ? "high" : "moderate",
    summary: `${formatPillarLabel(p.pillar)} is below the target readiness threshold and may limit early AI execution.`,
    implication: `Projects may stall or underperform unless ${humanPillar(p.pillar)} is strengthened during planning and rollout.`,
  }));

  const companyDescriptor = getCompanyDescriptor({
    industry: organization?.industry,
    contextNotes: organization?.context_notes,
  });

  const freeTextResponses = responses
    .map((r) => {
      const q = questions.find((qq) => qq.id === r.question_id);
      const text = normalizeText(r.free_write);
      if (!q || !text) return null;

      return {
        question: q.question_text,
        pillar: String(q.pillar),
        answer: text,
        role: r.Participant.role,
        seniority: r.Participant.seniority_level,
      };
    })
    .filter((value) => value !== null);

  const participantNotes = responses
    .map((r) => normalizeText(r.Participant.ai_opportunities_notes))
    .filter((value): value is string => value !== null);

  const maturity = buildMaturity({
    protectedScore: protectedOverall.weightedAverage,
    overallBandKey: overallBand.key,
    varianceTriggered: protectedOverall.protectiveRules.varianceTriggered,
  });

  const riskFlags = buildDoctrineRiskFlags({
    protectiveRules: protectedOverall.protectiveRules,
    pillarEntries,
  });

  const protectionExplanation =
    typeof protectedOverall.protectionExplanation.summary === "string"
      ? protectedOverall.protectionExplanation.summary
      : null;

  return {
    ok: true,
    status: 200,
    body: {
      organizationName: organization?.name ?? null,
      assessment: {
        id: assessment.id,
        name: assessment.name,
        organization_id: assessment.organization_id,
        organization_name: organization?.name ?? null,
        organization: organization
          ? {
              id: organization.id,
              name: organization.name,
              show_admin_controls: organization.show_admin_controls,
              show_project_scope_review: organization.show_project_scope_review,
            }
          : null,
        type: assessment.type,
        status: assessment.status,
        created_at: assessment.created_at,
      },
      aggregate: {
        overall: {
          weightedAverageRaw: protectedOverall.weightedAverageRaw,
          weightedAverage: protectedOverall.weightedAverage,
          protectiveRules: protectedOverall.protectiveRules,
          protectionExplanation: protectedOverall.protectionExplanation,
          readinessIndex: protectedOverall.weightedAverage,
          readinessBand: overallBand.band,
          readinessKey: overallBand.key,
        },
        pillars,
        pillarEntries,
      },
      maturity,
      riskFlags,
      riskSignals,
      bands: {
        legend: bandsLegend,
        overall: overallBand,
        pillars: pillarBands,
      },
      reporting: {
        radar: radarPillars,
      },
      protectionExplanation,
      narrativeContext: {
        reference: {
          companyDescriptor,
          namingPolicy: "DO NOT USE COMPANY NAME",
        },
        businessContext: {
          industry: organization?.industry,
          contextNotes: organization?.context_notes,
          website: organization?.website,
          primaryPressures: organization?.primary_pressures,
          growthStage: organization?.growth_stage,
          size: organization?.size,
        },
        evidence: {
          freeTextResponses,
          participantNotes,
          participantOpportunityNotes: participantNotes.map((note) => ({ note })),
        },
      },
    },
  };
}
