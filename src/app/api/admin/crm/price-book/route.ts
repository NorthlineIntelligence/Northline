import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";

const LineItemSchema = z.object({
  sku: z.string().min(1).max(120),
  description: z.string().max(2000),
  unit: z.string().max(80).default("unit"),
  unit_price_cents: z.number().int().min(0),
});

const PostSchema = z.object({
  label: z.string().min(1).max(400),
  line_items: z.array(LineItemSchema).default([]),
  notes: z.string().max(8000).optional(),
  source_filename: z.string().max(400).optional(),
  set_as_current: z.boolean().default(true),
});

export async function GET() {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const books = await prisma.priceBook.findMany({
    orderBy: [{ is_current: "desc" }, { created_at: "desc" }],
    take: 40,
  });

  return NextResponse.json({ ok: true, price_books: books });
}

export async function POST(req: NextRequest) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const lines = parsed.data.line_items.map((l) => ({
    sku: l.sku.trim(),
    description: l.description.trim(),
    unit: l.unit.trim() || "unit",
    unit_price_cents: l.unit_price_cents,
  }));

  const created = await prisma.$transaction(async (tx) => {
    if (parsed.data.set_as_current) {
      await tx.priceBook.updateMany({ data: { is_current: false } });
    }
    return tx.priceBook.create({
      data: {
        label: parsed.data.label.trim(),
        line_items: lines as object,
        notes: parsed.data.notes?.trim() || null,
        source_filename: parsed.data.source_filename?.trim() || null,
        is_current: parsed.data.set_as_current,
      },
    });
  });

  return NextResponse.json({ ok: true, price_book: created }, { status: 201 });
}
