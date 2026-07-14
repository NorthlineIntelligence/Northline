"use client";

import { useState } from "react";
import {
  NARRATIVE_ASSESSMENT_MODEL_NOTE,
  NARRATIVE_EXECUTIVE_SUMMARY_SYSTEM_EXCERPT,
  NARRATIVE_RISK_SYSTEM_EXCERPT,
  NARRATIVE_USER_PROMPT_TEMPLATE,
  PERCEPTION_ALIGNMENT_EXECUTIVE_NOTE,
} from "@/lib/workbench/narrativePrompts";
import { WbCard } from "./ui";
import { WORKBENCH_BRAND as WB } from "@/lib/workbench/theme";

export function NarrativePromptsPanel() {
  const [open, setOpen] = useState(false);

  return (
    <WbCard className="mt-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <div>
          <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: WB.greyBlue }}>
            Assessment narrative prompts (Executive Summary & Risk)
          </h2>
          <p className="mt-1 text-xs font-medium" style={{ color: WB.muted }}>
            Reference copy used when Executive Insights generates after assessment completion.
          </p>
        </div>
        <span className="text-sm font-black" style={{ color: WB.cyan }}>
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          <p className="text-sm font-medium" style={{ color: WB.muted }}>
            {NARRATIVE_ASSESSMENT_MODEL_NOTE}
          </p>

          <PromptBlock title="Executive summary & memo (system excerpt)" body={NARRATIVE_EXECUTIVE_SUMMARY_SYSTEM_EXCERPT} />
          <PromptBlock title="Risk review (system excerpt)" body={NARRATIVE_RISK_SYSTEM_EXCERPT} />
          <PromptBlock title="User prompt template" body={NARRATIVE_USER_PROMPT_TEMPLATE} />
          <PromptBlock title="Perception alignment bullet (verbatim when triggered)" body={PERCEPTION_ALIGNMENT_EXECUTIVE_NOTE} />
        </div>
      )}
    </WbCard>
  );
}

function PromptBlock({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="text-xs font-black uppercase tracking-wide" style={{ color: WB.greyBlue }}>
        {title}
      </h3>
      <pre
        className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border p-3 text-xs font-medium leading-relaxed"
        style={{ borderColor: WB.border, color: WB.dark, background: WB.surfaceMuted }}
      >
        {body}
      </pre>
    </div>
  );
}
