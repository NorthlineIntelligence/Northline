import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";

const ParamsSchema = z.object({ id: z.string().uuid() });

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid quote id" }, { status: 400 });
  }

  const quote = await prisma.crmQuote.findUnique({
    where: { id: parsed.data.id },
    include: { organization: true },
  });
  if (!quote) {
    return NextResponse.json({ ok: false, error: "Quote not found" }, { status: 404 });
  }

  const payload =
    quote.quote_payload && typeof quote.quote_payload === "object"
      ? (quote.quote_payload as Record<string, unknown>)
      : {};
  const terms = String(payload.terms ?? "").trim();
  const paymentTerms = String(payload.paymentTerms ?? "").trim();
  const scopeSummary =
    payload.scopeSummary && typeof payload.scopeSummary === "object"
      ? (payload.scopeSummary as { projects?: Array<{ name?: string; summary?: string; timelineLabel?: string }> })
      : null;
  const projects = Array.isArray(scopeSummary?.projects) ? scopeSummary.projects : [];
  const projectText = projects
    .map((p, i) => {
      const lines = [`${i + 1}. ${String(p.name ?? "").trim() || `Project ${i + 1}`}`];
      if (p.timelineLabel) lines.push(`Timeline: ${String(p.timelineLabel).trim()}`);
      if (p.summary) lines.push(`Scope: ${String(p.summary).trim()}`);
      return lines.join("\n");
    })
    .join("\n\n");
  const docText = [
    `Quote ID: ${quote.id}`,
    `Organization: ${quote.organization.legal_name || quote.organization.name}`,
    `Total: ${quote.total_cents ?? 0}`,
    projectText,
    paymentTerms ? `Payment Terms:\n${paymentTerms}` : "",
    terms ? `Terms:\n${terms}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const existing = await prisma.organizationDocument.findFirst({
    where: {
      organization_id: quote.organization_id,
      source_type: "CLIENT_QUOTE",
      source_url: quote.id,
    },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ ok: true, already_exists: true, document_id: existing.id });
  }

  const doc = await prisma.organizationDocument.create({
    data: {
      organization_id: quote.organization_id,
      title: `Client Quote ${quote.id.slice(0, 8)}`,
      source_type: "CLIENT_QUOTE",
      source_url: quote.id,
      mime_type: "application/pdf",
      text_extracted: docText,
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, document_id: doc.id }, { status: 201 });
}
