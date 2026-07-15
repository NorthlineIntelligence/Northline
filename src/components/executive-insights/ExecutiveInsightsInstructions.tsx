import {
  EXECUTIVE_INSIGHTS_GENERATE_INSTRUCTIONS,
  EXECUTIVE_INSIGHTS_SHARED_READOUT_NOTE,
} from "@/lib/executiveInsightsCopy";

export function ExecutiveInsightsInstructions(props: { compact?: boolean }) {
  return (
    <div
      className={props.compact ? "rounded-xl border border-[#cdd8df] bg-[#f6f8fc] p-4" : "rounded-2xl border border-[#cdd8df] bg-[#f6f8fc] p-5"}
    >
      <div className="text-sm font-semibold text-[#173464]">Instructions</div>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-[#173464]">
        {EXECUTIVE_INSIGHTS_GENERATE_INSTRUCTIONS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-[#66819e]">{EXECUTIVE_INSIGHTS_SHARED_READOUT_NOTE}</p>
    </div>
  );
}
