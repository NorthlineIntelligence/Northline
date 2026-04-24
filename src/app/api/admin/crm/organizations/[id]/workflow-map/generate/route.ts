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
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid organization id" }, { status: 400 });
  }

  const org = await prisma.organization.findUnique({
    where: { id: parsed.data.id },
    select: {
      id: true,
      name: true,
      industry: true,
      tech_stack_notes: true,
      integration_notes: true,
      process_workflow_notes: true,
      context_notes: true,
    },
  });
  if (!org) return NextResponse.json({ ok: false, error: "Organization not found" }, { status: 404 });

  const scrub = (text: string | null | undefined) =>
    anonymizeOrgText({ text, organizationName: org.name, industry: org.industry }) ?? "";

  const input = {
    companyReference: "the company",
    knownTechStack: scrub(org.tech_stack_notes),
    knownIntegrations: scrub(org.integration_notes),
    knownProcessesAndWorkflows: scrub(org.process_workflow_notes),
    additionalContext: scrub(org.context_notes),
  };

  const client = getClient();
  const response = await client.responses.create({
    model: "gpt-4.1",
    input: [
      {
        role: "system",
        content:
          "You are a principal operating-model consultant. Produce an executive-ready current-state workflow map from partial CRM notes. Never use legal company names; refer only to 'the company'. Be concise, clear, and practical.",
      },
      {
        role: "user",
        content:
          "Using the JSON input, produce markdown with these sections only:\n" +
          "1) Current workflow map\n2) Roadblocks and bottlenecks\n3) Constraints and likely business impact\n4) Efficiency opportunities\n5) High-value Northline entry points\n6) Suggested first 30-day actions\n\n" +
          "Requirements:\n" +
          "- If data is sparse, explicitly label assumptions and give generalized but actionable mapping.\n" +
          "- Call out where integration/workflow foundation should precede AI.\n" +
          "- Keep it digestible for executives: short bullets, clear prioritization.\n\n" +
          "INPUT:\n" +
          JSON.stringify(input),
      },
    ],
  });

  const text = (response.output_text ?? "").trim();
  const sanitized = scrub(text).slice(0, 12000);

  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: {
      workflow_map_ai_summary: sanitized || null,
      workflow_map_ai_updated_at: new Date(),
    },
    select: {
      workflow_map_ai_summary: true,
      workflow_map_ai_updated_at: true,
    },
  });

  return NextResponse.json({
    ok: true,
    summary: updated.workflow_map_ai_summary,
    updated_at: updated.workflow_map_ai_updated_at,
  });
}
