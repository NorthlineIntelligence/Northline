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

