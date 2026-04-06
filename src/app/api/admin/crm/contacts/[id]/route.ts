import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";

const ParamsSchema = z.object({ id: z.string().uuid() });

const PatchSchema = z.object({
  name: z.string().min(1).max(400).optional(),
  email: z.union([z.string().email().max(400), z.literal(""), z.null()]).optional(),
  phone: z.union([z.string().max(80), z.literal(""), z.null()]).optional(),
  title: z.union([z.string().max(400), z.literal(""), z.null()]).optional(),
  is_archived: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }
  const contactId = parsed.data.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const patch = PatchSchema.safeParse(body);
  if (!patch.success) {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const existing = await prisma.orgContact.findUnique({ where: { id: contactId } });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const data: Parameters<typeof prisma.orgContact.update>[0]["data"] = {};
  if (patch.data.name !== undefined) data.name = patch.data.name.trim();
  if (patch.data.email !== undefined) {
    data.email =
      patch.data.email === null || patch.data.email === "" ? null : patch.data.email.trim();
  }
  if (patch.data.phone !== undefined) {
    data.phone =
      patch.data.phone === null || patch.data.phone === "" ? null : patch.data.phone.trim();
  }
  if (patch.data.title !== undefined) {
    data.title =
      patch.data.title === null || patch.data.title === "" ? null : patch.data.title.trim();
  }
  if (patch.data.is_archived !== undefined) data.is_archived = patch.data.is_archived;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, error: "No updates" }, { status: 400 });
  }

  const contact = await prisma.orgContact.update({
    where: { id: contactId },
    data,
  });

  return NextResponse.json({ ok: true, contact });
}
