/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { sanitizeConsultantNotesHtml } from "@/lib/priorityDiscovery/sanitizeConsultantNotesHtml";
import {
  buildPriorityAnalysisInput,
  getLatestPriorityAnalysis,
  getOrGeneratePriorityAnalysis,
  toClientPriorityAnalysis,
} from "@/lib/priorityDiscovery/analysisPersistence";

const patchConsultantNotesSchema = z.object({
  analysisId: z.string().uuid(),
  consultantNotesHtml: z.union([z.string().max(50000), z.null()]),
});

function csvEscape(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const analysis = await getLatestPriorityAnalysis(id);

  if (!analysis) return NextResponse.json({ ok: true, analysis: null });

  const format = req.nextUrl.searchParams.get("format");
  if (format === "responses_csv") {
    const input = await buildPriorityAnalysisInput(id);
    if (!input) return NextResponse.json({ ok: false, error: "Priority Discovery assessment not found" }, { status: 404 });
    const rows = [
      "participantId,role,seniorityLevel,department,section,question,responseType,scoringDimension,answer",
      ...input.responses.map((response) => {
        const participant = input.participants.find((p) => p.id === response.participantId);
        const answer =
          response.answerText ??
          response.answerNumber ??
          (Array.isArray(response.answerJson) ? response.answerJson.join(" | ") : response.answerJson ? JSON.stringify(response.answerJson) : "");
        return [
          response.participantId,
          participant?.role,
          participant?.seniorityLevel,
          participant?.department,
          response.section,
          response.questionText,
          response.responseType,
          response.scoringDimension,
          answer,
        ].map(csvEscape).join(",");
      }),
    ];
    return new NextResponse(rows.join("\n") + "\n", {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="priority-discovery-responses-${id}.csv"`,
      },
    });
  }
  if (format === "json") {
    return NextResponse.json(analysis.output_json);
  }

  return NextResponse.json({ ok: true, analysis: toClientPriorityAnalysis(analysis) });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const force = req.nextUrl.searchParams.get("force") === "1";
  const profile = req.nextUrl.searchParams.get("profile");
  const readoutProfile = profile === "client_specific" ? "client_specific" : "standard";
  const shouldForce = force || readoutProfile === "client_specific";

  try {
    const result = await getOrGeneratePriorityAnalysis({
      assessmentId: id,
      force: shouldForce,
      readoutProfile,
    });
    return NextResponse.json({
      ok: true,
      cached: result.cached,
      readoutProfile,
      analysis: toClientPriorityAnalysis(result.analysis),
      modelUsed: result.modelUsed,
      modeUsed: result.modeUsed,
      providerUsed: result.providerUsed,
      warnings: result.warnings,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const parsed = patchConsultantNotesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const assessment = await prisma.assessment.findUnique({
    where: { id },
    select: { id: true, assessment_type: true },
  });
  if (!assessment || assessment.assessment_type !== "PRIORITY_DISCOVERY") {
    return NextResponse.json({ ok: false, error: "Priority Discovery assessment not found" }, { status: 404 });
  }

  const existing = await prisma.priorityAnalysis.findFirst({
    where: { id: parsed.data.analysisId, assessment_id: id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Analysis not found for this assessment." }, { status: 404 });
  }

  const consultantNotesHtml =
    parsed.data.consultantNotesHtml === null
      ? null
      : sanitizeConsultantNotesHtml(parsed.data.consultantNotesHtml);

  const updated = await prisma.priorityAnalysis.update({
    where: { id: parsed.data.analysisId },
    data: { consultant_notes_html: consultantNotesHtml },
    include: { projects: { orderBy: { rank: "asc" } } },
  });

  return NextResponse.json({
    ok: true,
    consultantNotesHtml: updated.consultant_notes_html,
    analysis: toClientPriorityAnalysis(updated),
  });
}
