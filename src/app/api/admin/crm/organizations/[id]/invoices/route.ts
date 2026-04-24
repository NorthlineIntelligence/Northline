import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";
import { uploadOrganizationLibraryFile } from "@/lib/googleDrive";
import { sendMakeLibraryEvent } from "@/lib/makeWebhook";

const ParamsSchema = z.object({ id: z.string().uuid() });

const PostSchema = z.object({
  title: z.string().min(1).max(500),
  amount_cents: z.number().int().min(0),
  status: z.string().max(80).optional(),
  due_date: z.union([z.string().datetime(), z.null()]).optional(),
  quote_id: z.string().uuid().optional(),
  notes: z.string().max(20000).optional(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }
  const orgId = parsed.data.id;

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true } });
  if (!org) {
    return NextResponse.json({ ok: false, error: "Organization not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const data = PostSchema.safeParse(body);
  if (!data.success) {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const invoice = await prisma.crmInvoice.create({
    data: {
      organization_id: orgId,
      title: data.data.title.trim(),
      amount_cents: data.data.amount_cents,
      status: (data.data.status ?? "DRAFT").trim().slice(0, 80),
      due_date:
        data.data.due_date === undefined
          ? undefined
          : data.data.due_date === null
            ? null
            : new Date(data.data.due_date),
      quote_id: data.data.quote_id ?? null,
      notes: data.data.notes?.trim() || null,
    },
  });

  const docText = [
    `Invoice ID: ${invoice.id}`,
    `Organization: ${org.name}`,
    `Title: ${invoice.title}`,
    `Amount Cents: ${invoice.amount_cents}`,
    `Status: ${invoice.status}`,
    invoice.due_date ? `Due Date: ${invoice.due_date.toISOString()}` : "",
    invoice.notes ? `Notes:\n${invoice.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const doc = await prisma.organizationDocument.create({
    data: {
      organization_id: orgId,
      title: `Invoice ${invoice.title}`.slice(0, 240),
      source_type: "CLIENT_INVOICE",
      source_url: invoice.id,
      mime_type: "text/plain",
      text_extracted: docText,
    },
    select: { id: true },
  });

  try {
    const docBytes = Buffer.from(docText, "utf8");
    const synced = await uploadOrganizationLibraryFile({
      organizationId: orgId,
      organizationName: org.name,
      filename: `invoice-${invoice.id.slice(0, 8)}.txt`,
      mimeType: "text/plain",
      bytes: docBytes,
    });
    if (synced.fileId || synced.webViewLink) {
      await prisma.organizationDocument.update({
        where: { id: doc.id },
        data: {
          google_drive_file_id: synced.fileId,
          storage_path: synced.fileId ? `gdrive:${synced.fileId}` : null,
          source_url: synced.webViewLink ?? invoice.id,
        },
      });
    }
    await sendMakeLibraryEvent({
      event_type: "library_document_created",
      organization_id: orgId,
      organization_name: org.name,
      source_type: "CLIENT_INVOICE",
      source_id: invoice.id,
      filename: `invoice-${invoice.id.slice(0, 8)}.txt`,
      mime_type: "text/plain",
      file_base64: docBytes.toString("base64"),
      text_preview: docText.slice(0, 3000),
    });
  } catch {
    // best-effort sync
  }

  return NextResponse.json({ ok: true, invoice }, { status: 201 });
}
