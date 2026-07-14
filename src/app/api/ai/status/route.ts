import { NextResponse } from "next/server";
import { getAdminApiUser } from "@/lib/adminApiAuth";
import { getModelStatus, previewRouting } from "@/lib/ai/modelRouter";
import type { AiMode, TaskType } from "@/lib/ai/taskTypes";
import { AI_MODES, TASK_TYPES } from "@/lib/ai/taskTypes";

export async function GET(req: Request) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const taskTypeRaw = searchParams.get("taskType");
  const modeRaw = searchParams.get("requestedMode");

  const status = getModelStatus();
  let preview = null;

  if (
    taskTypeRaw &&
    TASK_TYPES.includes(taskTypeRaw as TaskType) &&
    (!modeRaw || AI_MODES.includes(modeRaw as AiMode))
  ) {
    preview = previewRouting(taskTypeRaw as TaskType, (modeRaw as AiMode) ?? status.defaultMode);
  }

  return NextResponse.json({ ...status, preview });
}
