import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";
import { buildInitialQuotePayload } from "@/lib/crmQuoteDefaults";
import { quoteTotalCentsFromPayload } from "@/lib/crmQuoteTotals";

const ParamsSchema = z.object({ id: z.string().uuid() });

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

  const quotes = await prisma.crmQuote.findMany({
    where: { organization_id: parsed.data.id },
    orderBy: { updated_at: "desc" },
    take: 20,
  });

  return NextResponse.json({ ok: true, quotes });
}

const PostSchema = z.object({
  assessment_id: z.string().uuid().optional(),
  /** When true, re-pull latest project scope for that assessment into a new quote row */
  from_latest_scope: z.boolean().optional(),
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

  let body: unknown = {};
  try {
    const t = await req.text();
    if (t.trim()) body = JSON.parse(t);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const input = PostSchema.safeParse(body);
  if (!input.success) {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) {
    return NextResponse.json({ ok: false, error: "Organization not found" }, { status: 404 });
  }

  const assessmentId =
    input.data.assessment_id ??
    (
      await prisma.assessment.findFirst({
        where: { organization_id: orgId },
        orderBy: { created_at: "desc" },
        select: { id: true },
      })
    )?.id ??
    null;

  let scopeRow = null as Awaited<ReturnType<typeof prisma.assessmentProjectScope.findFirst>>;

  if (assessmentId && input.data.from_latest_scope !== false) {
    scopeRow = await prisma.assessmentProjectScope.findFirst({
      where: { assessment_id: assessmentId },
      orderBy: { version: "desc" },
    });
  }

  const priceBook = await prisma.priceBook.findFirst({
    where: { is_current: true },
    orderBy: { created_at: "desc" },
  });
  const lineItems = priceBook?.line_items;
  const arr = Array.isArray(lineItems) ? lineItems : [];

  const payload = buildInitialQuotePayload({
    organization: org,
    projectScope: scopeRow
      ? { scope_json: scopeRow.scope_json, version: scopeRow.version }
      : null,
    priceLineItems: arr,
  });

  const total = quoteTotalCentsFromPayload(payload as Record<string, unknown>);

  const quote = await prisma.crmQuote.create({
    data: {
      organization_id: orgId,
      assessment_id: assessmentId,
      project_scope_version: scopeRow?.version ?? null,
      project_scope_snapshot: scopeRow ? (scopeRow.scope_json as object) : undefined,
      quote_payload: payload as object,
      total_cents: total,
      status: "DRAFT",
    },
  });

  return NextResponse.json({ ok: true, quote }, { status: 201 });
}
