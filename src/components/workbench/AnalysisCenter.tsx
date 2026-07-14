"use client";

import { useMemo, useState } from "react";
import type { AiMode } from "@/lib/ai/taskTypes";
import { ANALYSIS_TYPES } from "@/lib/workbench/types";
import { analysisTypeToTaskType } from "@/lib/workbench/analysisMapping";
import { MOCK_CLIENTS, MOCK_DOCUMENTS } from "@/lib/workbench/mockData";
import { ModelStatusCard } from "./ModelStatusCard";
import { NarrativePromptsPanel } from "./NarrativePromptsPanel";
import { WbButton, WbCard, StatusPill } from "./ui";
import { WORKBENCH_BRAND as WB } from "@/lib/workbench/theme";

const AI_MODE_OPTIONS: { value: AiMode; label: string; hint: string }[] = [
  {
    value: "auto",
    label: "Auto Select",
    hint: "Northline chooses the right model based on task type.",
  },
  {
    value: "fast",
    label: "Fast Processing 7B",
    hint: "Lower cost, faster — best for document prep and early analysis.",
  },
  {
    value: "executive",
    label: "Executive Deep Dive 24B",
    hint: "Stronger reasoning — best for final summaries and strategic readouts.",
  },
];

export function AnalysisCenter() {
  const [clientId, setClientId] = useState(MOCK_CLIENTS[0]?.id ?? "");
  const [docIds, setDocIds] = useState<string[]>([]);
  const [analysisType, setAnalysisType] = useState(ANALYSIS_TYPES[0]);
  const [requestedMode, setRequestedMode] = useState<AiMode>("auto");
  const [customPrompt, setCustomPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    modelUsed?: string;
    modeUsed?: string;
    warnings?: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const taskType = useMemo(() => analysisTypeToTaskType(analysisType), [analysisType]);
  const clientDocs = MOCK_DOCUMENTS.filter((d) => d.clientId === clientId);

  const toggleDoc = (id: string) => {
    setDocIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const runAnalysis = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    setMeta(null);
    try {
      const res = await fetch("/api/admin/workbench/analysis/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          clientId,
          documentIds: docIds,
          analysisType,
          requestedMode,
          customPrompt: analysisType === "Custom Prompt" ? customPrompt : undefined,
        }),
      });
      const data = (await res.json()) as {
        content?: string;
        error?: string;
        modelUsed?: string;
        modeUsed?: string;
        warnings?: string[];
      };
      if (!res.ok) throw new Error(data.error ?? "Analysis failed");
      setResult(data.content ?? "No response");
      setMeta({
        modelUsed: data.modelUsed,
        modeUsed: data.modeUsed,
        warnings: data.warnings,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <WbCard className="lg:col-span-2">
          <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: WB.greyBlue }}>
            Configure analysis
          </h2>

          <fieldset className="mt-4">
            <legend className="text-xs font-black uppercase tracking-wide" style={{ color: WB.greyBlue }}>
              AI mode
            </legend>
            <div className="mt-2 space-y-2">
              {AI_MODE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer gap-3 rounded-xl border px-3 py-2.5"
                  style={{
                    borderColor: requestedMode === opt.value ? WB.cyan : WB.border,
                    background: requestedMode === opt.value ? WB.accentMuted : "transparent",
                  }}
                >
                  <input
                    type="radio"
                    name="aiMode"
                    value={opt.value}
                    checked={requestedMode === opt.value}
                    onChange={() => setRequestedMode(opt.value)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-black" style={{ color: WB.dark }}>
                      {opt.label}
                    </span>
                    <span className="block text-xs font-medium" style={{ color: WB.muted }}>
                      {opt.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="mt-4 block text-xs font-black uppercase tracking-wide" style={{ color: WB.greyBlue }}>
            Client workspace
            <select
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-semibold"
              style={{ borderColor: WB.border, color: WB.dark }}
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setDocIds([]);
              }}
            >
              {MOCK_CLIENTS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-4">
            <span className="text-xs font-black uppercase tracking-wide" style={{ color: WB.greyBlue }}>
              Documents to include
            </span>
            <ul className="mt-2 space-y-2">
              {clientDocs.length === 0 ? (
                <li className="text-sm font-medium" style={{ color: WB.muted }}>
                  No documents for this client.
                </li>
              ) : (
                clientDocs.map((d) => (
                  <li key={d.id}>
                    <label
                      className="flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium"
                      style={{ borderColor: WB.border }}
                    >
                      <input
                        type="checkbox"
                        checked={docIds.includes(d.id)}
                        onChange={() => toggleDoc(d.id)}
                      />
                      <span style={{ color: WB.dark }}>{d.name}</span>
                      <StatusPill
                        label={d.processingStatus}
                        tone={d.processingStatus === "Indexed" ? "success" : "neutral"}
                      />
                    </label>
                  </li>
                ))
              )}
            </ul>
          </div>

          <label className="mt-4 block text-xs font-black uppercase tracking-wide" style={{ color: WB.greyBlue }}>
            Analysis type
            <select
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-semibold"
              style={{ borderColor: WB.border, color: WB.dark }}
              value={analysisType}
              onChange={(e) => setAnalysisType(e.target.value as typeof analysisType)}
            >
              {ANALYSIS_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          {analysisType === "Custom Prompt" && (
            <label className="mt-4 block text-xs font-black uppercase tracking-wide" style={{ color: WB.greyBlue }}>
              Custom instructions
              <textarea
                className="mt-1 min-h-[120px] w-full rounded-xl border px-3 py-2 text-sm font-medium"
                style={{ borderColor: WB.border, color: WB.dark }}
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Describe the analysis objective, audience, and constraints…"
              />
            </label>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <WbButton variant="primary" onClick={runAnalysis} disabled={running}>
              {running ? "Running analysis…" : "Run analysis"}
            </WbButton>
          </div>
        </WbCard>

        <ModelStatusCard taskType={taskType} requestedMode={requestedMode} />
      </div>

      <WbCard>
        <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: WB.greyBlue }}>
          Output preview
        </h2>
        <p className="mt-1 text-xs font-medium" style={{ color: WB.muted }}>
          Results save to Output Library when persistence is connected.
        </p>
        {meta && (
          <p className="mt-2 text-xs font-medium" style={{ color: WB.greyBlue }}>
            {meta.modeUsed} mode · {meta.modelUsed}
            {meta.warnings?.length ? ` · ${meta.warnings.join(" ")}` : ""}
          </p>
        )}
        {error && (
          <p
            className="mt-4 rounded-xl px-3 py-2 text-sm font-medium"
            style={{ background: "#fef3f2", color: WB.danger }}
          >
            {error}
          </p>
        )}
        {result ? (
          <pre
            className="mt-4 max-h-[480px] overflow-auto whitespace-pre-wrap rounded-xl border p-4 text-sm font-medium leading-relaxed"
            style={{ borderColor: WB.border, color: WB.dark, background: WB.surfaceMuted }}
          >
            {result}
          </pre>
        ) : (
          <p className="mt-6 text-sm font-medium" style={{ color: WB.muted }}>
            Run an analysis to preview executive-ready content.
          </p>
        )}
      </WbCard>

      <NarrativePromptsPanel />
    </div>
  );
}
