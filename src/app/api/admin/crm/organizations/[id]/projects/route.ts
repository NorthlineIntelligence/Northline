import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";
import { buildProjectFromQuote } from "@/lib/pmProjectBootstrap";

const ParamsSchema = z.object({ id: z.string().uuid() });
const PostSchema = z.object({
  quote_id: z.string().uuid(),
  title: z.string().min(1).max(300).optional(),
  allow_duplicate_quote_project: z.boolean().optional(),
});

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;
  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });

  const organizationId = parsed.data.id;
  const [projects, quotes] = await Promise.all([
    prisma.pmProject.findMany({
      where: { organization_id: organizationId },
      include: {
        sprints: {
          orderBy: { sprint_number: "asc" },
          include: {
            updates: { orderBy: { created_at: "desc" }, take: 3 },
          },
        },
      },
      orderBy: { updated_at: "desc" },
    }),
    prisma.crmQuote.findMany({
      where: { organization_id: organizationId },
      select: {
        id: true,
        status: true,
        total_cents: true,
        updated_at: true,
        assessment_id: true,
        quote_payload: true,
      },
      orderBy: { updated_at: "desc" },
      take: 20,
    }),
  ]);
  const quotesForPm = quotes
    .map((q) => {
      const payload =
        q.quote_payload && typeof q.quote_payload === "object"
          ? (q.quote_payload as Record<string, unknown>)
          : {};
      const pm = payload.pm && typeof payload.pm === "object" ? (payload.pm as Record<string, unknown>) : {};
      return {
        id: q.id,
        status: q.status,
        total_cents: q.total_cents,
        updated_at: q.updated_at,
        assessment_id: q.assessment_id,
        active_for_pm: pm.activeForPm === true,
      };
    })
    .sort((a, b) => Number(b.active_for_pm) - Number(a.active_for_pm));

  return NextResponse.json({ ok: true, projects, quotes: quotesForPm });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;
  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  const organizationId = parsed.data.id;

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const input = PostSchema.safeParse(body);
  if (!input.success) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });

  const quote = await prisma.crmQuote.findFirst({
    where: { id: input.data.quote_id, organization_id: organizationId },
  });
  if (!quote) {
    return NextResponse.json({ ok: false, error: "Quote not found for this organization." }, { status: 404 });
  }

  if (!input.data.allow_duplicate_quote_project) {
    const existing = await prisma.pmProject.findFirst({
      where: { organization_id: organizationId, quote_id: quote.id },
      select: { id: true, title: true },
    });
    if (existing) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "A project already exists for this quote. Open the existing project or confirm duplicate creation.",
          duplicate_project: existing,
        },
        { status: 409 }
      );
    }
  }

  const quotePayload =
    quote.quote_payload && typeof quote.quote_payload === "object"
      ? (quote.quote_payload as Record<string, unknown>)
      : {};
  const scopeProjectsLocked = quotePayload.scopeProjectsLocked === true;
  if (!scopeProjectsLocked) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Projects must be locked in the quote workspace before creating a PM project. Lock scope first, then retry.",
      },
      { status: 409 }
    );
  }

  const bootstrap = buildProjectFromQuote({
    quote,
    fallbackTitle: input.data.title ?? `Project for quote ${quote.id.slice(0, 8)}`,
  });

  const project = await prisma.pmProject.create({
    data: {
      organization_id: organizationId,
      quote_id: quote.id,
      assessment_id: quote.assessment_id,
      title: input.data.title ?? bootstrap.title,
      status: "PLANNED",
      target_start_at: bootstrap.targetStartAt,
      target_end_at: bootstrap.targetEndAt,
      completion_pct: 0,
      sprints: {
        create: bootstrap.sprints.map((s) => ({
          sprint_number: s.sprint_number,
          title: s.title,
          stage_label: s.stage_label,
          cost_band: s.cost_band,
          scope_summary: s.scope_summary,
          estimated_duration_value: s.estimated_duration_value,
          estimated_duration_unit: s.estimated_duration_unit,
          estimated_completion_date: s.estimated_completion_date,
          target_start_at: s.target_start_at,
          target_end_at: s.target_end_at,
          completion_pct: s.completion_pct,
          status: "NOT_STARTED",
        })),
      },
    },
    include: {
      sprints: { orderBy: { sprint_number: "asc" } },
    },
  });

  return NextResponse.json({ ok: true, project }, { status: 201 });
}

