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
 * Band classification using Northline brand colors (PARITY with Org Results endpoint).
 * Brand color mapping (reversed):
 * - stabilize => #66819e (Grey Blue)
 * - proceed   => #34b0b4 (Cyan)
 * - ready     => #173464 (Dark Blue flagship)
 * - unknown   => #cdd8df (Light Azure)
 *
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
      color: "#cdd8df", // Light Azure for unknown
    };
  }

  if (score <= 2.4) {
    return {
      band: "Stabilize First" as const,
      key: "stabilize" as const,
      color: "#66819e", // Grey Blue
    };
  }

  if (score <= 3.4) {
    return {
      band: "Proceed with Intention" as const,
      key: "proceed" as const,
      color: "#34b0b4", // Cyan
    };
  }

  return {
    band: "Ready to Scale" as const,
    key: "ready" as const,
    color: "#173464", // Dark Blue flagship
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
    // --- AUTH GATE (Phase 4 pt 2) ---
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

    // TODO (future add-on, required before production):
    // Authorization + identity verification:
    // - Add Participant.user_id referencing supabase auth user.id
    // - Enforce participant.user_id === user.id for assessment access
    // - Additionally enforce org/assessment ownership (user belongs to org)
    // --- END AUTH GATE ---

    const params = await context.params;
    const parsed = ParamsSchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid assessment id (UUID)" },
        { status: 400 }
      );
    }

    const assessmentId = parsed.data.id;

    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        organization_id: true,
        type: true,
        status: true,
        created_at: true,
      },
    });

    if (!assessment) {
      return NextResponse.json(
        { error: "Assessment not found" },
        { status: 404 }
      );
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
      overallWeightSum === 0
        ? null
        : round2(overallScoreWeightSum / overallWeightSum);

    const overallPossibleResponses = totalQuestions;
    const overallCoveragePct =
      overallPossibleResponses === 0
        ? 0
        : round2((overallAnsweredResponses / overallPossibleResponses) * 100);

    // Bands
    const pillarBands: Record<
      PillarKey,
      { band: string | null; key: string; color: string }
    > = {};
    for (const [pillarKey, pillarObj] of Object.entries(pillars)) {
      pillarBands[pillarKey] = classifyScore(pillarObj.weightedAverage);
    }
    const overallBand = classifyScore(overallWeightedAverage);

    // Reporting (PARITY)
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

    return NextResponse.json({
      assessment,
      participantId,
      meta: {
        totalQuestions,
        totalQuestionsByPillar,
        responseCount: responses.length,
      },
      aggregate: {
        overall: {
          weightedAverage: overallWeightedAverage,
          datasetCoveragePct: overallCoveragePct,
          avgParticipantCompletionPct: overallCoveragePct,
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
        radar,
        thresholds: reportingThresholds,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Internal Server Error", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}