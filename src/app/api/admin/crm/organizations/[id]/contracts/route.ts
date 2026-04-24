import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";
import { uploadOrganizationLibraryFile } from "@/lib/googleDrive";
import { sendMakeLibraryEvent } from "@/lib/makeWebhook";

const ParamsSchema = z.object({ id: z.string().uuid() });

const PostSchema = z.object({
  title: z.string().min(1).max(500),
  body_notes: z.string().max(20000).optional(),
  quote_id: z.string().uuid().optional(),
  status: z.string().max(80).optional(),
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

  const contract = await prisma.crmContract.create({
    data: {
      organization_id: orgId,
      title: data.data.title.trim(),
      body_notes: data.data.body_notes?.trim() || null,
      quote_id: data.data.quote_id ?? null,
      status: (data.data.status ?? "DRAFT").trim().slice(0, 80),
    },
  });

  const docText = [
    `Contract ID: ${contract.id}`,
    `Organization: ${org.name}`,
    `Title: ${contract.title}`,
    `Status: ${contract.status}`,
    contract.quote_id ? `Quote ID: ${contract.quote_id}` : "",
    contract.body_notes ? `Body Notes:\n${contract.body_notes}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const doc = await prisma.organizationDocument.create({
    data: {
      organization_id: orgId,
      title: `Contract ${contract.title}`.slice(0, 240),
      source_type: "CLIENT_CONTRACT",
      source_url: contract.id,
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
      filename: `contract-${contract.id.slice(0, 8)}.txt`,
      mimeType: "text/plain",
      bytes: docBytes,
    });
    if (synced.fileId || synced.webViewLink) {
      await prisma.organizationDocument.update({
        where: { id: doc.id },
        data: {
          google_drive_file_id: synced.fileId,
          storage_path: synced.fileId ? `gdrive:${synced.fileId}` : null,
          source_url: synced.webViewLink ?? contract.id,
        },
      });
    }
    await sendMakeLibraryEvent({
      event_type: "library_document_created",
      organization_id: orgId,
      organization_name: org.name,
      source_type: "CLIENT_CONTRACT",
      source_id: contract.id,
      filename: `contract-${contract.id.slice(0, 8)}.txt`,
      mime_type: "text/plain",
      file_base64: docBytes.toString("base64"),
      text_preview: docText.slice(0, 3000),
    });
  } catch {
    // best-effort sync
  }

  return NextResponse.json({ ok: true, contract }, { status: 201 });
}
