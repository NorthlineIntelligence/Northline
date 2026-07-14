"use client";

import { useCallback, useEffect, useState } from "react";
import type { AiMode, TaskType } from "@/lib/ai/taskTypes";
import { WbCard, StatusPill } from "./ui";
import { WORKBENCH_BRAND as WB } from "@/lib/workbench/theme";

type StatusPayload = {
  defaultMode: AiMode;
  fast: { configured: boolean; provider: string | null; model: string | null; endpointHost: string | null };
  executive: {
    configured: boolean;
    provider: string | null;
    model: string | null;
    endpointHost: string | null;
  };
  preview: {
    resolvedSlot: string;
    modeUsed: string;
    modelName: string | null;
    provider: string | null;
    configured: boolean;
    warnings: string[];
  } | null;
};

const MODE_LABELS: Record<AiMode, string> = {
  auto: "Auto Select",
  fast: "Fast Processing 7B",
  executive: "Executive Deep Dive 24B",
};

export function ModelStatusCard({
  taskType,
  requestedMode,
}: {
  taskType: TaskType;
  requestedMode: AiMode;
}) {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ taskType, requestedMode });
      const res = await fetch(`/api/ai/status?${qs}`, { credentials: "include" });
      if (res.ok) setStatus((await res.json()) as StatusPayload);
    } finally {
      setLoading(false);
    }
  }, [taskType, requestedMode]);

  useEffect(() => {
    load();
  }, [load]);

  const preview = status?.preview;

  return (
    <WbCard padding="p-4">
      <h3 className="text-xs font-black uppercase tracking-wider" style={{ color: WB.greyBlue }}>
        Model status
      </h3>
      {loading ? (
        <p className="mt-2 text-sm font-medium" style={{ color: WB.muted }}>
          Loading…
        </p>
      ) : status ? (
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <dt className="font-black uppercase text-[10px] tracking-wide" style={{ color: WB.greyBlue }}>
              Selected mode
            </dt>
            <dd>
              <StatusPill label={MODE_LABELS[requestedMode]} tone="accent" />
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-black uppercase tracking-wide" style={{ color: WB.greyBlue }}>
              Task type
            </dt>
            <dd className="font-mono text-xs font-medium" style={{ color: WB.dark }}>
              {taskType}
            </dd>
          </div>
          {preview && (
            <div>
              <dt className="text-[10px] font-black uppercase tracking-wide" style={{ color: WB.greyBlue }}>
                Will use
              </dt>
              <dd className="font-medium" style={{ color: WB.dark }}>
                {preview.modeUsed === "mock"
                  ? "Mock (no endpoint)"
                  : `${preview.modeUsed} · ${preview.modelName ?? "—"} (${preview.provider ?? "—"})`}
              </dd>
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <StatusPill
              label={status.fast.configured ? `Ollama: ${status.fast.endpointHost ?? "ok"}` : "Ollama: not set"}
              tone={status.fast.configured ? "success" : "warning"}
            />
            <StatusPill
              label={
                status.executive.configured
                  ? `RunPod: ${status.executive.endpointHost ?? "ok"}`
                  : "RunPod: not set"
              }
              tone={status.executive.configured ? "success" : "neutral"}
            />
          </div>
          {preview?.warnings?.map((w) => (
            <p key={w} className="text-xs font-medium" style={{ color: WB.muted }}>
              {w}
            </p>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-sm font-medium" style={{ color: WB.muted }}>
          Status unavailable.
        </p>
      )}
    </WbCard>
  );
}
