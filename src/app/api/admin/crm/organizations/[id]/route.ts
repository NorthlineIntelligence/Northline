import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CrmPipelineStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";
import { isCrmFollowUpOverdue } from "@/lib/crmPipeline";

const ParamsSchema = z.object({ id: z.string().uuid() });

const PatchSchema = z.object({
  crm_pipeline_stage: z.nativeEnum(CrmPipelineStage).optional(),
  crm_next_follow_up_at: z.union([z.string().datetime(), z.null()]).optional(),
  crm_internal_notes: z.union([z.string().max(20000), z.null()]).optional(),
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
  const orgId = parsed.data.id;

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      org_contacts: {
        where: { is_archived: false },
        orderBy: { created_at: "asc" },
      },
      assessments: {
        orderBy: { created_at: "desc" },
        take: 3,
        select: {
          id: true,
          name: true,
          status: true,
          created_at: true,
          locked_at: true,
        },
      },
      crm_quotes: {
        orderBy: { updated_at: "desc" },
        take: 8,
        select: {
          id: true,
          status: true,
          total_cents: true,
          updated_at: true,
          assessment_id: true,
        },
      },
      crm_contracts: {
        orderBy: { updated_at: "desc" },
        take: 8,
      },
      crm_invoices: {
        orderBy: { updated_at: "desc" },
        take: 8,
      },
      _count: {
        select: {
          assessments: true,
          org_contacts: true,
        },
      },
    },
  });

  if (!org) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const latestAssessmentId = org.assessments[0]?.id ?? null;

  let latestNarrativeAssessmentId: string | null = null;
  if (latestAssessmentId) {
    const n = await prisma.assessmentNarrative.findFirst({
      where: { assessment_id: latestAssessmentId },
      orderBy: { version: "desc" },
      select: { assessment_id: true },
    });
    latestNarrativeAssessmentId = n?.assessment_id ?? latestAssessmentId;
  }

  let latestScope: { assessment_id: string; version: number } | null = null;
  if (latestAssessmentId) {
    const s = await prisma.assessmentProjectScope.findFirst({
      where: { assessment_id: latestAssessmentId },
      orderBy: { version: "desc" },
      select: { assessment_id: true, version: true },
    });
    latestScope = s;
  }

  const followUpOverdue = isCrmFollowUpOverdue(org.crm_next_follow_up_at, org.crm_pipeline_stage);

  const invoiceAlerts = org.crm_invoices.filter(
    (inv) =>
      inv.due_date &&
      inv.status.toUpperCase() !== "PAID" &&
      inv.status.toUpperCase() !== "VOID" &&
      new Date(inv.due_date).getTime() < Date.now()
  );

  return NextResponse.json({
    ok: true,
    organization: org,
    links: {
      executiveInsightsAssessmentId: latestNarrativeAssessmentId,
      projectScope: latestScope
        ? {
            assessmentId: latestScope.assessment_id,
            version: latestScope.version,
          }
        : null,
    },
    alerts: {
      followUpOverdue,
      overdueInvoices: invoiceAlerts.length,
    },
  });
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
  const orgId = parsed.data.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const patch = PatchSchema.safeParse(body);
  if (!patch.success) {
    return NextResponse.json({ ok: false, error: "Invalid body", issues: patch.error.flatten() }, { status: 400 });
  }

  const data: Parameters<typeof prisma.organization.update>[0]["data"] = {};
  if (patch.data.crm_pipeline_stage !== undefined) {
    data.crm_pipeline_stage = patch.data.crm_pipeline_stage;
    data.crm_stage_updated_at = new Date();
  }
  if (patch.data.crm_next_follow_up_at !== undefined) {
    data.crm_next_follow_up_at =
      patch.data.crm_next_follow_up_at === null ? null : new Date(patch.data.crm_next_follow_up_at);
  }
  if (patch.data.crm_internal_notes !== undefined) {
    data.crm_internal_notes = patch.data.crm_internal_notes;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, error: "No updates" }, { status: 400 });
  }

  const updated = await prisma.organization.update({
    where: { id: orgId },
    data,
  });

  return NextResponse.json({ ok: true, organization: updated });
}
