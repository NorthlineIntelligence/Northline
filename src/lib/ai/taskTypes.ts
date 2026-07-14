/** Task types for private model routing (Fast 7B vs Executive 24B). */

export const TASK_TYPES = [
  "document_extraction",
  "document_summary",
  "note_cleanup",
  "tagging",
  "assessment_analysis",
  "executive_summary",
  "risk_review",
  "workflow_gap_analysis",
  "opportunity_roadmap",
  "implementation_plan",
  "custom_prompt",
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

export const AI_MODES = ["auto", "fast", "executive"] as const;
export type AiMode = (typeof AI_MODES)[number];
export type ResolvedMode = "fast" | "executive" | "mock";

const EXECUTIVE_TASKS = new Set<TaskType>([
  "executive_summary",
  "risk_review",
  "workflow_gap_analysis",
  "opportunity_roadmap",
  "implementation_plan",
  "assessment_analysis",
  "custom_prompt",
]);

const FAST_TASKS = new Set<TaskType>([
  "document_extraction",
  "document_summary",
  "note_cleanup",
  "tagging",
]);

export function chooseModelForTask(taskType: TaskType, requestedMode: AiMode): "fast" | "executive" {
  if (requestedMode === "fast") return "fast";
  if (requestedMode === "executive") return "executive";
  if (EXECUTIVE_TASKS.has(taskType)) return "executive";
  if (FAST_TASKS.has(taskType)) return "fast";
  return "executive";
}

export function getDefaultAiMode(): AiMode {
  const raw = (process.env.DEFAULT_AI_MODE ?? "auto").trim().toLowerCase();
  if (raw === "fast" || raw === "executive") return raw;
  return "auto";
}
