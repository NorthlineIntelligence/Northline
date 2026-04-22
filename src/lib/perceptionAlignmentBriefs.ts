/** Card copy for perception & alignment signals (non-accusatory, executive tone). */

export type PerceptionBrief = { signal: string; meaning: string; focus: string };

export function briefForPerceptionSignal(s: {
  key?: string;
  title?: string;
  summary?: string;
  guidance?: string;
}): PerceptionBrief {
  return {
    signal: String(s.title ?? "Perception signal"),
    meaning: String(
      s.summary ??
        "This pattern is uncommon in multi-dimensional environments and can be an opportunity to strengthen validation before scaling AI."
    ),
    focus: String(
      s.guidance ??
        "Consider lightweight cross-functional review, operational sampling, or facilitated alignment—not to challenge scores, but to reinforce execution quality."
    ),
  };
}
