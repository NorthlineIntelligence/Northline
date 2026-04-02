import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isAdminEmail } from "@/lib/admin";
import {
  authorizeParticipantOrInvite,
  getSupabaseServerClient,
  allParticipantsCompleted,
} from "@/lib/assessmentRouteAuth";

const ParamsSchema = z.object({ id: z.string().uuid() });

function unauthorized(message?: string) {
  return NextResponse.json(
    { ok: false, error: "Unauthorized", message: message ?? "Auth session missing!" },
    { status: 401 }
  );
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const params = await context.params;
    const parsed = ParamsSchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid assessment id (UUID)" }, { status: 400 });
    }
    const assessmentId = parsed.data.id;

    const auth = await authorizeParticipantOrInvite(req, assessmentId);
    if (!auth.ok) return unauthorized();

    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        organization: {
          select: { show_project_scope_review: true },
        },
      },
    });

    const enabled = Boolean(assessment?.organization?.show_project_scope_review);
    let adminBypass = false;
    if (!enabled) {
      const supabase = await getSupabaseServerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      adminBypass = isAdminEmail(user?.email ?? null);
      if (!adminBypass) {
        return NextResponse.json(
          { ok: false, error: "Project scope review is not enabled for this organization." },
          { status: 403 }
        );
      }
    }

    const completion = await allParticipantsCompleted(assessmentId);
    if (!completion.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "All participants have not completed the assessment. Please check back once the administrator confirms completion.",
          meta: { total: completion.total, completed: completion.completed },
        },
        { status: 409 }
      );
    }

    const latest = await prisma.assessmentProjectScope.findFirst({
      where: { assessment_id: assessmentId },
      orderBy: [{ version: "desc" }],
    });

    return NextResponse.json(
      {
        ok: true,
        scope: latest,
        feature_enabled: enabled || adminBypass,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("GET project-scope error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error.", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
