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
      select: { id: true, status: true, total_cents: true, updated_at: true, assessment_id: true },
      orderBy: { updated_at: "desc" },
      take: 20,
    }),
  ]);

  return NextResponse.json({ ok: true, projects, quotes });
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

