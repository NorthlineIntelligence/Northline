import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminApiUser } from "@/lib/adminApiAuth";
import { callModelRouter } from "@/lib/ai/modelRouter";
import { AI_MODES, TASK_TYPES } from "@/lib/ai/taskTypes";

const BodySchema = z.object({
  prompt: z.string().min(1).max(120_000),
  taskType: z.enum(TASK_TYPES),
  requestedMode: z.enum(AI_MODES).optional(),
  clientId: z.string().optional(),
  systemPrompt: z.string().max(32_000).optional(),
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

  // Metadata-only log — do not log full proprietary prompts
  console.info("[ai/route]", {
    taskType: body.taskType,
    requestedMode: body.requestedMode ?? "default",
    clientId: body.clientId ?? null,
    promptLength: body.prompt.length,
    user: auth.email,
  });

  const result = await callModelRouter({
    prompt: body.prompt,
    taskType: body.taskType,
    requestedMode: body.requestedMode,
    clientId: body.clientId,
    systemPrompt: body.systemPrompt,
  });

  return NextResponse.json({
    response: result.response,
    modelUsed: result.modelUsed,
    modeUsed: result.modeUsed,
    providerUsed: result.providerUsed,
    taskType: result.taskType,
    warnings: result.warnings,
  });
}
