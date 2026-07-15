import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdminEmail } from "@/lib/admin";
import { ASSESSMENTS_IN_PROGRESS_MESSAGE } from "@/lib/assessmentParticipantMessages";
import { getReportingParticipantCompletionStats } from "@/lib/assessmentParticipantCompletion";
import {
  authorizeExecutiveInsightsParticipant,
  getSupabaseServerClient,
  markInviteAccepted,
} from "@/lib/assessmentRouteAuth";
import {
  getLatestPriorityAnalysis,
  getOrGeneratePriorityAnalysis,
  toClientPriorityAnalysis,
} from "@/lib/priorityDiscovery/analysisPersistence";

const ParamsSchema = z.object({ id: z.string().uuid() });

async function assertExecutiveInsightsAccess(req: NextRequest, assessmentId: string) {
  const auth = await authorizeExecutiveInsightsParticipant(req, assessmentId);
  if (!auth.ok) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  }

  if (auth.auth === "invite" && auth.participantId) {
    await markInviteAccepted(auth.participantId);
  }

  if (auth.auth === "session") {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.email && !isAdminEmail(user.email)) {
      // session path already validated participant + visibility flag
    }
  }

  return { ok: true as const, auth };
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const parsedParams = ParamsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return NextResponse.json({ ok: false, error: "Invalid assessment id" }, { status: 400 });
  }

  const assessmentId = parsedParams.data.id;
  const access = await assertExecutiveInsightsAccess(req, assessmentId);
  if (!access.ok) return access.response;

  const completion = await getReportingParticipantCompletionStats(assessmentId);
  const analysis = await getLatestPriorityAnalysis(assessmentId);

  return NextResponse.json({
    ok: true,
    completion,
    analysis: analysis ? toClientPriorityAnalysis(analysis) : null,
  });
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const parsedParams = ParamsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return NextResponse.json({ ok: false, error: "Invalid assessment id" }, { status: 400 });
  }

  const assessmentId = parsedParams.data.id;
  const access = await assertExecutiveInsightsAccess(req, assessmentId);
  if (!access.ok) return access.response;

  const completion = await getReportingParticipantCompletionStats(assessmentId);
  if (!completion.all_participants_completed) {
    return NextResponse.json(
      { ok: false, error: ASSESSMENTS_IN_PROGRESS_MESSAGE },
      { status: 409 }
    );
  }

  try {
    const result = await getOrGeneratePriorityAnalysis({ assessmentId });
    return NextResponse.json(
      {
        ok: true,
        cached: result.cached,
        analysis: toClientPriorityAnalysis(result.analysis),
        modelUsed: result.modelUsed,
        modeUsed: result.modeUsed,
        providerUsed: result.providerUsed,
        warnings: result.warnings,
      },
      { status: result.cached ? 200 : 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
