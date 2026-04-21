import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";
import { anonymizeOrgText } from "@/lib/anonymizeOrgText";

const ParamsSchema = z.object({ id: z.string().uuid() });

function getClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is missing.");
  return new OpenAI({ apiKey: key });
}

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;
  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid project id" }, { status: 400 });

  const project = await prisma.pmProject.findUnique({
    where: { id: parsed.data.id },
    include: {
      organization: { select: { name: true, industry: true } },
      sprints: {
        orderBy: { sprint_number: "asc" },
        include: { updates: { orderBy: { created_at: "desc" }, take: 3 } },
      },
    },
  });
  if (!project) return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });

  const orgName = project.organization.name;
  const industry = project.organization.industry;
  const scrub = (text: string | null | undefined) =>
    anonymizeOrgText({ text, organizationName: orgName, industry }) ?? "";

  const input = {
    project: {
      title: scrub(project.title),
      status: project.status,
      completion_pct: project.completion_pct,
      target_start_at: project.target_start_at?.toISOString() ?? null,
      target_end_at: project.target_end_at?.toISOString() ?? null,
      internal_notes: scrub(project.internal_notes),
    },
    sprints: project.sprints.map((s) => ({
      sprint_number: s.sprint_number,
      title: scrub(s.title),
      status: s.status,
      completion_pct: s.completion_pct,
      stage_label: scrub(s.stage_label),
      notes: scrub(s.notes),
      target_start_at: s.target_start_at?.toISOString() ?? null,
      target_end_at: s.target_end_at?.toISOString() ?? null,
      updates: s.updates.map((u) => ({
        status_label: u.status_label,
        why_text: scrub(u.why_text),
        is_customer_visible: u.is_customer_visible,
        created_at: u.created_at.toISOString(),
      })),
    })),
  };

  const client = getClient();
  const response = await client.responses.create({
    model: "gpt-4.1",
    input: [
      {
        role: "system",
        content:
          "You are a PMO assistant. Write a concise project status overview in ~500 words. Never infer or output legal company names. Refer only to 'the company'.",
      },
      {
        role: "user",
        content:
          "Create an executive status overview with: overall status, on-time risk, blockers, next sprint priorities, and a short section per sprint.\n\nJSON INPUT:\n" +
          JSON.stringify(input),
      },
    ],
  });

  const text = (response.output_text ?? "").trim();
  const sanitized = scrub(text).slice(0, 12000);

  const updated = await prisma.pmProject.update({
    where: { id: project.id },
    data: {
      last_ai_summary: sanitized || null,
      ai_summary_updated_at: new Date(),
    },
    select: { id: true, last_ai_summary: true, ai_summary_updated_at: true },
  });

  return NextResponse.json({ ok: true, summary: updated.last_ai_summary, updated_at: updated.ai_summary_updated_at });
}

