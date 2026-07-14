"use client";

import { useState } from "react";
import { AiProcessingModeToggle, type AiProcessingMode } from "@/components/priority-discovery/AiProcessingModeToggle";

export function AssessmentModuleFields() {
  const [module, setModule] = useState<"readiness" | "priority_discovery">("readiness");
  const [aiMode, setAiMode] = useState<AiProcessingMode>("executive");

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Assessment Module</label>
        <select
          name="assessment_kind"
          className="w-full rounded-lg border border-[#cdd8df] px-3 py-2 text-sm"
          value={module}
          onChange={(e) => setModule(e.target.value as "readiness" | "priority_discovery")}
        >
          <option value="readiness">AI Readiness Assessment</option>
          <option value="priority_discovery">AI Priority Discovery Assessment</option>
        </select>
        <p className="mt-2 text-xs text-[#66819e]">
          Priority Discovery identifies the highest-value AI and automation project opportunities.
        </p>
      </div>

      {module === "priority_discovery" ? (
        <AiProcessingModeToggle value={aiMode} onChange={setAiMode} inputName="ai_processing_mode" />
      ) : (
        <input type="hidden" name="ai_processing_mode" value="executive" />
      )}
    </div>
  );
}
