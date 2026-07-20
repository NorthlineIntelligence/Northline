import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { getReportingParticipantCompletionStats } from "@/lib/assessmentParticipantCompletion";
import {
  getLatestPriorityAnalysis,
  getOrGeneratePriorityAnalysis,
} from "@/lib/priorityDiscovery/analysisPersistence";
import { generatePriorityDiscoveryRoadmaps } from "@/lib/priorityDiscovery/generateRoadmaps";
import { persistPriorityDiscoveryRoadmaps } from "@/lib/priorityDiscovery/persistRoadmapsToPm";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const bundle = await prisma.priorityDiscoveryRoadmapBundle.findFirst({
    where: { assessment_id: id },
    orderBy: { created_at: "desc" },
  });

  if (!bundle) {
    return NextResponse.json({ ok: true, bundle: null });
  }

  return NextResponse.json({
    ok: true,
    bundle: {
      id: bundle.id,
      assessmentId: bundle.assessment_id,
      organizationId: bundle.organization_id,
      priorityAnalysisId: bundle.priority_analysis_id,
      aiModelUsed: bundle.ai_model_used,
      roadmaps: bundle.roadmaps_json,
      pmProjectIds: bundle.pm_project_ids_json,
      createdAt: bundle.created_at.toISOString(),
    },
  });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const force = req.nextUrl.searchParams.get("force") === "1";

  const assessment = await prisma.assessment.findUnique({
    where: { id },
    select: { id: true, assessment_type: true, organization_id: true },
  });
  if (!assessment || assessment.assessment_type !== "PRIORITY_DISCOVERY") {
    return NextResponse.json({ ok: false, error: "Priority Discovery assessment not found" }, { status: 404 });
  }

  const completion = await getReportingParticipantCompletionStats(id);
  if (!completion.all_participants_completed) {
    return NextResponse.json(
      {
        ok: false,
        error: "Assessment must be complete before generating PM roadmaps.",
        completion,
      },
      { status: 409 }
    );
  }

  if (!force) {
    const existing = await prisma.priorityDiscoveryRoadmapBundle.findFirst({
      where: { assessment_id: id },
      orderBy: { created_at: "desc" },
    });
    if (existing) {
      return NextResponse.json({
        ok: true,
        cached: true,
        bundle: {
          id: existing.id,
          assessmentId: existing.assessment_id,
          organizationId: existing.organization_id,
          priorityAnalysisId: existing.priority_analysis_id,
          aiModelUsed: existing.ai_model_used,
          roadmaps: existing.roadmaps_json,
          pmProjectIds: existing.pm_project_ids_json,
          createdAt: existing.created_at.toISOString(),
        },
      });
    }
  }

  let analysis = await getLatestPriorityAnalysis(id);
  if (!analysis) {
    try {
      const generated = await getOrGeneratePriorityAnalysis({ assessmentId: id });
      analysis = generated.analysis;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }
  }

  try {
    const result = await generatePriorityDiscoveryRoadmaps({
      assessmentId: id,
      analysis,
    });

    const persisted = await persistPriorityDiscoveryRoadmaps({
      assessmentId: id,
      organizationId: assessment.organization_id,
      priorityAnalysisId: analysis.id,
      bundle: result.output,
      aiModelUsed: result.modelUsed,
      replaceExisting: force,
    });

    return NextResponse.json({
      ok: true,
      cached: false,
      modelUsed: result.modelUsed,
      warnings: result.warnings,
      bundle: {
        id: persisted.bundle.id,
        assessmentId: persisted.bundle.assessment_id,
        organizationId: persisted.bundle.organization_id,
        priorityAnalysisId: persisted.bundle.priority_analysis_id,
        aiModelUsed: persisted.bundle.ai_model_used,
        roadmaps: persisted.bundle.roadmaps_json,
        pmProjectIds: persisted.pmProjectIds,
        createdAt: persisted.bundle.created_at.toISOString(),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
