import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";
import { anonymizeOrgText } from "@/lib/anonymizeOrgText";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });

const MAX_FILES = 10;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 120000;

function normalizeTextForExtraction(text: string): string | null {
  const trimmed = text.replace(/\u0000/g, "").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_EXTRACTED_TEXT_CHARS);
}

function canExtractText(mimeType: string, name: string): boolean {
  const mt = (mimeType || "").toLowerCase();
  const n = (name || "").toLowerCase();
  if (mt.startsWith("text/")) return true;
  if (mt === "application/json") return true;
  return (
    n.endsWith(".txt") ||
    n.endsWith(".md") ||
    n.endsWith(".csv") ||
    n.endsWith(".json") ||
    n.endsWith(".log")
  );
}

async function extractTextFromFile(file: File, mime: string | null): Promise<string | null> {
  const name = file.name.toLowerCase();
  const mt = (mime ?? "").toLowerCase();

  if (mt === "application/pdf" || name.endsWith(".pdf")) {
    const mod = await import("pdf-parse");
    const PDFParse = mod.PDFParse;
    const ab = await file.arrayBuffer();
    const parser = new PDFParse({ data: Buffer.from(ab) });
    try {
      const parsed = await parser.getText();
      return normalizeTextForExtraction(parsed?.text ?? "");
    } finally {
      await parser.destroy();
    }
  }

  if (canExtractText(mt, name)) {
    return normalizeTextForExtraction(await file.text());
  }

  return null;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid organization id" }, { status: 400 });
  }

  const docs = await prisma.organizationDocument.findMany({
    where: { organization_id: parsed.data.id },
    orderBy: [{ created_at: "desc" }],
    select: {
      id: true,
      title: true,
      source_type: true,
      source_url: true,
      mime_type: true,
      created_at: true,
      text_extracted: true,
    },
  });

  return NextResponse.json({
    ok: true,
    documents: docs.map((d) => ({
      ...d,
      text_extracted_chars: d.text_extracted?.length ?? 0,
      has_extracted_text: Boolean(d.text_extracted && d.text_extracted.trim()),
    })),
  });
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid organization id" }, { status: 400 });
  }
  const organizationId = parsed.data.id;

  const docId = (req.nextUrl.searchParams.get("docId") ?? "").trim();
  if (!docId) {
    return NextResponse.json({ ok: false, error: "Missing docId query param." }, { status: 400 });
  }

  const existing = await prisma.organizationDocument.findFirst({
    where: { id: docId, organization_id: organizationId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Document not found for this organization." }, { status: 404 });
  }

  await prisma.organizationDocument.delete({ where: { id: docId } });
  return NextResponse.json({ ok: true, deleted_id: docId }, { status: 200 });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid organization id" }, { status: 400 });
  }
  const organizationId = parsed.data.id;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, industry: true },
  });
  if (!org) {
    return NextResponse.json({ ok: false, error: "Organization not found" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Expected multipart form data" }, { status: 400 });
  }

  const all = form.getAll("files");
  const files = all.filter((x): x is File => x instanceof File);

  if (files.length === 0) {
    return NextResponse.json({ ok: false, error: "No files provided." }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { ok: false, error: `Too many files. Max ${MAX_FILES} per upload.` },
      { status: 400 }
    );
  }

  const created: Array<{
    id: string;
    title: string;
    mime_type: string | null;
    extracted: boolean;
    extracted_chars: number;
    note: string | null;
  }> = [];

  for (const file of files) {
    if (file.size <= 0) continue;
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: `File "${file.name}" is too large. Max size is ${MAX_FILE_BYTES / (1024 * 1024)} MB.`,
        },
        { status: 400 }
      );
    }

    const mime = file.type?.trim() || null;
    let extractedText: string | null = null;
    let note: string | null = null;

    try {
      extractedText = await extractTextFromFile(file, mime);
      extractedText = anonymizeOrgText({
        text: extractedText,
        organizationName: org.name,
        industry: org.industry,
      });
      if (!extractedText) {
        note = "No usable text could be extracted from this file.";
      }
    } catch {
      note = "Could not extract text from this file.";
    }

    if (!extractedText && !(mime?.toLowerCase() === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
      note =
        note ??
        "Uploaded metadata only. For AI grounding, upload text/markdown/csv/json/log or PDF files.";
    }

    const doc = await prisma.organizationDocument.create({
      data: {
        organization_id: organizationId,
        title: file.name,
        source_type: "UPLOAD",
        source_url: note,
        mime_type: mime,
        text_extracted: extractedText,
      },
      select: {
        id: true,
        title: true,
        mime_type: true,
        text_extracted: true,
      },
    });

    created.push({
      id: doc.id,
      title: doc.title,
      mime_type: doc.mime_type,
      extracted: Boolean(doc.text_extracted),
      extracted_chars: doc.text_extracted?.length ?? 0,
      note,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      uploaded: created.length,
      documents: created,
    },
    { status: 201 }
  );
}

