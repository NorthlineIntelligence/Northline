import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import {
  cancelScheduledInvite,
  toClientInviteSchedule,
} from "@/lib/scheduledInvites";

const ParamsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const parsedParams = ParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ ok: false, error: "Invalid assessment id" }, { status: 400 });
  }

  const schedules = await prisma.assessmentInviteSchedule.findMany({
    where: { assessment_id: parsedParams.data.id },
    orderBy: [{ status: "asc" }, { scheduled_at_utc: "asc" }],
    take: 50,
  });

  return NextResponse.json({
    ok: true,
    schedules: schedules.map(toClientInviteSchedule),
  });
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const parsedParams = ParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ ok: false, error: "Invalid assessment id" }, { status: 400 });
  }

  const scheduleId = req.nextUrl.searchParams.get("scheduleId");
  if (!scheduleId) {
    return NextResponse.json({ ok: false, error: "scheduleId is required." }, { status: 400 });
  }

  const cancelled = await cancelScheduledInvite(scheduleId, parsedParams.data.id);
  if (!cancelled) {
    return NextResponse.json(
      { ok: false, error: "Scheduled invite not found or already processed." },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
