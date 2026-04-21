import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";
import { getPriceBookStorageBucket, getSupabaseServiceRole } from "@/lib/supabaseServiceRole";

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

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const id = parsed.data.id;
  const existing = await prisma.priceBook.findUnique({
    where: { id },
    select: {
      id: true,
      is_current: true,
      storage_bucket: true,
      storage_path: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const remainingCount = await prisma.priceBook.count({
    where: { id: { not: id } },
  });
  if (remainingCount === 0) {
    return NextResponse.json(
      { ok: false, error: "Cannot delete the only price book. Upload another version first." },
      { status: 400 }
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.priceBook.delete({ where: { id } });
    if (existing.is_current) {
      const fallback = await tx.priceBook.findFirst({
        orderBy: { created_at: "desc" },
        select: { id: true },
      });
      if (fallback) {
        await tx.priceBook.update({
          where: { id: fallback.id },
          data: { is_current: true },
        });
      }
    }
    return { deletedId: id };
  });

  if (existing.storage_path) {
    const supabase = getSupabaseServiceRole();
    if (supabase) {
      const bucket = existing.storage_bucket?.trim() || getPriceBookStorageBucket();
      await supabase.storage.from(bucket).remove([existing.storage_path]);
    }
  }

  return NextResponse.json({ ok: true, ...result });
}
