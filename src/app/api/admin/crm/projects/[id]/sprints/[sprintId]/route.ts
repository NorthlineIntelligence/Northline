import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";

const ParamsSchema = z.object({
  id: z.string().uuid(),
  sprintId: z.string().uuid(),
});

const PatchSchema = z.object({
  status: z.enum(["NOT_STARTED", "ON_TIME", "DELAYED", "OVERDUE", "COMPLETED"]).optional(),
  completion_pct: z.number().int().min(0).max(100).optional(),
  stage_label: z.union([z.string().max(200), z.null()]).optional(),
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
    },
  });

  const sprints = await prisma.pmSprint.findMany({
    where: { project_id: parsed.data.id },
    select: { completion_pct: true },
  });
  const completion =
    sprints.length > 0
      ? Math.round(sprints.reduce((sum, s) => sum + (s.completion_pct ?? 0), 0) / sprints.length)
      : 0;
  await prisma.pmProject.update({
    where: { id: parsed.data.id },
    data: { completion_pct: completion },
  });

  return NextResponse.json({ ok: true, sprint: updated, project_completion_pct: completion });
}

