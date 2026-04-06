import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";

const ParamsSchema = z.object({ id: z.string().uuid() });

const PostSchema = z.object({
  name: z.string().min(1).max(400),
  email: z.union([z.string().email().max(400), z.literal("")]).optional(),
  phone: z.string().max(80).optional(),
  title: z.string().max(400).optional(),
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

  const contact = await prisma.orgContact.create({
    data: {
      organization_id: orgId,
      name: data.data.name.trim(),
      email: data.data.email && data.data.email !== "" ? data.data.email.trim() : null,
      phone: data.data.phone?.trim() || null,
      title: data.data.title?.trim() || null,
    },
  });

  return NextResponse.json({ ok: true, contact }, { status: 201 });
}
