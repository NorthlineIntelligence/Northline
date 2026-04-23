import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";

const ParamsSchema = z.object({
  id: z.string().uuid(),
  sprintId: z.string().uuid(),
});

const PatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(["NOT_STARTED", "ON_TIME", "DELAYED", "OVERDUE", "COMPLETED"]).optional(),
  completion_pct: z.number().int().min(0).max(100).optional(),
  stage_label: z.union([z.string().max(200), z.null()]).optional(),
  cost_band: z.union([z.string().max(200), z.null()]).optional(),
  scope_summary: z.union([z.string().max(20000), z.null()]).optional(),
  estimated_duration_value: z.number().positive().max(10000).optional(),
  estimated_duration_unit: z.union([z.string().max(40), z.null()]).optional(),
  estimated_completion_date: z.union([z.string().datetime(), z.null()]).optional(),
  notes: z.union([z.string().max(12000), z.null()]).optional(),
  target_start_at: z.union([z.string().datetime(), z.null()]).optional(),
  target_end_at: z.union([z.string().datetime(), z.null()]).optional(),
});

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; sprintId: string }> }
) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;
  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid ids" }, { status: 400 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const patch = PatchSchema.safeParse(body);
  if (!patch.success) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });

  const sprint = await prisma.pmSprint.findFirst({
    where: { id: parsed.data.sprintId, project_id: parsed.data.id },
    select: { id: true },
  });
  if (!sprint) return NextResponse.json({ ok: false, error: "Sprint not found" }, { status: 404 });

  const updated = await prisma.pmSprint.update({
    where: { id: parsed.data.sprintId },
    data: {
      ...patch.data,
      ...(patch.data.target_start_at !== undefined
        ? { target_start_at: patch.data.target_start_at ? new Date(patch.data.target_start_at) : null }
        : {}),
      ...(patch.data.target_end_at !== undefined
        ? { target_end_at: patch.data.target_end_at ? new Date(patch.data.target_end_at) : null }
        : {}),
      ...(patch.data.estimated_completion_date !== undefined
        ? {
            estimated_completion_date: patch.data.estimated_completion_date
              ? new Date(patch.data.estimated_completion_date)
              : null,
          }
        : {}),
    },
  });

  const sprints = await prisma.pmSprint.findMany({
    where: { project_id: parsed.data.id },
    select: { completion_pct: true, target_start_at: true, target_end_at: true, estimated_completion_date: true },
  });
  const completion =
    sprints.length > 0
      ? Math.round(sprints.reduce((sum, s) => sum + (s.completion_pct ?? 0), 0) / sprints.length)
      : 0;
  await prisma.pmProject.update({
    where: { id: parsed.data.id },
    data: {
      completion_pct: completion,
      target_start_at:
        sprints
          .map((s) => s.target_start_at)
          .filter((d): d is Date => d instanceof Date)
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
      target_end_at:
        sprints
          .map((s) => s.target_end_at ?? s.estimated_completion_date)
          .filter((d): d is Date => d instanceof Date)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
    },
  });

  return NextResponse.json({ ok: true, sprint: updated, project_completion_pct: completion });
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string; sprintId: string }> }
) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;
  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid ids" }, { status: 400 });

  const sprint = await prisma.pmSprint.findFirst({
    where: { id: parsed.data.sprintId, project_id: parsed.data.id },
    select: { id: true },
  });
  if (!sprint) return NextResponse.json({ ok: false, error: "Sprint not found" }, { status: 404 });

  await prisma.pmSprint.delete({ where: { id: parsed.data.sprintId } });

  const sprints = await prisma.pmSprint.findMany({
    where: { project_id: parsed.data.id },
    select: { completion_pct: true, target_start_at: true, target_end_at: true, estimated_completion_date: true },
  });
  const completion =
    sprints.length > 0
      ? Math.round(sprints.reduce((sum, s) => sum + (s.completion_pct ?? 0), 0) / sprints.length)
      : 0;
  await prisma.pmProject.update({
    where: { id: parsed.data.id },
    data: {
      completion_pct: completion,
      target_start_at:
        sprints
          .map((s) => s.target_start_at)
          .filter((d): d is Date => d instanceof Date)
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
      target_end_at:
        sprints
          .map((s) => s.target_end_at ?? s.estimated_completion_date)
          .filter((d): d is Date => d instanceof Date)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
    },
  });

  return NextResponse.json({ ok: true, project_completion_pct: completion });
}

