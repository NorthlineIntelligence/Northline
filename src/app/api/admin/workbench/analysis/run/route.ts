import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminApiUser } from "@/lib/adminApiAuth";
import { callModelRouter } from "@/lib/ai/modelRouter";
import { AI_MODES } from "@/lib/ai/taskTypes";
import { analysisTypeToTaskType } from "@/lib/workbench/analysisMapping";
import { getClientById, getClientName } from "@/lib/workbench/mockData";
import type { AnalysisType } from "@/lib/workbench/types";
import { ANALYSIS_TYPES } from "@/lib/workbench/types";

const BodySchema = z.object({
  clientId: z.string().min(1),
  documentIds: z.array(z.string()).default([]),
  analysisType: z.enum(ANALYSIS_TYPES as [AnalysisType, ...AnalysisType[]]),
  customPrompt: z.string().optional(),
  requestedMode: z.enum(AI_MODES).optional(),
});

export async function POST(req: Request) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const client = getClientById(body.clientId);
  if (!client) {
    return NextResponse.json({ error: "Client workspace not found" }, { status: 404 });
  }

  const taskType = analysisTypeToTaskType(body.analysisType);
  const userPrompt =
    body.analysisType === "Custom Prompt"
      ? (body.customPrompt?.trim() || "Provide a structured executive analysis.")
      : `Run a ${body.analysisType} for client "${client.name}" (${client.industry}).`;

  const systemPrompt = `You are a senior management consultant at Northline Intelligence.
Produce executive-ready analysis. Be concise, structured, and actionable.
Client: ${getClientName(body.clientId)}
Documents included: ${body.documentIds.length} selected (IDs: ${body.documentIds.join(", ") || "none"})
Analysis type: ${body.analysisType}`;

  console.info("[workbench/analysis]", {
    taskType,
    analysisType: body.analysisType,
    clientId: body.clientId,
    requestedMode: body.requestedMode ?? "default",
    promptLength: userPrompt.length,
  });

  // TODO: Inject retrieved chunks from Qdrant when RAG is available
  const result = await callModelRouter({
    prompt: userPrompt,
    taskType,
    requestedMode: body.requestedMode,
    clientId: body.clientId,
    systemPrompt,
  });

  // TODO: Persist output to Output Library (Prisma) + audit log entry
  return NextResponse.json({
    content: result.response,
    modelUsed: result.modelUsed,
    modeUsed: result.modeUsed,
    providerUsed: result.providerUsed,
    taskType: result.taskType,
    warnings: result.warnings,
  });
}
