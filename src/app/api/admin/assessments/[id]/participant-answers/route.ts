import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/authz";
import { loadAllAssessmentParticipantResponses } from "@/lib/assessmentParticipantResponses";

const ParamsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const payload = await loadAllAssessmentParticipantResponses(parsed.data.id);
  if (!payload) {
    return NextResponse.json({ ok: false, error: "Assessment not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    assessment: payload.assessment,
    participants: payload.participants.map(({ participant, responses }) => ({
      participant: {
        ...participant,
        completed_at: participant.completed_at?.toISOString() ?? null,
        created_at: participant.created_at.toISOString(),
      },
      responses,
    })),
  });
}
