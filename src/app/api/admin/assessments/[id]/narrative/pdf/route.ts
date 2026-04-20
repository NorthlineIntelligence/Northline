import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";
import { buildAssessmentResultsPayload } from "@/lib/assessmentResultsEngine";
import { renderAssessmentNarrativePdfBuffer } from "@/lib/assessmentNarrativePdf";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid assessment id" }, { status: 400 });
  }
  const assessmentId = parsed.data.id;

  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      name: true,
      created_at: true,
      organization: { select: { name: true } },
    },
  });
  if (!assessment) {
    return NextResponse.json({ ok: false, error: "Assessment not found" }, { status: 404 });
  }

  const narrative =
    (await prisma.assessmentNarrative.findFirst({
      where: { assessment_id: assessmentId, status: "FINAL" },
      orderBy: [{ version: "desc" }],
      select: { narrative_json: true },
    })) ??
    (await prisma.assessmentNarrative.findFirst({
      where: { assessment_id: assessmentId },
      orderBy: [{ version: "desc" }],
      select: { narrative_json: true },
    }));
  if (!narrative) {
    return NextResponse.json({ ok: false, error: "No narrative found for this assessment." }, { status: 404 });
  }

  const results = await buildAssessmentResultsPayload({ assessmentId });
  const readinessScore = results.ok
    ? (results.body?.aggregate?.overall?.weightedAverage as number | null)
    : null;
  const readinessBand = results.ok
    ? (results.body?.aggregate?.overall?.readinessBand as string | null)
    : null;

  const pdf = await renderAssessmentNarrativePdfBuffer({
    organizationName: assessment.organization.name,
    assessmentName: assessment.name,
    assessmentCreatedAt: assessment.created_at,
    assessmentId,
    readinessScore,
    readinessBand,
    narrativeJson: narrative.narrative_json,
  });

  const safeOrg = assessment.organization.name.replace(/[^\w-]+/g, "_");
  const datePart = assessment.created_at.toISOString().slice(0, 10);
  const filename = `${safeOrg}_assessment_${datePart}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

