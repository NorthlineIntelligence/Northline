import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";

export const runtime = "nodejs";

const MAX_LOGO_BYTES = 1024 * 1024; // 1MB
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);

export async function GET() {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;
  const row = await prisma.appBranding.findUnique({ where: { id: "default" } });
  return NextResponse.json({
    ok: true,
    logo_data_url: row?.logo_data_url ?? null,
    logo_mime_type: row?.logo_mime_type ?? null,
    quote_from_name: row?.quote_from_name ?? null,
    quote_from_address: row?.quote_from_address ?? null,
    quote_from_phone: row?.quote_from_phone ?? null,
    quote_from_email: row?.quote_from_email ?? null,
    quote_prepared_by_name: row?.quote_prepared_by_name ?? null,
  });
}

export async function DELETE() {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;
  await prisma.appBranding.upsert({
    where: { id: "default" },
    create: { id: "default", logo_data_url: null, logo_mime_type: null },
    update: { logo_data_url: null, logo_mime_type: null },
  });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const row = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const quote_from_name =
    typeof row.quote_from_name === "string" ? row.quote_from_name.trim().slice(0, 200) : null;
  const quote_from_address =
    typeof row.quote_from_address === "string" ? row.quote_from_address.trim().slice(0, 2000) : null;
  const quote_from_phone =
    typeof row.quote_from_phone === "string" ? row.quote_from_phone.trim().slice(0, 120) : null;
  const quote_from_email =
    typeof row.quote_from_email === "string" ? row.quote_from_email.trim().slice(0, 200) : null;
  const quote_prepared_by_name =
    typeof row.quote_prepared_by_name === "string"
      ? row.quote_prepared_by_name.trim().slice(0, 200)
      : null;

  const updated = await prisma.appBranding.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      quote_from_name,
      quote_from_address,
      quote_from_phone,
      quote_from_email,
      quote_prepared_by_name,
    },
    update: {
      quote_from_name,
      quote_from_address,
      quote_from_phone,
      quote_from_email,
      quote_prepared_by_name,
    },
  });
  return NextResponse.json({
    ok: true,
    quote_from_name: updated.quote_from_name,
    quote_from_address: updated.quote_from_address,
    quote_from_phone: updated.quote_from_phone,
    quote_from_email: updated.quote_from_email,
    quote_prepared_by_name: updated.quote_prepared_by_name,
  });
}

export async function POST(req: NextRequest) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Expected multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Missing logo file." }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAX_LOGO_BYTES) {
    return NextResponse.json({ ok: false, error: "Logo must be between 1 byte and 1MB." }, { status: 400 });
  }
  const mime = (file.type || "").toLowerCase().trim();
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json({ ok: false, error: "Use PNG, JPG, WEBP, or SVG." }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;

  await prisma.appBranding.upsert({
    where: { id: "default" },
    create: { id: "default", logo_data_url: dataUrl, logo_mime_type: mime },
    update: { logo_data_url: dataUrl, logo_mime_type: mime },
  });

  return NextResponse.json({ ok: true, logo_data_url: dataUrl, logo_mime_type: mime });
}

