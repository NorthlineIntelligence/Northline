import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";
import {
  getPriceBookStorageBucket,
  getSupabaseServiceRole,
  isLikelySupabaseJwtApiKey,
  normalizeSupabaseSecret,
  serviceRoleKeyTroubleshootingHint,
} from "@/lib/supabaseServiceRole";
import { parsePriceBookFile, safeStorageFileName } from "@/lib/priceBookFileParse";

const MAX_BYTES = 8 * 1024 * 1024;

async function ensureBucket(supabase: NonNullable<ReturnType<typeof getSupabaseServiceRole>>, bucket: string) {
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) return { ok: false as const, message: listErr.message };
  if (buckets?.some((b) => b.name === bucket)) return { ok: true as const };
  const { error: createErr } = await supabase.storage.createBucket(bucket, {
    public: false,
  });
  if (createErr && !createErr.message?.toLowerCase().includes("already exists")) {
    return { ok: false as const, message: createErr.message };
  }
  return { ok: true as const };
}

function formatStorageSetupError(message: string): string {
  const hint = serviceRoleKeyTroubleshootingHint(message);
  if (hint) return `${message}. ${hint}`;
  return message;
}

export async function POST(req: NextRequest) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const rawKey = normalizeSupabaseSecret(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!rawKey) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Supabase service role is not configured. Set SUPABASE_SERVICE_ROLE_KEY in the server environment (same project as NEXT_PUBLIC_SUPABASE_URL).",
      },
      { status: 503 }
    );
  }
  if (!isLikelySupabaseJwtApiKey(rawKey)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "SUPABASE_SERVICE_ROLE_KEY does not look like a valid Supabase API JWT. Copy the **service_role** **secret** from Dashboard → Project Settings → API (long value with two dots), with no quotes or line breaks.",
      },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServiceRole();
  if (!supabase) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Could not create Supabase client. Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      },
      { status: 503 }
    );
  }

  const bucket = getPriceBookStorageBucket();
  const ensured = await ensureBucket(supabase, bucket);
  if (!ensured.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `Storage bucket setup failed: ${formatStorageSetupError(ensured.message ?? "unknown error")}`,
      },
      { status: 500 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Expected multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });
  }

  const label = String(form.get("label") ?? "").trim() || `Price book ${new Date().toISOString().slice(0, 10)}`;
  const notesRaw = String(form.get("notes") ?? "").trim();
  const setAsCurrent = form.get("set_as_current") !== "false";

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength === 0) {
    return NextResponse.json({ ok: false, error: "Empty file" }, { status: 400 });
  }
  if (buf.byteLength > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "File too large (max 8 MB)" }, { status: 400 });
  }

  const parse = parsePriceBookFile(buf, file.name, file.type || "application/octet-stream");
  let line_items = parse.line_items;
  let notes = notesRaw || null;
  if (parse.warnings.length > 0) {
    const w = parse.warnings.join("; ");
    notes = notes ? `${notes}\n\nParse: ${w}` : `Parse: ${w}`;
  }

  const folder = crypto.randomUUID();
  const objectPath = `${folder}/${safeStorageFileName(file.name)}`;

  const contentType = file.type?.trim() || "application/octet-stream";
  const { error: upErr } = await supabase.storage.from(bucket).upload(objectPath, buf, {
    contentType,
    upsert: false,
  });

  if (upErr) {
    const msg = upErr.message || "Upload to Supabase Storage failed";
    return NextResponse.json(
      { ok: false, error: formatStorageSetupError(msg) },
      { status: 500 }
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    if (setAsCurrent) {
      await tx.priceBook.updateMany({ data: { is_current: false } });
    }
    return tx.priceBook.create({
      data: {
        label,
        line_items: line_items as object,
        notes,
        source_filename: file.name,
        storage_bucket: bucket,
        storage_path: objectPath,
        mime_type: contentType,
        is_current: setAsCurrent,
      },
    });
  });

  return NextResponse.json(
    {
      ok: true,
      price_book: created,
      parse_warnings: parse.warnings,
    },
    { status: 201 }
  );
}
