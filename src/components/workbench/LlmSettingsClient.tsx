"use client";

import { useState } from "react";
import type { ModelStatusSnapshot } from "@/lib/ai/modelRouter";
import { NarrativePromptsPanel } from "./NarrativePromptsPanel";
import { WbButton, WbCard, StatusPill } from "./ui";
import { WORKBENCH_BRAND as WB } from "@/lib/workbench/theme";

function ModelSlotCard({
  title,
  subtitle,
  slot,
  apiKeyPresent,
  envKeys,
  testLabel,
  testPath,
}: {
  title: string;
  subtitle: string;
  slot: ModelStatusSnapshot["fast"];
  apiKeyPresent: boolean;
  envKeys: string[];
  testLabel: string;
  testPath: string;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(testPath, { method: "POST", credentials: "include" });
      const data = (await res.json()) as { ok: boolean; message: string };
      setTestResult(data.message);
    } catch {
      setTestResult("Connection test failed.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <WbCard>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: WB.greyBlue }}>
          {title}
        </h2>
        <StatusPill
          label={slot.configured ? "Configured" : "Not configured"}
          tone={slot.configured ? "success" : "warning"}
        />
      </div>
      <p className="mt-2 text-sm font-medium" style={{ color: WB.muted }}>
        {subtitle}
      </p>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-[10px] font-black uppercase tracking-wide" style={{ color: WB.greyBlue }}>
            Provider
          </dt>
          <dd className="font-semibold" style={{ color: WB.dark }}>
            {slot.provider ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-black uppercase tracking-wide" style={{ color: WB.greyBlue }}>
            Model name
          </dt>
          <dd className="font-semibold" style={{ color: WB.dark }}>
            {slot.model ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-black uppercase tracking-wide" style={{ color: WB.greyBlue }}>
            Base URL host
          </dt>
          <dd className="font-mono text-xs font-medium" style={{ color: WB.muted }}>
            {slot.endpointHost ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-black uppercase tracking-wide" style={{ color: WB.greyBlue }}>
            API key
          </dt>
          <dd className="font-semibold" style={{ color: WB.dark }}>
            {apiKeyPresent ? "Present (server env)" : "Not set"}
          </dd>
        </div>
      </dl>

      <ul className="mt-4 space-y-1 font-mono text-[11px]" style={{ color: WB.muted }}>
        {envKeys.map((k) => (
          <li key={k}>{k}</li>
        ))}
      </ul>

      <div className="mt-4">
        <WbButton variant="primary" onClick={runTest} disabled={testing}>
          {testing ? "Testing…" : testLabel}
        </WbButton>
      </div>
      {testResult && (
        <p
          className="mt-3 rounded-xl px-3 py-2 text-sm font-medium"
          style={{ background: WB.surfaceMuted, color: WB.dark }}
        >
          {testResult}
        </p>
      )}
    </WbCard>
  );
}

export function LlmSettingsClient({ status }: { status: ModelStatusSnapshot }) {
  return (
    <div className="space-y-6">
      <WbCard>
        <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: WB.greyBlue }}>
          Routing overview
        </h2>
        <p className="mt-2 text-sm font-medium leading-relaxed" style={{ color: WB.muted }}>
          Fast model (Mistral 7B / Ollama) handles extraction, tagging, and quick summaries. Executive model
          (Mistral Small 24B / RunPod) handles strategic synthesis and final readouts. Default mode:{" "}
          <strong>{status.defaultMode}</strong>. OpenAI and Anthropic remain in use for assessment Executive
          Insights narratives.
        </p>
        <p className="mt-2 text-xs font-medium" style={{ color: WB.muted }}>
          Values are loaded from server environment only — never exposed to the browser.
        </p>
      </WbCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ModelSlotCard
          title="Fast model settings"
          subtitle="Mistral 7B — document cleanup, extraction, tagging, quick summaries."
          slot={status.fast}
          apiKeyPresent={status.apiKeyPresent.fast}
          envKeys={[
            "FAST_LLM_PROVIDER",
            "FAST_LLM_BASE_URL",
            "FAST_LLM_MODEL",
            "FAST_LLM_API_KEY",
          ]}
          testLabel="Test fast model"
          testPath="/api/ai/test/fast"
        />
        <ModelSlotCard
          title="Executive model settings"
          subtitle="Mistral Small 3.2 24B — executive summaries, risk, roadmaps, implementation plans."
          slot={status.executive}
          apiKeyPresent={status.apiKeyPresent.executive}
          envKeys={[
            "EXECUTIVE_LLM_PROVIDER",
            "EXECUTIVE_LLM_BASE_URL",
            "EXECUTIVE_LLM_MODEL",
            "EXECUTIVE_LLM_API_KEY",
          ]}
          testLabel="Test executive model"
          testPath="/api/ai/test/executive"
        />
      </div>

      <WbCard>
        <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: WB.greyBlue }}>
          Global
        </h2>
        <p className="mt-2 font-mono text-xs" style={{ color: WB.muted }}>
          DEFAULT_AI_MODE={status.defaultMode}
        </p>
        <p className="mt-3 text-sm font-medium" style={{ color: WB.muted }}>
          POST /api/ai/route — generic router for taskType + requestedMode. Workbench analysis uses the same
          router via /api/admin/workbench/analysis/run.
        </p>
      </WbCard>

      <NarrativePromptsPanel />
    </div>
  );
}
