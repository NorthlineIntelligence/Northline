export type RiskBrief = {
    signal: string;
    meaning: string;
    focus: string;
  };
  
  export function briefForRiskFlag(rf: any): RiskBrief {
    const rule = typeof rf?.details?.rule === "string" ? rf.details.rule : "";
    const title = typeof rf?.title === "string" ? rf.title : "";
  
    // ✅ Exact rule matches (deterministic)
    if (rule === "any pillar < 2.0") {
      return {
        signal: "Minimum pillar threshold triggered",
        meaning:
          "One or more pillars are below the minimum readiness threshold. The overall index is intentionally constrained to prevent false confidence.",
        focus:
          "Address the lowest-scoring pillar with one concrete structural move (clarify owner, cadence, and definition of ‘done’).",
      };
    }
  
    if (rule === "variance (max-min) > 1.5") {
      return {
        signal: "Pillar imbalance detected",
        meaning:
          "Strength is uneven across pillars. This often creates friction: execution depends on the weak pillar, not the strong one.",
        focus:
          "Stabilize the lowest pillar first. Aim for a balanced baseline before pushing for speed or scale.",
      };
    }
  
    // Secondary deterministic inference (shape-based)
    const hasPillarArray = Array.isArray(rf?.details?.pillars) && rf.details.pillars.length > 0;
    if (hasPillarArray) {
      return {
        signal: "Minimum pillar threshold triggered",
        meaning:
          "One or more pillars are below the minimum readiness threshold. The overall index is intentionally constrained to prevent false confidence.",
        focus:
          "Address the lowest-scoring pillar with one concrete structural move (clarify owner, cadence, and definition of ‘done’).",
      };
    }
  
    // Fallback
    return {
      signal: title || "Structural risk signal detected",
      meaning:
        "A protective rule was triggered based on the current inputs. This is a signal to focus attention—not a judgement or failure state.",
      focus:
        "Review the trigger evidence and choose one stabilizing action that reduces uncertainty or strengthens ownership.",
    };
  }