export const EXECUTIVE_INSIGHTS_GENERATE_INSTRUCTIONS = [
  "Click the secure link below to open Executive Insights.",
  "Click Generate to create your organization's executive readout.",
] as const;

export const EXECUTIVE_INSIGHTS_SHARED_READOUT_NOTE =
  "After the first authorized executive generates the readout, every other Executive Insights viewer will see the same shared readout when they click Generate.";

export function executiveInsightsEmailIntro(assessmentLabel: string) {
  return `Your organization's ${assessmentLabel} is complete. Executive Insights are ready for review.`;
}
