import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";

const ParamsSchema = z.object({ id: z.string().uuid() });
const PatchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  status: z.enum(["PLANNED", "ACTIVE", "AT_RISK", "DELAYED", "OVERDUE", "COMPLETED"]).optional(),
  internal_notes: z.union([z.string().max(20000), z.null()]).optional(),
  customer_summary: z.union([z.string().max(12000), z.null()]).optional(),
  target_start_at: z.union([z.string().datetime(), z.null()]).optional(),
  target_end_at: z.union([z.string().datetime(), z.null()]).optional(),
});

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;
  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });

  const project = await prisma.pmProject.findUnique({
    where: { id: parsed.data.id },
    include: {
      sprints: {
        orderBy: { sprint_number: "asc" },
        include: {
          updates: { orderBy: { created_at: "desc" }, take: 10 },
        },
      },
    },
  });
  if (!project) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, project });
}

export async function PATCH(
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
  const patch = PatchSchema.safeParse(body);
  if (!patch.success) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });

  const updated = await prisma.pmProject.update({
    where: { id: parsed.data.id },
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
  return NextResponse.json({ ok: true, project: updated });
}

