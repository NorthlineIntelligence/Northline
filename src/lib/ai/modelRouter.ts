/**
 * Multi-model routing for Northline private AI (Fast 7B vs Executive 24B).
 *
 * Architecture (future):
 * - Qdrant: document memory / RAG retrieval per client workspace
 * - Fast model: preprocess documents (extract, tag, chunk summaries)
 * - Executive model: synthesize final readouts, risk, 90-day plans
 * - RunPod / vLLM: cloud private inference via OpenAI-compatible APIs
 */

import {
  type AiMode,
  type ResolvedMode,
  type TaskType,
  chooseModelForTask,
  getDefaultAiMode,
} from "./taskTypes";

export type LlmProviderKind = "ollama" | "openai-compatible" | "mock";

export interface ModelSlotEnvConfig {
  provider: string | null;
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
}

export interface ModelRouterInput {
  prompt: string;
  taskType: TaskType;
  requestedMode?: AiMode;
  /** Future: enforce client-scoped RAG and audit; never mix client data */
  clientId?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ModelRouterResult {
  response: string;
  modelUsed: string;
  modeUsed: ResolvedMode;
  providerUsed: string;
  taskType: TaskType;
  warnings: string[];
}

export interface ModelStatusSnapshot {
  defaultMode: AiMode;
  fast: { configured: boolean; provider: string | null; model: string | null; endpointHost: string | null };
  executive: {
    configured: boolean;
    provider: string | null;
    model: string | null;
    endpointHost: string | null;
  };
  apiKeyPresent: { fast: boolean; executive: boolean };
}

const TEST_PROMPT =
  "Respond with one sentence confirming this model endpoint is working.";

function trimEnv(key: string): string | null {
  const v = process.env[key]?.trim();
  return v || null;
}

function hostFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] ?? null;
  }
}

export function getFastModelConfig(): ModelSlotEnvConfig {
  return {
    provider: trimEnv("FAST_LLM_PROVIDER"),
    baseUrl: trimEnv("FAST_LLM_BASE_URL"),
    model: trimEnv("FAST_LLM_MODEL"),
    apiKey: trimEnv("FAST_LLM_API_KEY"),
  };
}

export function getExecutiveModelConfig(): ModelSlotEnvConfig {
  return {
    provider: trimEnv("EXECUTIVE_LLM_PROVIDER"),
    baseUrl: trimEnv("EXECUTIVE_LLM_BASE_URL"),
    model: trimEnv("EXECUTIVE_LLM_MODEL"),
    apiKey: trimEnv("EXECUTIVE_LLM_API_KEY"),
  };
}

export function isSlotConfigured(slot: ModelSlotEnvConfig): boolean {
  return Boolean(slot.baseUrl && slot.model);
}

export function getModelStatus(): ModelStatusSnapshot {
  const fast = getFastModelConfig();
  const executive = getExecutiveModelConfig();
  return {
    defaultMode: getDefaultAiMode(),
    fast: {
      configured: isSlotConfigured(fast),
      provider: fast.provider,
      model: fast.model,
      endpointHost: hostFromUrl(fast.baseUrl),
    },
    executive: {
      configured: isSlotConfigured(executive),
      provider: executive.provider,
      model: executive.model,
      endpointHost: hostFromUrl(executive.baseUrl),
    },
    apiKeyPresent: {
      fast: Boolean(fast.apiKey),
      executive: Boolean(executive.apiKey),
    },
  };
}

export { chooseModelForTask, getDefaultAiMode };
export type { AiMode, TaskType } from "./taskTypes";

function normalizeProvider(provider: string | null): LlmProviderKind {
  const p = (provider ?? "").toLowerCase();
  if (p === "ollama") return "ollama";
  if (p === "mock" || !p) return "openai-compatible";
  return "openai-compatible";
}

function buildMockResponse(taskType: TaskType, mode: ResolvedMode): ModelRouterResult {
  return {
    response: `This is a mock AI response because no private model endpoint is configured.

Task: ${taskType}
Intended mode: ${mode}
Configure FAST_LLM_* (Ollama) and/or EXECUTIVE_LLM_* (RunPod/vLLM) in your environment, then use LLM Settings to test connectivity.`,
    modelUsed: "mock",
    modeUsed: "mock",
    providerUsed: "mock",
    taskType,
    warnings: ["No private model endpoint configured — mock mode active."],
  };
}

function combinePrompt(systemPrompt: string | undefined, prompt: string): string {
  if (!systemPrompt?.trim()) return prompt;
  return `${systemPrompt.trim()}\n\n---\n\n${prompt}`;
}

async function callOllamaGenerate(
  config: ModelSlotEnvConfig,
  fullPrompt: string,
  temperature: number
): Promise<{ content: string; model: string }> {
  const base = config.baseUrl!.replace(/\/$/, "");
  const url = `${base}/api/generate`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      prompt: fullPrompt,
      stream: false,
      options: { temperature },
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Ollama request failed (${res.status}): ${errText.slice(0, 400)}`);
  }
  const data = (await res.json()) as { response?: string; model?: string };
  return {
    content: (data.response ?? "").trim() || "Empty response from Ollama.",
    model: data.model ?? config.model!,
  };
}

async function callOpenAiCompatible(
  config: ModelSlotEnvConfig,
  fullPrompt: string,
  temperature: number,
  maxTokens: number
): Promise<{ content: string; model: string }> {
  const base = config.baseUrl!.replace(/\/$/, "");
  let url = base;
  if (base.endsWith("/v1/chat/completions")) {
    url = base;
  } else if (base.endsWith("/v1")) {
    url = `${base}/chat/completions`;
  } else if (base.includes("/chat/completions")) {
    url = base;
  } else {
    url = `${base}/v1/chat/completions`;
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "user", content: fullPrompt }],
      temperature,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Chat completions failed (${res.status}): ${errText.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
  };
  return {
    content:
      data.choices?.[0]?.message?.content?.trim() || "No content returned from endpoint.",
    model: data.model ?? config.model!,
  };
}

async function invokeSlot(
  config: ModelSlotEnvConfig,
  prompt: string,
  systemPrompt: string | undefined,
  options: { temperature?: number; maxTokens?: number }
): Promise<{ content: string; model: string; provider: string }> {
  const temperature = options.temperature ?? 0.2;
  const maxTokens = options.maxTokens ?? 2048;
  const fullPrompt = combinePrompt(systemPrompt, prompt);
  const kind = normalizeProvider(config.provider);

  if (kind === "ollama") {
    const out = await callOllamaGenerate(config, fullPrompt, temperature);
    return { ...out, provider: "ollama" };
  }
  const out = await callOpenAiCompatible(config, fullPrompt, temperature, maxTokens);
  return { ...out, provider: config.provider ?? "openai-compatible" };
}

export async function callFastModel(
  prompt: string,
  options?: {
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    clientId?: string;
  }
): Promise<ModelRouterResult> {
  const config = getFastModelConfig();
  if (!isSlotConfigured(config)) {
    return buildMockResponse("document_summary", "mock");
  }
  try {
    const out = await invokeSlot(config, prompt, options?.systemPrompt, options ?? {});
    return {
      response: out.content,
      modelUsed: out.model,
      modeUsed: "fast",
      providerUsed: out.provider,
      taskType: "document_summary",
      warnings: [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      response: `Fast model error: ${message}`,
      modelUsed: config.model ?? "unknown",
      modeUsed: "fast",
      providerUsed: config.provider ?? "ollama",
      taskType: "document_summary",
      warnings: [message],
    };
  }
}

export async function callExecutiveModel(
  prompt: string,
  options?: {
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    clientId?: string;
  }
): Promise<ModelRouterResult> {
  const config = getExecutiveModelConfig();
  if (!isSlotConfigured(config)) {
    return buildMockResponse("executive_summary", "mock");
  }
  try {
    const out = await invokeSlot(config, prompt, options?.systemPrompt, options ?? {});
    return {
      response: out.content,
      modelUsed: out.model,
      modeUsed: "executive",
      providerUsed: out.provider,
      taskType: "executive_summary",
      warnings: [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      response: `Executive model error: ${message}`,
      modelUsed: config.model ?? "unknown",
      modeUsed: "executive",
      providerUsed: config.provider ?? "runpod",
      taskType: "executive_summary",
      warnings: [message],
    };
  }
}

export async function callModelRouter(input: ModelRouterInput): Promise<ModelRouterResult> {
  const requestedMode = input.requestedMode ?? getDefaultAiMode();
  const targetSlot = chooseModelForTask(input.taskType, requestedMode);
  const warnings: string[] = [];

  let slot: "fast" | "executive" = targetSlot;
  let config = slot === "fast" ? getFastModelConfig() : getExecutiveModelConfig();

  if (slot === "executive" && !isSlotConfigured(config)) {
    warnings.push(
      "Executive model not configured (EXECUTIVE_LLM_BASE_URL / EXECUTIVE_LLM_MODEL). Falling back to Fast model."
    );
    slot = "fast";
    config = getFastModelConfig();
  }

  if (!isSlotConfigured(config)) {
    const mock = buildMockResponse(input.taskType, "mock");
    mock.warnings = [...warnings, ...mock.warnings];
    return mock;
  }

  try {
    const out = await invokeSlot(config, input.prompt, input.systemPrompt, {
      temperature: input.temperature,
      maxTokens: input.maxTokens,
    });
    return {
      response: out.content,
      modelUsed: out.model,
      modeUsed: slot,
      providerUsed: out.provider,
      taskType: input.taskType,
      warnings,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      response: `Model router error (${slot}): ${message}`,
      modelUsed: config.model ?? "unknown",
      modeUsed: slot,
      providerUsed: config.provider ?? "unknown",
      taskType: input.taskType,
      warnings: [...warnings, message],
    };
  }
}

export async function testFastModelConnection(): Promise<{
  ok: boolean;
  message: string;
  modeUsed: ResolvedMode;
}> {
  const result = await callFastModel(TEST_PROMPT);
  const ok =
    result.modeUsed !== "mock" &&
    !result.response.startsWith("Fast model error") &&
    !result.response.startsWith("This is a mock");
  return {
    ok,
    message: ok
      ? `Fast model OK (${result.modelUsed} via ${result.providerUsed}). ${result.response.slice(0, 120)}`
      : result.response,
    modeUsed: result.modeUsed,
  };
}

export async function testExecutiveModelConnection(): Promise<{
  ok: boolean;
  message: string;
  modeUsed: ResolvedMode;
}> {
  const result = await callExecutiveModel(TEST_PROMPT);
  const ok =
    result.modeUsed !== "mock" &&
    !result.response.startsWith("Executive model error") &&
    !result.response.startsWith("This is a mock");
  return {
    ok,
    message: ok
      ? `Executive model OK (${result.modelUsed} via ${result.providerUsed}). ${result.response.slice(0, 120)}`
      : result.response,
    modeUsed: result.modeUsed,
  };
}

/** Resolve which model would run for a task (no inference). */
export function previewRouting(
  taskType: TaskType,
  requestedMode: AiMode
): {
  resolvedSlot: "fast" | "executive";
  modeUsed: ResolvedMode;
  modelName: string | null;
  provider: string | null;
  configured: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  let slot = chooseModelForTask(taskType, requestedMode);
  let config = slot === "fast" ? getFastModelConfig() : getExecutiveModelConfig();

  if (slot === "executive" && !isSlotConfigured(config)) {
    warnings.push("Executive endpoint not configured — would fall back to Fast.");
    slot = "fast";
    config = getFastModelConfig();
  }

  if (!isSlotConfigured(config)) {
    return {
      resolvedSlot: slot,
      modeUsed: "mock",
      modelName: null,
      provider: null,
      configured: false,
      warnings: [...warnings, "No endpoint configured — mock mode."],
    };
  }

  return {
    resolvedSlot: slot,
    modeUsed: slot,
    modelName: config.model,
    provider: config.provider,
    configured: true,
    warnings,
  };
}
