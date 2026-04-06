import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";
import { getPriceBookStorageBucket, getSupabaseServiceRole } from "@/lib/supabaseServiceRole";

const ParamsSchema = z.object({ id: z.string().uuid() });

/**
 * Redirects to a short-lived signed URL for the stored price book file (admin only).
 */
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const book = await prisma.priceBook.findUnique({
    where: { id: parsed.data.id },
    select: { storage_bucket: true, storage_path: true, source_filename: true },
  });

  if (!book?.storage_path) {
    return NextResponse.json({ ok: false, error: "No file stored for this price book" }, { status: 404 });
  }

  const supabase = getSupabaseServiceRole();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not configured" },
      { status: 503 }
    );
  }

  const bucket = book.storage_bucket?.trim() || getPriceBookStorageBucket();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(book.storage_path, 600);

  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Could not create download link" },
      { status: 500 }
    );
  }

  return NextResponse.redirect(data.signedUrl);
}
