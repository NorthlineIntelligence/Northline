import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";

const ParamsSchema = z.object({ id: z.string().uuid() });

const PostSchema = z.object({
  title: z.string().min(1).max(500),
  body_notes: z.string().max(20000).optional(),
  quote_id: z.string().uuid().optional(),
  status: z.string().max(80).optional(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }
  const orgId = parsed.data.id;

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } });
  if (!org) {
    return NextResponse.json({ ok: false, error: "Organization not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const data = PostSchema.safeParse(body);
  if (!data.success) {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const contract = await prisma.crmContract.create({
    data: {
      organization_id: orgId,
      title: data.data.title.trim(),
      body_notes: data.data.body_notes?.trim() || null,
      quote_id: data.data.quote_id ?? null,
      status: (data.data.status ?? "DRAFT").trim().slice(0, 80),
    },
  });

  return NextResponse.json({ ok: true, contract }, { status: 201 });
}
