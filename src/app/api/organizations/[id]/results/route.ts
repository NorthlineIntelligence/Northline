import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

const ParamsSchema = z.object({ id: z.string().uuid() });
type PillarKey = string;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Protective scoring rules (must match assessment endpoint behavior):
 * 1) If any pillar < 2.5 → cap overall at 3.4
 * 2) If any pillar < 2.0 → cap overall at 2.4
 * 3) If (maxPillar - minPillar) > 1.5 → subtract 0.3 from overall
 *
 * Order matters to match verified behavior:
 * - Apply caps first
 * - Then apply variance penalty
 */
function applyProtectiveRules(
  weightedAverageRaw: number | null,
  pillarAverages: Array<number | null>
) {
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

  const validPillars = pillarAverages.filter(
    (n): n is number => n !== null && !Number.isNaN(n)
  );

  const minPillar = validPillars.length ? Math.min(...validPillars) : null;
  const maxPillar = validPillars.length ? Math.max(...validPillars) : null;
  const variance =
    minPillar === null || maxPillar === null ? null : round2(maxPillar - minPillar);

  const anyPillarBelow25 = validPillars.some((n) => n < 2.5);
  const anyPillarBelow20 = validPillars.some((n) => n < 2.0);
  const varianceTriggered = variance !== null ? variance > 1.5 : false;

  let protectedScore = weightedAverageRaw;
  let capApplied: number | null = null;

  // Caps first (stronger cap wins)
  if (anyPillarBelow25) {
    protectedScore = Math.min(protectedScore, 3.4);
    capApplied = 3.4;
  }
  if (anyPillarBelow20) {
    protectedScore = Math.min(protectedScore, 2.4);
    capApplied = 2.4;
  }

  // Then variance penalty
  let variancePenaltyApplied = false;
  const variancePenaltyAmount = 0.3;
  if (varianceTriggered) {
    protectedScore = protectedScore - variancePenaltyAmount;
    variancePenaltyApplied = true;
  }

  // Safety clamp (keeps score in a sane range)
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

/**
 * Band classification using Northline brand colors (REVERSED per brand intent):
 * - Stabilize First: Grey Blue (#66819e)
 * - Proceed with Intention: Cyan (#34b0b4)
 * - Ready to Scale: Dark Blue (#173464)  <-- flagship end-state
 * - Unknown: Light Azure (#cdd8df)
 */
function classifyScore(score: number | null) {
  if (score === null || Number.isNaN(score)) {
    return {
      band: null,
      key: "unknown" as const,
      color: "#cdd8df", // Light Azure as neutral/unknown
    };
  }

  if (score <= 2.4) {
    return {
      band: "Stabilize First" as const,
      key: "stabilize" as const,
      color: "#66819e", // Grey Blue
    };
  }

  if (score <= 3.9) {
    return {
      band: "Proceed with Intention" as const,
      key: "proceed" as const,
      color: "#34b0b4", // Cyan
    };
  }

  return {
    band: "Ready to Scale" as const,
    key: "ready" as const,
    color: "#173464", // Dark Blue (flagship)
  };
}

const legend = {
  stabilize: { band: "Stabilize First", color: "#66819e" }, // Grey Blue
  proceed: { band: "Proceed with Intention", color: "#34b0b4" }, // Cyan
  ready: { band: "Ready to Scale", color: "#173464" }, // Dark Blue
  unknown: { band: null, color: "#cdd8df" }, // Light Azure
};

const PILLAR_LABELS: Record<string, string> = {
  SYSTEM_INTEGRITY: "System Integrity",
  HUMAN_ALIGNMENT: "Human Alignment",
  STRATEGIC_COHERENCE: "Strategic Coherence",
  SUSTAINABILITY_PRACTICE: "Sustainability Practice",
};

const PILLAR_ORDER: string[] = [
  "STRATEGIC_COHERENCE",
  "SYSTEM_INTEGRITY",
  "HUMAN_ALIGNMENT",
  "SUSTAINABILITY_PRACTICE",
];

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

async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // ignore
        }
      },
    },
  });
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // --- AUTH (authentication) ---
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      return NextResponse.json(
        { error: "Unauthorized", message: userError.message },
        { status: 401 }
      );
    }

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // --- Validate params ---
    const params = await context.params;
    const parsed = ParamsSchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid organization id (UUID)" },
        { status: 400 }
      );
    }

    const organizationId = parsed.data.id;

    // --- AUTHZ (authorization): enforce org membership ---
    const membership = await prisma.participant.findFirst({
      where: {
        user_id: user.id,
        Assessment: {
          organization_id: organizationId,
        },
      },
      select: { id: true },
    });

    if (!membership) {
      return NextResponse.json(
        { error: "Forbidden", message: "You do not have access to this organization." },
        { status: 403 }
      );
    }
    // --- END AUTHZ ---

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        industry: true,
        size: true,
        growth_stage: true,
        primary_pressures: true,
        created_at: true,
      },
    });

    if (!organization) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    // Questions that define the dataset (same as assessment endpoint)
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

    // All assessments for org
    const assessments = await prisma.assessment.findMany({
      where: { organization_id: organizationId },
      select: { id: true },
    });
    const assessmentIds = assessments.map((a) => a.id);

    const assessmentCount = assessmentIds.length;

    // Participants across those assessments
    const participants =
      assessmentIds.length === 0
        ? []
        : await prisma.participant.findMany({
            where: { assessment_id: { in: assessmentIds } },
            select: { id: true },
          });

    const participantIds = participants.map((p) => p.id);
    const participantCount = participantIds.length;

    // Responses across those assessments
    const responses =
      assessmentIds.length === 0
        ? []
        : await prisma.response.findMany({
            where: { assessment_id: { in: assessmentIds } },
            select: { participant_id: true, question_id: true, score: true },
          });

    // Initialize per-pillar rollup
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
        possibleResponses: count * participantCount,
        totalQuestions: count,
      };
    }

    // Sums for weighted averages
    const sumScoreWeightByPillar: Record<PillarKey, number> = {};
    const sumWeightByPillar: Record<PillarKey, number> = {};
    let overallScoreWeightSum = 0;
    let overallWeightSum = 0;

    let overallAnsweredResponses = 0;
    const answeredResponsesByPillar: Record<PillarKey, number> = {};
    const responsesCountByParticipant = new Map<string, number>();

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

      responsesCountByParticipant.set(
        r.participant_id,
        (responsesCountByParticipant.get(r.participant_id) || 0) + 1
      );
    }

    for (const pillarKey of Object.keys(pillars)) {
      const weightSum = sumWeightByPillar[pillarKey] || 0;
      const scoreWeightSum = sumScoreWeightByPillar[pillarKey] || 0;

      const answered = answeredResponsesByPillar[pillarKey] || 0;
      const possible = pillars[pillarKey].possibleResponses;

      pillars[pillarKey].answeredResponses = answered;
      pillars[pillarKey].weightedAverage =
        weightSum === 0 ? null : round2(scoreWeightSum / weightSum);

      const coveragePct = possible === 0 ? 0 : round2((answered / possible) * 100);

      pillars[pillarKey].datasetCoveragePct = coveragePct;
      pillars[pillarKey].avgParticipantCompletionPct = coveragePct;
    }

    const overallWeightedAverageRaw =
      overallWeightSum === 0 ? null : round2(overallScoreWeightSum / overallWeightSum);

    const overallPossibleResponses = totalQuestions * participantCount;
    const overallCoveragePct =
      overallPossibleResponses === 0
        ? 0
        : round2((overallAnsweredResponses / overallPossibleResponses) * 100);

    // Overall avg participant completion % (true average across participants)
    let avgParticipantCompletionPct = 0;
    if (participantCount > 0 && totalQuestions > 0) {
      let sumPct = 0;
      for (const pid of participantIds) {
        const answered = responsesCountByParticipant.get(pid) || 0;
        sumPct += (answered / totalQuestions) * 100;
      }
      avgParticipantCompletionPct = round2(sumPct / participantCount);
    }

    // Apply protective rules using pillar weighted averages
    const pillarAveragesForProtection = Object.values(pillars).map(
      (p) => p.weightedAverage
    );

    const protectedOverall = applyProtectiveRules(
      overallWeightedAverageRaw,
      pillarAveragesForProtection
    );

    // Bands (also doubles as threshold classification)
    const pillarBands: Record<PillarKey, { band: string | null; key: string; color: string }> =
      {};
    for (const [pillarKey, pillarObj] of Object.entries(pillars)) {
      pillarBands[pillarKey] = classifyScore(pillarObj.weightedAverage);
    }

    // IMPORTANT: overall band uses protected score
    const overallBand = classifyScore(protectedOverall.weightedAverage);

    // --- Radar reporting structure (frontend-friendly) ---
    const presentPillars = Object.keys(pillars);

    const orderedPillarKeys = [
      ...PILLAR_ORDER.filter((k) => presentPillars.includes(k)),
      ...presentPillars
        .filter((k) => !PILLAR_ORDER.includes(k))
        .sort((a, b) => a.localeCompare(b)),
    ];

    const radarPillars = orderedPillarKeys.map((pillarKey) => {
      const score = pillars[pillarKey]?.weightedAverage ?? null;
      const band = pillarBands[pillarKey] ?? classifyScore(score);
      return {
        key: pillarKey,
        label: formatPillarLabel(pillarKey),
        score,
        band: band.band,
        bandKey: band.key,
        color: band.color,
      };
    });

    const radarOverall = {
      key: "OVERALL",
      label: "Overall",
      score: protectedOverall.weightedAverage,
      band: overallBand.band,
      bandKey: overallBand.key,
      color: overallBand.color,
    };

    const radarData = radarPillars.map((p) => ({
      key: p.key,
      label: p.label,
      value: p.score,
    }));
    // --- End radar reporting structure ---

    // --- Threshold indicators (explicit block) ---
    // These intentionally duplicate "bands" in a frontend-friendly location under "reporting".
    const thresholdsPillars: Record<
      PillarKey,
      { key: string; label: string | null; color: string }
    > = {};
    for (const [pillarKey, bandObj] of Object.entries(pillarBands)) {
      thresholdsPillars[pillarKey] = {
        key: bandObj.key,
        label: bandObj.band,
        color: bandObj.color,
      };
    }

    const thresholdsOverall = {
      key: overallBand.key,
      label: overallBand.band,
      color: overallBand.color,
    };
    // --- End threshold indicators ---

    return NextResponse.json({
      organization,
      meta: {
        totalQuestions,
        totalQuestionsByPillar,
        assessmentCount,
        participantCount,
        responseCount: responses.length,
      },
      aggregate: {
        overall: {
          weightedAverageRaw: protectedOverall.weightedAverageRaw,
          weightedAverage: protectedOverall.weightedAverage,
          protectiveRules: protectedOverall.protectiveRules,
          protectionExplanation: protectedOverall.protectionExplanation,

          datasetCoveragePct: overallCoveragePct,
          avgParticipantCompletionPct,
          answeredResponses: overallAnsweredResponses,
          possibleResponses: overallPossibleResponses,
        },
        pillars,
      },
      bands: {
        legend,
        overall: overallBand,
        pillars: pillarBands,
      },
      reporting: {
        radar: {
          overall: radarOverall,
          pillars: radarPillars,
          data: radarData,
        },
        thresholds: {
          legend,
          overall: thresholdsOverall,
          pillars: thresholdsPillars,
        },
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Internal Server Error", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}