/**
 * Turns verbose AI project scope JSON into a compact "what we will do" readout for quoting.
 * Uses structured fields (expectedOutcomes, timeline, phases) and short extracts from prose.
 */

export type SimplifiedQuoteProject = {
  name: string;
  /** Concrete outcomes — primary basis for quote line descriptions */
  deliverables: string[];
  /** Short extract of scopeOfWork (boundaries / in-scope work) */
  scopeInBrief: string;
  /** Short extract of objectives */
  objectivesBrief: string;
  timelineLabel: string;
  phaseHighlights: string[];
  costBand: string | null;
  /** Single block used in CRM + quote work items */
  quoteBasisText: string;
};

export type SimplifiedScopeForQuote = {
  /** Short executive context (not the full memo) */
  executiveBrief: string;
  projects: SimplifiedQuoteProject[];
};

function cleanStr(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

/** First N sentences up to maxChars. */
export function takeFirstSentences(text: string, maxSentences: number, maxChars: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return "";
  const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  let out = "";
  let n = 0;
  for (const part of parts) {
    if (n >= maxSentences) break;
    const next = out ? `${out} ${part}` : part;
    if (next.length > maxChars) {
      if (!out) return part.slice(0, maxChars);
      break;
    }
    out = next;
    n++;
  }
  if (!out) return t.slice(0, maxChars);
  return out.slice(0, maxChars);
}

function firstBlock(text: string, maxChars: number): string {
  const t = text.trim();
  if (!t) return "";
  const first = (t.split(/\n\s*\n/)[0] ?? t).trim();
  return first.slice(0, maxChars);
}

function asStringArray(v: unknown, maxItems: number, itemMax: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = cleanStr(x, itemMax);
    if (s) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function parseProject(raw: unknown, index: number): SimplifiedQuoteProject {
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const name =
    cleanStr(p.name, 400) || `Initiative ${index + 1}`;

  const deliverables = asStringArray(p.expectedOutcomes, 8, 320);

  const scopeFull = cleanStr(p.scopeOfWork, 12000);
  const scopeInBrief =
    deliverables.length >= 2
      ? takeFirstSentences(scopeFull, 3, 560)
      : takeFirstSentences(scopeFull, 5, 720);

  const objectivesFull = cleanStr(p.objectives, 8000);
  const objectivesBrief = takeFirstSentences(objectivesFull, 3, 420);

  const timeline = p.timeline && typeof p.timeline === "object" ? (p.timeline as Record<string, unknown>) : {};
  const timelineLabel = cleanStr(timeline.displayLabel, 280);

  const phasesRaw = Array.isArray(p.timelinePhases) ? p.timelinePhases : [];
  const phaseHighlights: string[] = [];
  for (const ph of phasesRaw) {
    if (!ph || typeof ph !== "object") continue;
    const o = ph as Record<string, unknown>;
    const label = cleanStr(o.label, 140);
    const dur = cleanStr(o.durationLabel, 160);
    if (label && dur) phaseHighlights.push(`${label} (${dur})`);
    else if (label) phaseHighlights.push(label);
    if (phaseHighlights.length >= 5) break;
  }

  const costRaw = p.costEstimate;
  const costBand =
    typeof costRaw === "string" && costRaw.trim()
      ? costRaw.trim().toLowerCase()
      : typeof costRaw === "number"
        ? String(costRaw)
        : null;

  const risks = asStringArray(p.risksAndBarriers, 4, 200);
  const quoteParts: string[] = [];

  if (deliverables.length) {
    quoteParts.push("What we will deliver:", ...deliverables.map((d) => `• ${d}`));
  }

  if (scopeInBrief) {
    quoteParts.push("", "Scope of work (summary):", scopeInBrief);
  } else if (firstBlock(scopeFull, 500)) {
    quoteParts.push("", "Scope of work (summary):", firstBlock(scopeFull, 500));
  }

  if (objectivesBrief) {
    quoteParts.push("", "Objectives:", objectivesBrief);
  }

  if (timelineLabel) {
    quoteParts.push("", `Timeline: ${timelineLabel}`);
  }

  if (phaseHighlights.length) {
    quoteParts.push("", `Phases: ${phaseHighlights.join("; ")}`);
  }

  if (costBand) {
    quoteParts.push("", `Investment band (indicative): ${costBand}`);
  }

  if (risks.length && deliverables.length < 2) {
    quoteParts.push("", "Key risks to plan for:", ...risks.map((r) => `• ${r}`));
  }

  const quoteBasisText = quoteParts.join("\n").trim().slice(0, 4000);

  return {
    name,
    deliverables,
    scopeInBrief,
    objectivesBrief,
    timelineLabel,
    phaseHighlights,
    costBand,
    quoteBasisText: quoteBasisText || name,
  };
}

/**
 * From raw AssessmentProjectScope.scope_json (or snapshot).
 */
export function simplifyScopeJsonForQuote(scopeJson: unknown): SimplifiedScopeForQuote {
  const doc = scopeJson && typeof scopeJson === "object" ? (scopeJson as Record<string, unknown>) : {};
  const readiness = doc.readiness && typeof doc.readiness === "object" ? (doc.readiness as Record<string, unknown>) : {};
  const memoFull = cleanStr(readiness.executiveMemo, 12000);

  const stabilizers = asStringArray(readiness.stabilizeFirstAccelerators, 6, 280);
  let executiveBrief = takeFirstSentences(memoFull, 4, 640);
  if (!executiveBrief && stabilizers.length) {
    executiveBrief = `Stabilize-first priorities: ${stabilizers.slice(0, 3).join("; ")}`.slice(0, 640);
  }
  if (!executiveBrief) executiveBrief = "Executive scope readout — see initiatives below.";

  const projectsRaw = Array.isArray(doc.projects) ? doc.projects : [];
  const projects = projectsRaw.map((proj, i) => parseProject(proj, i));

  return { executiveBrief, projects };
}
