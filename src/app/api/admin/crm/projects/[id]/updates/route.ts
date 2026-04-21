import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";

const ParamsSchema = z.object({ id: z.string().uuid() });
const PostSchema = z.object({
  sprint_id: z.string().uuid(),
  status_label: z.string().min(1).max(100),
  why_text: z.string().max(6000).optional(),
  is_customer_visible: z.boolean().optional().default(false),
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

  const sprint = await prisma.pmSprint.findFirst({
    where: { id: input.data.sprint_id, project_id: parsed.data.id },
    select: { id: true },
  });
  if (!sprint) return NextResponse.json({ ok: false, error: "Sprint not found" }, { status: 404 });

  const update = await prisma.pmSprintUpdate.create({
    data: {
      sprint_id: input.data.sprint_id,
      status_label: input.data.status_label,
      why_text: input.data.why_text ?? null,
      is_customer_visible: input.data.is_customer_visible ?? false,
      author_email: auth.email,
    },
  });
  return NextResponse.json({ ok: true, update }, { status: 201 });
}

