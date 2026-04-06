import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";

const ParamsSchema = z.object({ id: z.string().uuid() });

const PatchSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  amount_cents: z.number().int().min(0).optional(),
  status: z.string().max(80).optional(),
  due_date: z.union([z.string().datetime(), z.null()]).optional(),
  notes: z.union([z.string().max(20000), z.null()]).optional(),
  quote_id: z.union([z.string().uuid(), z.null()]).optional(),
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

  const data: Parameters<typeof prisma.crmInvoice.update>[0]["data"] = {};
  if (patch.data.title !== undefined) data.title = patch.data.title.trim();
  if (patch.data.amount_cents !== undefined) data.amount_cents = patch.data.amount_cents;
  if (patch.data.status !== undefined) data.status = patch.data.status.trim().slice(0, 80);
  if (patch.data.due_date !== undefined) {
    data.due_date = patch.data.due_date === null ? null : new Date(patch.data.due_date);
  }
  if (patch.data.notes !== undefined) data.notes = patch.data.notes;
  if (patch.data.quote_id !== undefined) data.quote_id = patch.data.quote_id;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, error: "No updates" }, { status: 400 });
  }

  const invoice = await prisma.crmInvoice.update({
    where: { id: parsed.data.id },
    data,
  });

  return NextResponse.json({ ok: true, invoice });
}
