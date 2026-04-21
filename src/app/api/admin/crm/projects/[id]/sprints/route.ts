import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";

const ParamsSchema = z.object({ id: z.string().uuid() });
const PostSchema = z.object({
  title: z.string().min(1).max(200),
  cost_band: z.union([z.string().max(200), z.null()]).optional(),
  scope_summary: z.union([z.string().max(20000), z.null()]).optional(),
  estimated_duration_value: z.number().positive().max(10000).optional(),
  estimated_duration_unit: z.union([z.string().max(40), z.null()]).optional(),
  estimated_completion_date: z.union([z.string().datetime(), z.null()]).optional(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;
  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const input = PostSchema.safeParse(body);
  if (!input.success) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });

  const project = await prisma.pmProject.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, target_start_at: true },
  });
  if (!project) return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });

  const maxSprint = await prisma.pmSprint.aggregate({
    where: { project_id: parsed.data.id },
    _max: { sprint_number: true },
  });
  const sprintNumber = (maxSprint._max.sprint_number ?? 0) + 1;
  const estimatedCompletionDate = input.data.estimated_completion_date
    ? new Date(input.data.estimated_completion_date)
    : null;

  const sprint = await prisma.pmSprint.create({
    data: {
      project_id: parsed.data.id,
      sprint_number: sprintNumber,
      title: input.data.title,
      stage_label: `Scope ${sprintNumber}`,
      status: "NOT_STARTED",
      completion_pct: 0,
      cost_band: input.data.cost_band ?? null,
      scope_summary: input.data.scope_summary ?? null,
      estimated_duration_value: input.data.estimated_duration_value ?? 2,
      estimated_duration_unit: input.data.estimated_duration_unit ?? "weeks",
      estimated_completion_date: estimatedCompletionDate,
      target_start_at: project.target_start_at ?? null,
      target_end_at: estimatedCompletionDate,
    },
  });

  return NextResponse.json({ ok: true, sprint }, { status: 201 });
}

