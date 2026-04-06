import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CrmQuoteStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";
import { buildInitialQuotePayload } from "@/lib/crmQuoteDefaults";
import { quoteTotalCentsFromPayload } from "@/lib/crmQuoteTotals";

const ParamsSchema = z.object({ id: z.string().uuid() });

const PatchSchema = z.object({
  quote_payload: z.record(z.string(), z.unknown()).optional(),
  signee_contact_id: z.union([z.string().uuid(), z.null()]).optional(),
  billing_contact_id: z.union([z.string().uuid(), z.null()]).optional(),
  status: z.nativeEnum(CrmQuoteStatus).optional(),
  valid_until: z.union([z.string().datetime(), z.null()]).optional(),
  /** Replace payload lines from latest saved project scope for the linked assessment */
  resync_from_scope: z.boolean().optional(),
});

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const quote = await prisma.crmQuote.findUnique({
    where: { id: parsed.data.id },
  });

  if (!quote) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, quote });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }
  const quoteId = parsed.data.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const patch = PatchSchema.safeParse(body);
  if (!patch.success) {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const existing = await prisma.crmQuote.findUnique({ where: { id: quoteId } });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  let nextPayload = (existing.quote_payload ?? {}) as Record<string, unknown>;

  if (patch.data.resync_from_scope && existing.assessment_id) {
    const org = await prisma.organization.findUnique({
      where: { id: existing.organization_id },
    });
    const scopeRow = await prisma.assessmentProjectScope.findFirst({
      where: { assessment_id: existing.assessment_id },
      orderBy: { version: "desc" },
    });
    const priceBook = await prisma.priceBook.findFirst({
      where: { is_current: true },
      orderBy: { created_at: "desc" },
    });
    const arr = Array.isArray(priceBook?.line_items) ? priceBook!.line_items : [];
    if (org) {
      nextPayload = buildInitialQuotePayload({
        organization: org,
        projectScope: scopeRow
          ? { scope_json: scopeRow.scope_json, version: scopeRow.version }
          : null,
        priceLineItems: arr as unknown[],
      }) as Record<string, unknown>;
    }
  }

  if (patch.data.quote_payload !== undefined) {
    nextPayload = patch.data.quote_payload as Record<string, unknown>;
  }

  const total = quoteTotalCentsFromPayload(nextPayload);

  const data: Parameters<typeof prisma.crmQuote.update>[0]["data"] = {
    quote_payload: nextPayload as object,
    total_cents: total,
  };

  if (patch.data.signee_contact_id !== undefined) {
    if (patch.data.signee_contact_id) {
      const c = await prisma.orgContact.findFirst({
        where: {
          id: patch.data.signee_contact_id,
          organization_id: existing.organization_id,
          is_archived: false,
        },
      });
      if (!c) {
        return NextResponse.json({ ok: false, error: "Signee contact not found for this org" }, { status: 400 });
      }
    }
    data.signee_contact_id = patch.data.signee_contact_id;
  }
  if (patch.data.billing_contact_id !== undefined) {
    if (patch.data.billing_contact_id) {
      const c = await prisma.orgContact.findFirst({
        where: {
          id: patch.data.billing_contact_id,
          organization_id: existing.organization_id,
          is_archived: false,
        },
      });
      if (!c) {
        return NextResponse.json(
          { ok: false, error: "Billing / POC contact not found for this org" },
          { status: 400 }
        );
      }
    }
    data.billing_contact_id = patch.data.billing_contact_id;
  }
  if (patch.data.status !== undefined) data.status = patch.data.status;
  if (patch.data.valid_until !== undefined) {
    data.valid_until = patch.data.valid_until === null ? null : new Date(patch.data.valid_until);
  }

  if (patch.data.resync_from_scope && existing.assessment_id) {
    const scopeRow = await prisma.assessmentProjectScope.findFirst({
      where: { assessment_id: existing.assessment_id },
      orderBy: { version: "desc" },
    });
    if (scopeRow) {
      data.project_scope_version = scopeRow.version;
      data.project_scope_snapshot = scopeRow.scope_json as object;
    }
  }

  const quote = await prisma.crmQuote.update({
    where: { id: quoteId },
    data,
  });

  return NextResponse.json({ ok: true, quote });
}
