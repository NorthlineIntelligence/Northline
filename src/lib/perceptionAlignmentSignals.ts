/**
 * Perception & alignment diagnostics — pattern checks beyond doctrine structural flags.
 * Tone: validation opportunity, not accusation.
 */

const PILLAR_ORDER = [
  "SYSTEM_INTEGRITY",
  "HUMAN_ALIGNMENT",
  "STRATEGIC_COHERENCE",
  "SUSTAINABILITY_PRACTICE",
] as const;

export type PerceptionAlignmentSignal = {
  key: string;
  severity: "INFO" | "MODERATE" | "SIGNIFICANT" | "CRITICAL";
  title: string;
  summary: string;
  guidance: string;
  details: Record<string, unknown>;
};

export const PERCEPTION_ALIGNMENT_EXECUTIVE_NOTE =
  "While overall readiness scores are strong, response patterns show a high level of consistency across areas that often vary in operational environments. This may indicate an opportunity to validate how processes function in practice across teams. Before expanding AI initiatives, aligning on how work is executed day-to-day can help ensure that automation reinforces consistency rather than amplifying hidden variability.";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function stdevSample(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((s, x) => s + (x - mean) ** 2, 0) / values.length;
  return round2(Math.sqrt(v));
}

function normalizeRole(role: string | null | undefined): string | null {
  const t = (role ?? "").trim();
  return t.length ? t : null;
}

type QuestionRow = {
  id: string;
  pillar: string;
  weight: number;
  inverse_question_id: string | null;
};

type ResponseRow = {
  question_id: string;
  score: number;
  participant_id: string;
  Participant: { role: string | null };
};

export function buildPerceptionAlignmentSignals(args: {
  pillars: Record<string, { weightedAverage: number | null } | undefined>;
  overallWeightedAverageRaw: number | null;
  questions: QuestionRow[];
  responses: ResponseRow[];
}): PerceptionAlignmentSignal[] {
  const signals: PerceptionAlignmentSignal[] = [];

  const pillarScores = PILLAR_ORDER.map((k) => args.pillars[k]?.weightedAverage ?? null);
  const allPresent = pillarScores.every((s): s is number => typeof s === "number" && !Number.isNaN(s));
  if (allPresent) {
    const min = Math.min(...pillarScores);
    const sd = stdevSample(pillarScores);
    if (min >= 4.2 && sd !== null && sd <= 0.3) {
      signals.push({
        key: "UNIFORM_HIGH_SCORE_PATTERN",
        severity: "INFO",
        title: "Uniform High Score Pattern",
        summary:
          "Readiness scores are unusually consistent and high across all pillars—an uncommon pattern in multi-dimensional operational environments.",
        guidance:
          "This pattern suggests an opportunity for deeper validation: cross-functional workshops, walkthroughs of how work actually flows, and sampling execution quality can strengthen confidence before scaling AI.",
        details: {
          rule: "all pillars >= 4.2 and pillar stdev <= 0.30",
          pillarScores: PILLAR_ORDER.map((k, i) => ({ pillar: k, score: pillarScores[i] })),
          stdev: sd,
        },
      });
    }
  }

  const qById = new Map(args.questions.map((q) => [q.id, q]));
  const pairKeys = new Set<string>();
  for (const q of args.questions) {
    if (!q.inverse_question_id) continue;
    const a = q.id;
    const b = q.inverse_question_id;
    if (!qById.has(b)) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (pairKeys.has(key)) continue;
    pairKeys.add(key);

    const scoresA = args.responses.filter((r) => r.question_id === a).map((r) => r.score);
    const scoresB = args.responses.filter((r) => r.question_id === b).map((r) => r.score);
    if (!scoresA.length || !scoresB.length) continue;

    const avgA = round2(scoresA.reduce((s, x) => s + x, 0) / scoresA.length);
    const avgB = round2(scoresB.reduce((s, x) => s + x, 0) / scoresB.length);
    if (avgA >= 4 && avgB >= 4) {
      signals.push({
        key: "RESPONSE_PATTERN_INCONSISTENCY",
        severity: "MODERATE",
        title: "Response Pattern Inconsistency",
        summary:
          "A paired set of questions that typically move in opposite directions both show strong agreement—worth a gentle calibration conversation rather than a score correction.",
        guidance:
          "Use this as a cue to validate wording interpretation with a few respondents, or to run a short facilitated review so leaders can align on what “strong agreement” means in practice.",
        details: {
          rule: "inverse pair both average >= 4.0",
          pair: { questionA: a, questionB: b, avgA, avgB },
        },
      });
    }
  }

  const distinctParticipants = new Set(args.responses.map((r) => r.participant_id));
  if (distinctParticipants.size >= 2) {
    type RoleAgg = { sums: Record<string, number>; counts: Record<string, number> };
    const byPillarRole: Record<string, RoleAgg> = {};

    for (const pillar of PILLAR_ORDER) {
      byPillarRole[pillar] = { sums: {}, counts: {} };
    }

    for (const r of args.responses) {
      const q = qById.get(r.question_id);
      if (!q) continue;
      const role = normalizeRole(r.Participant.role);
      if (!role) continue;
      const pillar = String(q.pillar);
      if (!byPillarRole[pillar]) continue;
      byPillarRole[pillar].sums[role] = (byPillarRole[pillar].sums[role] ?? 0) + r.score;
      byPillarRole[pillar].counts[role] = (byPillarRole[pillar].counts[role] ?? 0) + 1;
    }

    let worst: { pillar: string; diff: number; roles: Record<string, number> } | null = null;

    for (const pillar of PILLAR_ORDER) {
      const agg = byPillarRole[pillar];
      const roleAvgs: Record<string, number> = {};
      for (const role of Object.keys(agg.counts)) {
        const c = agg.counts[role];
        if (!c) continue;
        roleAvgs[role] = round2(agg.sums[role] / c);
      }
      const roles = Object.keys(roleAvgs);
      if (roles.length < 2) continue;
      const vals = roles.map((k) => roleAvgs[k]);
      const diff = round2(Math.max(...vals) - Math.min(...vals));
      if (diff >= 1.2 && (!worst || diff > worst.diff)) {
        worst = { pillar, diff, roles: roleAvgs };
      }
    }

    if (worst) {
      let severity: "MODERATE" | "SIGNIFICANT" | "CRITICAL" = "MODERATE";
      if (worst.diff >= 2.0) severity = "CRITICAL";
      else if (worst.diff >= 1.5) severity = "SIGNIFICANT";

      signals.push({
        key: "ALIGNMENT_GAP_ACROSS_ROLES",
        severity,
        title: "Alignment Gap Across Roles",
        summary:
          "Different roles are reporting meaningfully different experience levels on at least one readiness pillar—often a sign of visibility or workflow fragmentation rather than disagreement for its own sake.",
        guidance:
          "Before scaling AI, a short alignment pass (shared definitions, joint walkthrough, or paired leadership review) can surface where perceptions differ and where execution is genuinely inconsistent.",
        details: {
          rule: "max role avg − min role avg >= 1.2 on a pillar (multiple respondents)",
          pillar: worst.pillar,
          spread: worst.diff,
          roleAverages: worst.roles,
        },
      });
    }
  }

  const baseForConfidence = signals.filter((s) =>
    ["UNIFORM_HIGH_SCORE_PATTERN", "RESPONSE_PATTERN_INCONSISTENCY", "ALIGNMENT_GAP_ACROSS_ROLES"].includes(s.key)
  );
  const raw = args.overallWeightedAverageRaw;
  if (baseForConfidence.length > 0 && raw !== null && !Number.isNaN(raw) && raw >= 4.5) {
    signals.push({
      key: "HIGH_CONFIDENCE_LOW_VALIDATION",
      severity: "INFO",
      title: "High Headline Scores, Additional Validation Suggested",
      summary:
        "Headline readiness is strong while response-pattern checks suggest more cross-checking would be prudent before major commitments.",
      guidance:
        "Treat this as a planning nudge: pair strong headline scores with lightweight validation (sampling, cross-functional review, or operational metrics) so AI investments land on verified workflows.",
        details: {
          rule: "overall weighted average (raw) >= 4.5 and another perception signal present",
          overallWeightedAverageRaw: raw,
        },
      });
    }

  return signals;
}

/** Severity rank for picking the top cards to show (higher first). */
export function perceptionSignalRank(s: PerceptionAlignmentSignal): number {
  const order: Record<string, number> = { CRITICAL: 4, SIGNIFICANT: 3, MODERATE: 2, INFO: 1 };
  return order[s.severity] ?? 0;
}

export function pickPerceptionSignalsForDisplay(signals: PerceptionAlignmentSignal[], max = 3): PerceptionAlignmentSignal[] {
  return [...signals].sort((a, b) => perceptionSignalRank(b) - perceptionSignalRank(a)).slice(0, max);
}
