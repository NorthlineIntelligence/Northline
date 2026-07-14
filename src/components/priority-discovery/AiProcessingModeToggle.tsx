"use client";

import { NORTHLINE_BRAND as BRAND } from "@/lib/northlineBrand";

export type AiProcessingMode = "fast" | "executive";

const OPTIONS: Array<{ value: AiProcessingMode; label: string; hint: string }> = [
  {
    value: "fast",
    label: "Fast Processing",
    hint: "Lower latency and cost. Best for quicker drafts and early review cycles.",
  },
  {
    value: "executive",
    label: "Executive Deep Dive",
    hint: "Stronger reasoning for final executive readouts and client delivery.",
  },
];

type AiProcessingModeToggleProps = {
  value: AiProcessingMode;
  onChange: (value: AiProcessingMode) => void;
  disabled?: boolean;
  inputName?: string;
};

export function AiProcessingModeToggle(props: AiProcessingModeToggleProps) {
  return (
    <div>
      <div className="text-sm font-medium" style={{ color: BRAND.dark }}>
        AI Processing Mode
      </div>
      <p className="mt-1 text-xs" style={{ color: BRAND.greyBlue }}>
        Choose which private Northline model runs when this assessment generates its executive readout.
      </p>
      <input type="hidden" name={props.inputName} value={props.value} />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {OPTIONS.map((option) => {
          const selected = props.value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={props.disabled}
              onClick={() => props.onChange(option.value)}
              className="rounded-xl border px-4 py-3 text-left transition"
              style={{
                borderColor: selected ? BRAND.cyan : BRAND.border,
                background: selected ? "#E8F7F8" : "#FFFFFF",
                opacity: props.disabled ? 0.6 : 1,
                cursor: props.disabled ? "not-allowed" : "pointer",
              }}
            >
              <div className="text-sm font-semibold" style={{ color: BRAND.dark }}>
                {option.label}
              </div>
              <div className="mt-1 text-xs leading-5" style={{ color: BRAND.greyBlue }}>
                {option.hint}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
