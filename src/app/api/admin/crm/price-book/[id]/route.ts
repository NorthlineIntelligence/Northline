import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";

const ParamsSchema = z.object({ id: z.string().uuid() });

export async function PATCH(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.priceBook.updateMany({ data: { is_current: false } });
    return tx.priceBook.update({
      where: { id: parsed.data.id },
      data: { is_current: true },
    });
  });

  return NextResponse.json({ ok: true, price_book: updated });
}
