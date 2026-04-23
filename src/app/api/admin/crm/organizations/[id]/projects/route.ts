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
  existing_project_id: z.string().uuid().optional(),
});
const PatchSchema = z.object({
  quote_id: z.string().uuid(),
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
  const [organization, projects, quotes] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    }),
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
  if (!organization) {
    return NextResponse.json({ ok: false, error: "Organization not found." }, { status: 404 });
  }
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

  return NextResponse.json({ ok: true, organization, projects, quotes: quotesForPm });
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

  if (!input.data.allow_duplicate_quote_project && !input.data.existing_project_id) {
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

  if (input.data.existing_project_id) {
    const existingProject = await prisma.pmProject.findFirst({
      where: { id: input.data.existing_project_id, organization_id: organizationId },
      include: {
        sprints: {
          orderBy: { sprint_number: "asc" },
          select: {
            id: true,
            sprint_number: true,
            completion_pct: true,
            status: true,
          },
        },
      },
    });
    if (!existingProject) {
      return NextResponse.json({ ok: false, error: "Selected existing project was not found." }, { status: 404 });
    }
    if (existingProject.status === "COMPLETED" || (existingProject.completion_pct ?? 0) >= 100) {
      return NextResponse.json({ ok: false, error: "Completed projects are read-only for quote merges." }, { status: 409 });
    }

    const existingSprints = existingProject.sprints;
    for (let idx = 0; idx < bootstrap.sprints.length; idx += 1) {
      const b = bootstrap.sprints[idx];
      const current = existingSprints[idx];
      if (current) {
        await prisma.pmSprint.update({
          where: { id: current.id },
          data: {
            title: b.title,
            stage_label: b.stage_label,
            cost_band: b.cost_band,
            scope_summary: b.scope_summary,
            estimated_duration_value: b.estimated_duration_value,
            estimated_duration_unit: b.estimated_duration_unit,
            estimated_completion_date: b.estimated_completion_date,
            target_start_at: b.target_start_at,
            target_end_at: b.target_end_at,
            sprint_number: idx + 1,
          },
        });
      } else {
        await prisma.pmSprint.create({
          data: {
            project_id: existingProject.id,
            sprint_number: idx + 1,
            title: b.title,
            stage_label: b.stage_label,
            cost_band: b.cost_band,
            scope_summary: b.scope_summary,
            estimated_duration_value: b.estimated_duration_value,
            estimated_duration_unit: b.estimated_duration_unit,
            estimated_completion_date: b.estimated_completion_date,
            target_start_at: b.target_start_at,
            target_end_at: b.target_end_at,
            completion_pct: 0,
            status: "NOT_STARTED",
          },
        });
      }
    }

    const allSprints = await prisma.pmSprint.findMany({
      where: { project_id: existingProject.id },
      select: { completion_pct: true, target_start_at: true, target_end_at: true, estimated_completion_date: true },
    });
    const completion =
      allSprints.length > 0
        ? Math.round(allSprints.reduce((sum, s) => sum + (s.completion_pct ?? 0), 0) / allSprints.length)
        : 0;
    const project = await prisma.pmProject.update({
      where: { id: existingProject.id },
      data: {
        completion_pct: completion,
        target_start_at:
          allSprints
            .map((s) => s.target_start_at)
            .filter((d): d is Date => d instanceof Date)
            .sort((a, b) => a.getTime() - b.getTime())[0] ?? existingProject.target_start_at ?? null,
        target_end_at:
          allSprints
            .map((s) => s.target_end_at ?? s.estimated_completion_date)
            .filter((d): d is Date => d instanceof Date)
            .sort((a, b) => b.getTime() - a.getTime())[0] ?? existingProject.target_end_at ?? null,
      },
      include: { sprints: { orderBy: { sprint_number: "asc" } } },
    });

    return NextResponse.json({ ok: true, project, merged_into_existing_project: true }, { status: 201 });
  }

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

export async function PATCH(
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
  const input = PatchSchema.safeParse(body);
  if (!input.success) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });

  const quote = await prisma.crmQuote.findFirst({
    where: { id: input.data.quote_id, organization_id: organizationId },
  });
  if (!quote) {
    return NextResponse.json({ ok: false, error: "Quote not found for this organization." }, { status: 404 });
  }

  const quotePayload =
    quote.quote_payload && typeof quote.quote_payload === "object"
      ? (quote.quote_payload as Record<string, unknown>)
      : {};
  const currentPm =
    quotePayload.pm && typeof quotePayload.pm === "object"
      ? (quotePayload.pm as Record<string, unknown>)
      : {};
  const nextPayload: Record<string, unknown> = {
    ...quotePayload,
    scopeProjectsLocked: true,
    scopeProjectsLockedAt: quotePayload.scopeProjectsLockedAt ?? new Date().toISOString(),
    pm: {
      ...currentPm,
      activeForPm: true,
      activatedAt: new Date().toISOString(),
    },
  };

  await prisma.crmQuote.update({
    where: { id: quote.id },
    data: { quote_payload: nextPayload as object },
  });

  const existingProject = await prisma.pmProject.findFirst({
    where: { organization_id: organizationId, quote_id: quote.id },
    select: { id: true },
    orderBy: { updated_at: "desc" },
  });

  return NextResponse.json({
    ok: true,
    quote_id: quote.id,
    project_id: existingProject?.id ?? null,
  });
}

