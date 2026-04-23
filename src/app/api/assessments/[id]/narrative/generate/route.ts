import { NextResponse, NextRequest } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import {
  narrativeCacheGet,
  narrativeCacheSet,
  narrativeInflight,
} from "@/lib/narrativeCache";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { prisma } from "@/lib/prisma";
import { buildAssessmentResultsPayload } from "@/lib/assessmentResultsEngine";
import { isAdminEmail } from "@/lib/admin";
import { ASSESSMENTS_IN_PROGRESS_MESSAGE } from "@/lib/assessmentParticipantMessages";
import { getReportingParticipantCompletionStats } from "@/lib/assessmentParticipantCompletion";
import {
  fetchPublicWebsiteExcerpt,
  isWebEnrichmentEnabled,
  normalizePublicWebsiteUrl,
  summarizePublicWebExcerptForMemo,
} from "@/lib/publicWebsiteEnrichment";
import { anonymizeOrgText } from "@/lib/anonymizeOrgText";
import { PERCEPTION_ALIGNMENT_EXECUTIVE_NOTE } from "@/lib/perceptionAlignmentSignals";

const ParamsSchema = z.object({ id: z.string().uuid() });
const DEFAULT_NARRATIVE_MODEL = "claude-sonnet-4-6";

/**
 * exactly one server client helper, used by BOTH GET and POST.
 */
async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!supabaseKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)"
    );
  }

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // ignore
        }
      },
    },
  });
}

/**
 * Narrative guardrails:
 * - enforce allowed shape
 * - trim + cap strings
 * - cap array lengths
 * - strip unknown keys
 */

const TrimmedText = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v),
  z.string().min(1).max(8000)
);

/** Executive narrative body (maturityInterpretation.explanation) — allow up to ~1500 words. */
const MemoExplanationText = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v),
  z.string().min(1).max(12000)
);

const ShortBullet = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v),
  z.string().min(1).max(600)
);

const NarrativeSchema = z
  .object({
    schemaVersion: z.string().min(1).max(20),
    assessmentId: z.string().uuid(),

    organization: z
      .object({
        reference: TrimmedText,
        industry: z
          .preprocess(
            (v) => (v === "" || v === undefined ? null : v),
            z.union([TrimmedText, z.null()])
          )
          .optional(),
        size: z
          .preprocess(
            (v) => (v === "" || v === undefined ? null : v),
            z.union([TrimmedText, z.null()])
          )
          .optional(),
      })
      .strip(),

    executiveSummaryBullets: z.array(ShortBullet).max(6).default([]),

    maturityInterpretation: z
      .object({
        anchorTruth: TrimmedText,
        tier: z
          .object({
            label: z
              .preprocess(
                (v) => (v === "" || v === undefined ? null : v),
                z.union([z.string().trim().min(1).max(400), z.null()])
              )
              .optional(),
            posture: z
              .preprocess(
                (v) => (v === "" || v === undefined ? null : v),
                z.union([z.string().trim().min(1).max(400), z.null()])
              )
              .optional(),
            protectedScore: z.union([z.number(), z.null()]).optional(),
          })
          .strip(),
        explanation: MemoExplanationText,
      })
      .strip(),

    /** Executive-level AI recommendations by pillar; separate from pilotProjects entry points. */
    executiveRecommendations: z
      .object({
        framing: TrimmedText,
        systemIntegrity: TrimmedText,
        humanAlignment: TrimmedText,
        strategicCoherence: TrimmedText,
        sustainabilityPractice: TrimmedText,
      })
      .strip()
      .optional(),

    currentState: z
      .object({
        strengths: z.array(ShortBullet).max(8).default([]),
        gaps: z.array(ShortBullet).max(8).default([]),
        blockers: z.array(ShortBullet).max(8).default([]),
      })
      .strip(),

    opportunities: z
      .object({
        note: TrimmedText,
        items: z.array(ShortBullet).max(8).default([]),
      })
      .strip(),

    pilotProjects: z
      .array(
        z
          .object({
            name: ShortBullet,
            businessProblem: TrimmedText,
            aiRole: TrimmedText,
            expectedOutcome: TrimmedText,
            whyThisIsAGoodStart: TrimmedText,
          })
          .strip()
      )
      .min(2)
      .max(3)
      .default([]),

    guardrails: z
      .object({
        dataProtection: z.array(ShortBullet).max(6).default([]),
        humanOversight: z.array(ShortBullet).max(6).default([]),
        toolGovernance: z.array(ShortBullet).max(6).default([]),
        adoptionRisks: z.array(ShortBullet).max(6).default([]),
      })
      .strip(),

    actionPlan90Days: z
      .object({
        days0to30: z
          .object({
            actions: z.array(ShortBullet).max(8).default([]),
            owners: z.array(ShortBullet).max(8).default([]),
            successIndicators: z.array(ShortBullet).max(8).default([]),
          })
          .strip(),
        days31to60: z
          .object({
            actions: z.array(ShortBullet).max(8).default([]),
            owners: z.array(ShortBullet).max(8).default([]),
            successIndicators: z.array(ShortBullet).max(8).default([]),
          })
          .strip(),
        days61to90: z
          .object({
            actions: z.array(ShortBullet).max(8).default([]),
            owners: z.array(ShortBullet).max(8).default([]),
            successIndicators: z.array(ShortBullet).max(8).default([]),
          })
          .strip(),
      })
      .strip(),

    leadershipAlignment: z
      .object({
        whereToStart: TrimmedText,
        whatToPrioritize: z.array(ShortBullet).max(6).default([]),
        suggestedInvestmentLevel: z.enum(["low", "moderate", "strategic"]),
      })
      .strip(),

    risks: z
      .object({
        flags: z.array(z.any()).max(25).default([]),
        implications: TrimmedText,
        pillarRiskInterpretation: z
          .object({
            systemIntegrity: TrimmedText,
            humanAlignment: TrimmedText,
            strategicCoherence: TrimmedText,
            sustainabilityPractice: TrimmedText,
          })
          .strip(),
      })
      .strip(),

    evidenceUsed: z
      .object({
        freeTextThemes: z.array(ShortBullet).max(10).default([]),
        participantOpportunityThemes: z.array(ShortBullet).max(10).default([]),
      })
      .strip(),

    missingInputs: z.array(TrimmedText).max(20).default([]),
  })
  .strip();

const FALLBACK_PILOT_PROJECTS: [
  {
    name: string;
    businessProblem: string;
    aiRole: string;
    expectedOutcome: string;
    whyThisIsAGoodStart: string;
  },
  {
    name: string;
    businessProblem: string;
    aiRole: string;
    expectedOutcome: string;
    whyThisIsAGoodStart: string;
  },
] = [
  {
    name: "Operations Knowledge Support Pilot",
    businessProblem:
      "Teams may be losing time finding information, clarifying steps, or handling repeat requests manually.",
    aiRole:
      "Use AI to surface approved internal knowledge and support faster execution in a narrow workflow.",
    expectedOutcome: "Reduce repeat manual effort and improve consistency in routine decisions.",
    whyThisIsAGoodStart:
      "It is practical, bounded, and easier to govern than a broad automation rollout.",
  },
  {
    name: "Manual Workflow Reduction Pilot",
    businessProblem:
      "The assessment suggests there may be opportunities to reduce repetitive coordination or administrative work.",
    aiRole:
      "Use AI assistance to summarize, draft, classify, or route work inside one defined process.",
    expectedOutcome: "Save time, reduce friction, and show measurable value quickly.",
    whyThisIsAGoodStart:
      "It is easier to test and measure before expanding into broader transformation work.",
  },
];

function clipStr(s: string, max: number) {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function nonEmptyStr(s: unknown, fallback: string, max: number): string {
  const t = typeof s === "string" ? s.trim() : "";
  return t.length ? clipStr(t, max) : fallback;
}

function cleanBulletArray(arr: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => (typeof x === "string" ? clipStr(x.trim(), maxLen) : ""))
    .filter((x) => x.length > 0)
    .slice(0, maxItems);
}

type NarrativeSanitizeCtx = {
  assessmentId: string;
  companyReference: string;
  industry?: string | null;
  size?: string | null;
  aggregatePillars?: Record<string, { weightedAverage?: number | null } | undefined> | null;
};

const PILLAR_JSON_TO_AGG: Record<string, string> = {
  systemIntegrity: "SYSTEM_INTEGRITY",
  humanAlignment: "HUMAN_ALIGNMENT",
  strategicCoherence: "STRATEGIC_COHERENCE",
  sustainabilityPractice: "SUSTAINABILITY_PRACTICE",
};

function isWeakRiskNarrativeText(s: unknown): boolean {
  const t = typeof s === "string" ? s.trim() : "";
  if (t.length < 120) return true;
  if (
    /TBD|insufficient context|Full pillar interpretation was not returned|Validation failed for this narrative/i.test(t)
  ) {
    return true;
  }
  return false;
}

function pillarScoreFromCtx(ctx: NarrativeSanitizeCtx, jsonKey: string): number | null {
  const aggKey = PILLAR_JSON_TO_AGG[jsonKey];
  if (!aggKey) return null;
  const v = ctx.aggregatePillars?.[aggKey]?.weightedAverage;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pillarRiskInterpretationFallback(jsonKey: string, ctx: NarrativeSanitizeCtx): string {
  const score = pillarScoreFromCtx(ctx, jsonKey);
  const s = score != null ? score.toFixed(2) : "n/a";
  const org = ctx.companyReference || "the company";
  const band =
    score == null ? "unknown" : score >= 3.5 ? "stronger" : score >= 2.75 ? "mixed" : "constrained";

  const byKey: Record<string, string> = {
    systemIntegrity: [
      `${org} scores System Integrity at ${s} on a 1–5 scale. Even when no doctrine risk flags fire, this pillar is your practical gate for automation breadth: data lineage, workflow ownership, and change control determine whether models amplify clarity or chaos.`,
      band === "constrained"
        ? "Executive action: fund a narrow data-and-workflow map for the highest-volume customer or operations path, assign a single accountable owner, and defer autonomous agents until review checkpoints are boringly reliable."
        : band === "mixed"
          ? "Executive action: standardize a few critical interfaces (definitions, approvals, logging) before scaling copilots; pick one executive sponsor to remove cross-team ambiguity weekly."
          : "Executive action: keep the advantage—institutionalize architecture reviews for new AI features so speed does not quietly reintroduce fragility.",
    ].join(" "),
    humanAlignment: [
      `Human Alignment reads ${s}. It reflects training intensity, trust, review habits, and how work actually changes when tools shift.`,
      "No flags does not mean no friction: mid scores often predict uneven adoption, shadow workflows, and change fatigue.",
      band === "constrained"
        ? "Executive action: pair each AI pilot with explicit competency targets, manager checklists, and a simple ‘stop doing’ list so teams are not asked to absorb infinite new habits."
        : "Executive action: publish a plain-language ‘human in the loop’ standard for decisions that touch customers, cash, or safety; measure adoption with spot audits, not surveys alone.",
    ].join(" "),
    strategicCoherence: [
      `Strategic Coherence is ${s}. It signals whether AI work will reinforce priorities—or become a side hobby.`,
      "When this pillar lags, keep AI initiatives tethered to one or two measurable executive outcomes (margin, cycle time, risk reduction) with quarterly kill criteria.",
      "Executive action: require every funded AI experiment to name the business metric it moves and the executive who will defend the tradeoffs in the next planning cycle.",
    ].join(" "),
    sustainabilityPractice: [
      `Sustainability Practice scores ${s}. It covers governance rhythms, monitoring, and whether improvements stick after the workshop.`,
      "Treat maintenance as a first-class budget line: retraining, policy updates, incident playbooks, and vendor/model change control.",
      "Executive action: assign operational ownership for model monitoring and drift—not just IT security—and tie vendor commitments to measurable service levels for retraining and support.",
    ].join(" "),
  };

  return byKey[jsonKey] ?? byKey.systemIntegrity;
}

function implicationsFallback(flagCount: number, ctx: NarrativeSanitizeCtx): string {
  const org = ctx.companyReference || "the company";
  if (flagCount > 0) {
    return `${org} has structural risk signals in this snapshot. Treat that as sequencing guidance: narrow scope, tighten ownership, and align guardrails before expanding autonomy. The pillar notes below translate each readiness area into practical leadership moves—not alarmism, but where AI could amplify existing strain if ignored.`;
  }
  return `${org} shows no structural doctrine flags in this snapshot—disciplined inputs and scoring are within an acceptable band. That is an opportunity, not an all-clear: use the pillar notes to highlight where AI adoption could still create rework, uneven skills, or unclear accountability if rolled out faster than the foundation allows.`;
}

function defaultExecutiveRecommendations(ctx: NarrativeSanitizeCtx) {
  const org = ctx.companyReference || "the company";
  return {
    framing: [
      `Northline Executive recommendations for ${org}: treat AI as a portfolio of sequenced business bets, not a single platform purchase.`,
      "These are general executive actions—separate from the three high-value entry-point pilots—that strengthen how AI performs in the business across the four readiness pillars.",
    ].join(" "),
    systemIntegrity: [
      "System Integrity — executive moves: (1) Name a single accountable executive for authoritative data definitions in the top two customer or revenue workflows. (2) Require architecture review for any AI feature that writes to systems of record. (3) Fund incremental hardening (logging, rollback, access boundaries) before widening model autonomy.",
      `Ground these moves in the System Integrity score (${pillarScoreFromCtx(ctx, "systemIntegrity")?.toFixed(2) ?? "see radar"}/5) and the themes raised in your narrative (for example data flows, integrations, and operational discipline).`,
    ].join(" "),
    humanAlignment: [
      "Human Alignment — executive moves: (1) Pair each pilot with explicit training time and success metrics tied to behavior change, not tool logins. (2) Publish a simple decision-rights chart for when a human must approve model output. (3) Incentivize managers to remove low-value work—not add AI busywork on top of existing load.",
      `Use the Human Alignment score (${pillarScoreFromCtx(ctx, "humanAlignment")?.toFixed(2) ?? "see radar"}/5) to calibrate how aggressive adoption communications can be without creating cynicism.`,
    ].join(" "),
    strategicCoherence: [
      "Strategic Coherence — executive moves: (1) Tie every funded AI initiative to one executive-owned outcome with a quarterly review. (2) Kill or merge overlapping experiments that compete for the same workflow. (3) Align vendor and internal roadmaps to customer promises and operational KPIs, not novelty.",
      `The Strategic Coherence score (${pillarScoreFromCtx(ctx, "strategicCoherence")?.toFixed(2) ?? "see radar"}/5) should set how many concurrent AI bets the organization can credibly govern.`,
    ].join(" "),
    sustainabilityPractice: [
      "Sustainability Practice — executive moves: (1) Budget for monitoring, retraining, and policy updates as ongoing run-cost, not project tail. (2) Assign operational ownership for model performance and incident response—not delegated only to IT security. (3) Build a lightweight executive dashboard for drift, cost, and user-reported failures.",
      `The Sustainability Practice score (${pillarScoreFromCtx(ctx, "sustainabilityPractice")?.toFixed(2) ?? "see radar"}/5) indicates how resilient gains are likely to be after the initial launch energy fades.`,
    ].join(" "),
  };
}

/**
 * Normalizes model output so Zod validation matches what the Anthropic tool schema allows
 * (empty strings, casing on enums, short pilot lists, assessmentId quirks).
 */
function coerceNarrativeForSchema(raw: Record<string, any>, ctx: NarrativeSanitizeCtx): Record<string, any> {
  const out = { ...raw };

  out.assessmentId = ctx.assessmentId;

  if (out.organization && typeof out.organization === "object") {
    const o = { ...out.organization };
    o.reference = nonEmptyStr(o.reference, ctx.companyReference, 8000);
    if (typeof o.industry === "string" && !o.industry.trim()) o.industry = ctx.industry ?? null;
    if (typeof o.industry === "string" && o.industry.trim()) o.industry = clipStr(o.industry.trim(), 8000);
    if (typeof o.size === "string" && !o.size.trim()) o.size = ctx.size ?? null;
    if (typeof o.size === "string" && o.size.trim()) o.size = clipStr(o.size.trim(), 8000);
    out.organization = o;
  }

  if (out.maturityInterpretation?.tier && typeof out.maturityInterpretation.tier === "object") {
    const t = { ...out.maturityInterpretation.tier };
    if (typeof t.label === "string" && !t.label.trim()) t.label = null;
    if (typeof t.label === "string" && t.label.trim()) t.label = clipStr(t.label.trim(), 400);
    if (typeof t.posture === "string" && !t.posture.trim()) t.posture = null;
    if (typeof t.posture === "string" && t.posture.trim()) t.posture = clipStr(t.posture.trim(), 400);
    if (typeof t.protectedScore !== "number" || Number.isNaN(t.protectedScore)) t.protectedScore = null;
    out.maturityInterpretation = { ...out.maturityInterpretation, tier: t };
  }

  out.executiveSummaryBullets = cleanBulletArray(out.executiveSummaryBullets, 6, 600);
  if (out.executiveSummaryBullets.length === 0) {
    out.executiveSummaryBullets = [
      `Executive summary grounded in the latest assessment inputs for ${ctx.companyReference}.`,
    ];
  }

  if (out.maturityInterpretation && typeof out.maturityInterpretation === "object") {
    const mi = out.maturityInterpretation;
    out.maturityInterpretation = {
      ...mi,
      anchorTruth: nonEmptyStr(
        mi.anchorTruth,
        "Maturity represents structural capability, while readiness indicates how safely the company can move into practical AI execution.",
        8000
      ),
      explanation: nonEmptyStr(
        mi.explanation,
        "Assessment interpretation from structured results and evidence.",
        12000
      ),
    };
  }

  if (out.currentState && typeof out.currentState === "object") {
    const cs = out.currentState;
    out.currentState = {
      strengths: cleanBulletArray(cs.strengths, 8, 600),
      gaps: cleanBulletArray(cs.gaps, 8, 600),
      blockers: cleanBulletArray(cs.blockers, 8, 600),
    };
  }

  if (out.opportunities && typeof out.opportunities === "object") {
    const opp = out.opportunities;
    out.opportunities = {
      note: nonEmptyStr(opp.note, "Practical opportunity areas grounded in assessment context.", 8000),
      items: cleanBulletArray(opp.items, 8, 600),
    };
  }

  let pilots = Array.isArray(out.pilotProjects) ? out.pilotProjects.filter((p) => p && typeof p === "object") : [];
  pilots = pilots.slice(0, 3);
  while (pilots.length < 2) {
    pilots.push({ ...FALLBACK_PILOT_PROJECTS[pilots.length] });
  }
  out.pilotProjects = pilots.map((p, idx) => ({
    name: nonEmptyStr(p.name, `Pilot initiative ${idx + 1}`, 600),
    businessProblem: nonEmptyStr(
      p.businessProblem,
      "Define a narrow business problem with clear workflow boundaries.",
      8000
    ),
    aiRole: nonEmptyStr(p.aiRole, "Apply AI assistance within explicit human review boundaries.", 8000),
    expectedOutcome: nonEmptyStr(p.expectedOutcome, "Achieve a measurable improvement in time, quality, or risk.", 8000),
    whyThisIsAGoodStart: nonEmptyStr(
      p.whyThisIsAGoodStart,
      "Limited scope keeps governance manageable while proving value.",
      8000
    ),
  }));

  if (out.guardrails && typeof out.guardrails === "object") {
    const g = out.guardrails;
    out.guardrails = {
      dataProtection: cleanBulletArray(g.dataProtection, 6, 600),
      humanOversight: cleanBulletArray(g.humanOversight, 6, 600),
      toolGovernance: cleanBulletArray(g.toolGovernance, 6, 600),
      adoptionRisks: cleanBulletArray(g.adoptionRisks, 6, 600),
    };
  }

  if (out.actionPlan90Days && typeof out.actionPlan90Days === "object") {
    const ap = out.actionPlan90Days;
    const phase = (ph: any) => ({
      actions: cleanBulletArray(ph?.actions, 8, 600),
      owners: cleanBulletArray(ph?.owners, 8, 600),
      successIndicators: cleanBulletArray(ph?.successIndicators, 8, 600),
    });
    out.actionPlan90Days = {
      days0to30: phase(ap.days0to30),
      days31to60: phase(ap.days31to60),
      days61to90: phase(ap.days61to90),
    };
  }

  if (out.leadershipAlignment && typeof out.leadershipAlignment === "object") {
    const la = out.leadershipAlignment;
    const inv = String(la.suggestedInvestmentLevel ?? "").trim().toLowerCase();
    const level = ["low", "moderate", "strategic"].includes(inv) ? inv : "moderate";
    out.leadershipAlignment = {
      whereToStart: nonEmptyStr(la.whereToStart, "Prioritize one measurable pilot with clear ownership.", 8000),
      whatToPrioritize: cleanBulletArray(la.whatToPrioritize, 6, 600),
      suggestedInvestmentLevel: level,
    };
  }

  if (out.risks && typeof out.risks === "object") {
    const r = out.risks;
    const priRaw =
      r.pillarRiskInterpretation && typeof r.pillarRiskInterpretation === "object"
        ? r.pillarRiskInterpretation
        : {};
    const flagCount = Array.isArray(r.flags) ? r.flags.length : 0;
    const implicationsRaw = typeof r.implications === "string" ? r.implications.trim() : "";
    const implicationsFinal =
      !implicationsRaw.length || isWeakRiskNarrativeText(implicationsRaw)
        ? implicationsFallback(flagCount, ctx)
        : clipStr(implicationsRaw, 8000);

    const pillar = (v: unknown, jsonKey: string) => {
      const t = typeof v === "string" ? v.trim() : "";
      if (!isWeakRiskNarrativeText(t)) return clipStr(t, 4500);
      return pillarRiskInterpretationFallback(jsonKey, ctx);
    };
    out.risks = {
      flags: Array.isArray(r.flags) ? r.flags.slice(0, 25) : [],
      implications: implicationsFinal,
      pillarRiskInterpretation: {
        systemIntegrity: pillar((priRaw as any).systemIntegrity, "systemIntegrity"),
        humanAlignment: pillar((priRaw as any).humanAlignment, "humanAlignment"),
        strategicCoherence: pillar((priRaw as any).strategicCoherence, "strategicCoherence"),
        sustainabilityPractice: pillar((priRaw as any).sustainabilityPractice, "sustainabilityPractice"),
      },
    };
  }

  const execRecDefaults = defaultExecutiveRecommendations(ctx);
  if (!out.executiveRecommendations || typeof out.executiveRecommendations !== "object") {
    out.executiveRecommendations = execRecDefaults;
  } else {
    const er = out.executiveRecommendations as Record<string, unknown>;
    out.executiveRecommendations = {
      framing: nonEmptyStr(er.framing, execRecDefaults.framing, 8000),
      systemIntegrity: nonEmptyStr(er.systemIntegrity, execRecDefaults.systemIntegrity, 8000),
      humanAlignment: nonEmptyStr(er.humanAlignment, execRecDefaults.humanAlignment, 8000),
      strategicCoherence: nonEmptyStr(er.strategicCoherence, execRecDefaults.strategicCoherence, 8000),
      sustainabilityPractice: nonEmptyStr(
        er.sustainabilityPractice,
        execRecDefaults.sustainabilityPractice,
        8000
      ),
    };
  }

  if (out.evidenceUsed && typeof out.evidenceUsed === "object") {
    const ev = out.evidenceUsed;
    out.evidenceUsed = {
      freeTextThemes: cleanBulletArray(ev.freeTextThemes, 10, 600),
      participantOpportunityThemes: cleanBulletArray(ev.participantOpportunityThemes, 10, 600),
    };
  }

  out.missingInputs = cleanBulletArray(out.missingInputs, 20, 600);

  return out;
}

function sanitizeNarrativeJson(input: any, ctx: NarrativeSanitizeCtx) {
  const normalized =
    input && typeof input === "object"
      ? {
          ...input,

          schemaVersion:
            typeof input.schemaVersion === "string" ? input.schemaVersion : "2.0",

          assessmentId: ctx.assessmentId,

          organization:
            input.organization && typeof input.organization === "object"
              ? {
                  reference:
                    typeof input.organization.reference === "string"
                      ? input.organization.reference
                      : ctx.companyReference,
                  industry:
                    typeof input.organization.industry === "string"
                      ? input.organization.industry
                      : (ctx.industry ?? null),
                  size:
                    typeof input.organization.size === "string"
                      ? input.organization.size
                      : (ctx.size ?? null),
                }
              : {
                  reference: ctx.companyReference,
                  industry: ctx.industry ?? null,
                  size: ctx.size ?? null,
                },

          executiveSummaryBullets: Array.isArray(input.executiveSummaryBullets)
            ? input.executiveSummaryBullets
            : [],

          maturityInterpretation:
            input.maturityInterpretation && typeof input.maturityInterpretation === "object"
              ? input.maturityInterpretation
              : {
                  anchorTruth:
                    "Maturity represents structural capability, while readiness indicates how safely the company can move into practical AI execution.",
                  tier: { label: null, posture: null, protectedScore: null },
                  explanation: "TBD (insufficient context).",
                },

          currentState:
            input.currentState && typeof input.currentState === "object"
              ? input.currentState
              : { strengths: [], gaps: [], blockers: [] },

          opportunities:
            input.opportunities && typeof input.opportunities === "object"
              ? input.opportunities
              : { note: "TBD (insufficient context).", items: [] },

          pilotProjects: Array.isArray(input.pilotProjects) ? input.pilotProjects : [],

          guardrails:
            input.guardrails && typeof input.guardrails === "object"
              ? input.guardrails
              : {
                  dataProtection: [],
                  humanOversight: [],
                  toolGovernance: [],
                  adoptionRisks: [],
                },

          actionPlan90Days:
            input.actionPlan90Days && typeof input.actionPlan90Days === "object"
              ? input.actionPlan90Days
              : {
                  days0to30: { actions: [], owners: [], successIndicators: [] },
                  days31to60: { actions: [], owners: [], successIndicators: [] },
                  days61to90: { actions: [], owners: [], successIndicators: [] },
                },

          leadershipAlignment:
            input.leadershipAlignment && typeof input.leadershipAlignment === "object"
              ? input.leadershipAlignment
              : {
                  whereToStart: "TBD (insufficient context).",
                  whatToPrioritize: [],
                  suggestedInvestmentLevel: "low",
                },

          executiveRecommendations:
            input.executiveRecommendations && typeof input.executiveRecommendations === "object"
              ? input.executiveRecommendations
              : undefined,

          risks:
            input.risks && typeof input.risks === "object"
              ? input.risks
              : {
                  flags: [],
                  implications: "TBD (insufficient context).",
                  pillarRiskInterpretation: {
                    systemIntegrity: "TBD (insufficient context).",
                    humanAlignment: "TBD (insufficient context).",
                    strategicCoherence: "TBD (insufficient context).",
                    sustainabilityPractice: "TBD (insufficient context).",
                  },
                },

          evidenceUsed:
            input.evidenceUsed && typeof input.evidenceUsed === "object"
              ? input.evidenceUsed
              : { freeTextThemes: [], participantOpportunityThemes: [] },

          missingInputs: Array.isArray(input.missingInputs) ? input.missingInputs : [],
        }
      : input;

  const candidate =
    normalized && typeof normalized === "object"
      ? coerceNarrativeForSchema(normalized as Record<string, any>, ctx)
      : normalized;

  const scrubRoleAndBlameLanguage = (text: string): string => {
    let out = text;
    out = out.replace(
      /\bwhether leadership is willing to do the pre[- ]work\b/gi,
      "whether the organization is prepared to complete the foundational pre-work"
    );
    out = out.replace(
      /\b(COO|CEO|CFO|CTO|CIO|CHRO|VP of Operations|Vice President of Operations|Sales Manager|Operations Manager)\b/gi,
      "a respondent"
    );
    out = out.replace(/\ba respondent's\b/gi, "one respondent's");
    return out;
  };

  const scrubDeepStrings = (value: unknown): unknown => {
    if (typeof value === "string") return scrubRoleAndBlameLanguage(value);
    if (Array.isArray(value)) return value.map((v) => scrubDeepStrings(v));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = scrubDeepStrings(v);
      }
      return out;
    }
    return value;
  };

  const scrubbedCandidate = scrubDeepStrings(candidate);

  const parsed = NarrativeSchema.safeParse(scrubbedCandidate);
  if (parsed.success) return parsed.data;

  console.warn("NarrativeSchema validation failed (Zod):", {
    issues: parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      code: i.code,
      message: i.message,
    })),
  });

  return {
    schemaVersion: "2.0",
    assessmentId: ctx.assessmentId,
    organization: {
      reference: ctx.companyReference,
      industry: ctx.industry ?? null,
      size: ctx.size ?? null,
    },
    executiveSummaryBullets: [
      "Narrative summary is temporarily unavailable due to an output validation issue.",
      "Core assessment results are still available and can be used for workshop preparation.",
    ],
    maturityInterpretation: {
      anchorTruth:
        "Maturity represents structural capability, while readiness indicates how safely the company can move into practical AI execution.",
      tier: { label: null, posture: null, protectedScore: null },
      explanation:
        "Narrative validation failed; use the protected results payload as the source of truth for scoring and readiness interpretation.",
    },
    currentState: {
      strengths: [],
      gaps: [],
      blockers: [],
    },
    opportunities: {
      note: "Narrative validation failed.",
      items: [],
    },
    pilotProjects: [
      {
        name: "Operations Knowledge Support Pilot",
        businessProblem:
          "Teams may be losing time finding information, clarifying steps, or handling repeat requests manually.",
        aiRole:
          "Use AI to surface approved internal knowledge and support faster execution in a narrow workflow.",
        expectedOutcome:
          "Reduce repeat manual effort and improve consistency in routine decisions.",
        whyThisIsAGoodStart:
          "It is practical, bounded, and easier to govern than a broad automation rollout.",
      },
      {
        name: "Manual Workflow Reduction Pilot",
        businessProblem:
          "The assessment suggests there may be opportunities to reduce repetitive coordination or administrative work.",
        aiRole:
          "Use AI assistance to summarize, draft, classify, or route work inside one defined process.",
        expectedOutcome: "Save time, reduce friction, and show measurable value quickly.",
        whyThisIsAGoodStart:
          "It is easier to test and measure before expanding into broader transformation work.",
      },
    ],
    guardrails: {
      dataProtection: [],
      humanOversight: [],
      toolGovernance: [],
      adoptionRisks: [],
    },
    actionPlan90Days: {
      days0to30: { actions: [], owners: [], successIndicators: [] },
      days31to60: { actions: [], owners: [], successIndicators: [] },
      days61to90: { actions: [], owners: [], successIndicators: [] },
    },
    leadershipAlignment: {
      whereToStart: "Start with one or two narrow pilots tied to clear operational friction.",
      whatToPrioritize: [],
      suggestedInvestmentLevel: "low",
    },
    executiveRecommendations: defaultExecutiveRecommendations(ctx),
    risks: {
      flags: [],
      implications:
        "Narrative validation failed; review risk signals and protected scoring directly in the assessment results payload.",
      pillarRiskInterpretation: {
        systemIntegrity:
          "Validation failed for this narrative. Use System Integrity scores and risk flags in the results payload as the source of truth.",
        humanAlignment:
          "Validation failed for this narrative. Use Human Alignment scores and evidence as the source of truth.",
        strategicCoherence:
          "Validation failed for this narrative. Use Strategic Coherence scores as the source of truth.",
        sustainabilityPractice:
          "Validation failed for this narrative. Use Sustainability Practice scores as the source of truth.",
      },
    },
    evidenceUsed: {
      freeTextThemes: [],
      participantOpportunityThemes: [],
    },
    missingInputs: ["Narrative output did not pass schema validation."],
  };
}

function isNarrativeAIEnabled() {
  return String(process.env.NARRATIVE_AI_ENABLED ?? "").toLowerCase() === "true";
}

function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is missing.");
  return new Anthropic({ apiKey });
}

/**
 * AI generation (behind flag). We still run sanitizeNarrativeJson() after parsing.
 * Uses the Anthropic Messages API (Claude).
 */
async function generateNarrativeJsonWithAI(args: {
  assessmentId: string;
  org: { industry?: string | null; size?: string | null };
  resultsBody: any;
  docCount: number;
  docsEvidence?: Array<{ title: string; excerpt: string }> | null;
  /** Used only for redaction before the model; never sent as-is to the LLM. */
  orgLegalName?: string | null;
  /** Anonymized bullets from a separate web-enrichment step (no URL). */
  publicWebSummary?: string | null;
}) {
  const { assessmentId, org, resultsBody, docCount, docsEvidence, orgLegalName, publicWebSummary } = args;

  const maturity = resultsBody?.maturity ?? null;
  const riskFlags = Array.isArray(resultsBody?.riskFlags) ? resultsBody.riskFlags : [];
  const perceptionAlignmentSignals = Array.isArray(resultsBody?.perceptionAlignmentSignals)
    ? resultsBody.perceptionAlignmentSignals
    : [];
  const perceptionAlignmentExecutiveNote =
    typeof resultsBody?.perceptionAlignmentExecutiveNote === "string"
      ? resultsBody.perceptionAlignmentExecutiveNote
      : null;

  const pillarsObj = resultsBody?.aggregate?.pillars ?? {};
  const pillarScores = Object.entries(pillarsObj).map(([pillar, v]: any) => ({
    pillar,
    weightedAverage: typeof v?.weightedAverage === "number" ? v.weightedAverage : null,
  }));

  const businessContext = resultsBody?.narrativeContext?.businessContext ?? {};
  const evidence = resultsBody?.narrativeContext?.evidence ?? {};

  const contextNotesRedacted = anonymizeOrgText({
    text: typeof businessContext?.contextNotes === "string" ? businessContext.contextNotes : null,
    organizationName: orgLegalName ?? null,
    industry: org.industry ?? null,
  });

  const freeTextResponsesRaw = Array.isArray(evidence?.freeTextResponses)
    ? evidence.freeTextResponses
    : [];

  const freeTextResponses = freeTextResponsesRaw.map((row: any) => {
    if (!row || typeof row !== "object") return row;
    const answer =
      typeof row.answer === "string"
        ? anonymizeOrgText({
            text: row.answer,
            organizationName: orgLegalName ?? null,
            industry: org.industry ?? null,
          })
        : row.answer;
    const qtext =
      typeof row.question === "string"
        ? anonymizeOrgText({
            text: row.question,
            organizationName: orgLegalName ?? null,
            industry: org.industry ?? null,
          })
        : row.question;
    return { ...row, question: qtext, answer };
  });

  const participantOpportunityNotesRaw = Array.isArray(evidence?.participantOpportunityNotes)
    ? evidence.participantOpportunityNotes
    : [];

  const participantOpportunityNotes = participantOpportunityNotesRaw.map((row: any) => {
    if (!row || typeof row !== "object") return row;
    const note =
      typeof row.note === "string"
        ? anonymizeOrgText({
            text: row.note,
            organizationName: orgLegalName ?? null,
            industry: org.industry ?? null,
          })
        : row.note;
    return { ...row, note };
  });

  /** Neutral label only — never a legal name or domain (see narrativeContext in DB for display descriptor). */
  const aiOrgReference = "the organization";

  const aiInput = {
    assessmentId,
    organization: {
      reference: aiOrgReference,
      industry: org.industry ?? null,
      size: org.size ?? null,
    },
    businessContext: {
      industry: businessContext?.industry ?? null,
      contextNotes: contextNotesRedacted,
      primaryPressures: businessContext?.primaryPressures ?? null,
      growthStage: businessContext?.growthStage ?? null,
      size: businessContext?.size ?? null,
    },
    publicWebContext: publicWebSummary
      ? {
          source: "anonymized_public_website_briefing",
          briefing: publicWebSummary,
        }
      : null,
    evidence: {
      freeTextResponses,
      participantOpportunityNotes,
    },
    results: {
      readinessIndex: resultsBody?.aggregate?.overall?.weightedAverage ?? null,
      readinessRaw: resultsBody?.aggregate?.overall?.weightedAverageRaw ?? null,
      maturity,
      protectionExplanation: resultsBody?.protectionExplanation ?? null,
      riskFlags,
      perceptionAlignmentSignals,
      perceptionAlignmentExecutiveNote,
      pillars: pillarScores,
    },
    documents: {
      count: docCount,
      excerpts: Array.isArray(docsEvidence) ? docsEvidence : [],
    },
    schema:
      "Return ONLY valid JSON for the required schema: schemaVersion, assessmentId, organization, executiveSummaryBullets, maturityInterpretation, currentState, opportunities, pilotProjects, guardrails, actionPlan90Days, leadershipAlignment, executiveRecommendations, risks, evidenceUsed, missingInputs.",
  };

  const model = process.env.NARRATIVE_AI_MODEL || DEFAULT_NARRATIVE_MODEL;
  const client = getAnthropicClient();

  const systemText = [
    "You are a senior strategy consultant at Northline Intelligence.",
    "You produce a workshop-ready executive readout in plain business language.",
    "",
    "NON-NEGOTIABLE RULES:",
    "- Use ONLY the provided INPUT object.",
    "- Do not invent facts, tools, systems, or capabilities.",
    "- Be consultative, practical, calm, and specific.",
    "- Do not criticize. Explain constraints plainly and constructively.",
    "- Treat the results payload as protected truth and do not contradict it.",
    "",
    "STRATEGIC INTERPRETATION RULE:",
    "- You are not summarizing an assessment. You are interpreting a system.",
    "- Use the pillar scores to determine how safely the company can adopt AI:",
    "  - High score = stable foundation, can support scaled automation",
    "  - Mid score = partial readiness, requires sequencing and guardrails",
    "  - Low score = high risk, automation will amplify existing problems",
    "- You MUST connect:",
    "  1. Pillar scores (structural reality)",
    "  2. Free-text responses (human reality)",
    "  3. Participant AI use cases (perceived opportunity)",
    "- Identify where these are:",
    "  - Aligned (strong signal)",
    "  - Misaligned (hidden risk)",
    "  - Missing (blind spots)",
    "- When participants suggest AI use cases:",
    "  - Do not assume they are correct",
    "  - Evaluate whether the system can support them",
    "  - Reframe them if needed into safer, more practical starting points",
    '- Always answer: "What happens if this company tries to implement AI right now?"',
    "- Use that answer to guide:",
    "  - risk framing",
    "  - pilot design",
    "  - sequencing of action",
    "",
    "LEADERSHIP GUIDANCE RULE:",
    "- This output is for executives deciding how to move forward.",
    "- Every section must help leadership:",
    "  - Understand reality",
    "  - Avoid risk",
    "  - Make a decision",
    "  - Take a first step",
    "- Avoid generic recommendations.",
    "- Tie every insight to how the business actually operates.",
    "",
    "ANONYMIZATION RULE:",
    "- Do NOT use any real company name, DBA, brand, or domain.",
    '- Refer to the organization only as the provided organization.reference value or as "the company".',
    "- Never address the output to a named company.",
    "- Do NOT infer or insert a legal name from website briefing, domains, email addresses, or participant text.",
    "- The INPUT deliberately excludes raw website URLs and legal entity names.",
    "- Do not attempt to infer the organization identity from uploaded documents or phrasing artifacts.",
    "",
    "PUBLIC WEBSITE CONTEXT:",
    "- When publicWebContext.briefing is present, it is from a separate anonymized review of their public site.",
    "- Use it to ground opportunities, pilots, and memo tone in how they operate and who they serve—without naming them.",
    "- If publicWebContext is null, proceed using only assessment results and evidence.",
    "",
    "EVIDENCE RULE:",
    "- You MUST use the free-text responses and participant opportunity notes as evidence.",
    "- Use them to identify pain points, current friction, leadership concerns, adoption realities, and practical opportunity areas.",
    "- If the evidence is thin, say so in missingInputs.",
    "",
    "WORKSHOP OUTPUT REQUIREMENTS:",
    "- The output must directly support an executive AI workshop.",
    "- Make the output decision-oriented, not just descriptive.",
    "- Recommendations must be practical, realistic, and aligned to current business conditions.",
    "- Do not chase hype.",
    "",
    "SECTION REQUIREMENTS:",
    "",
    "1. Executive Memo (stored in maturityInterpretation.explanation)",
    "- Target up to 1500 words of memo-grade narrative (rich, scannable, suitable for an executive workshop printout).",
    "- PREMIUM STRUCTURE: The explanation string MUST use the following headings each on its own line (Title Case), each followed by a blank line, then paragraphs (you may use bullet lines starting with '- ' where helpful):",
    "  Executive Narrative",
    "  Key dynamics",
    "  Strategic implications",
    "  Executive takeaway",
    "- The opening section after 'Executive Narrative' should lead with a strong thesis sentence; keep language concrete and tied to INPUT evidence (e.g., data flows, workflow ownership, governance).",
    "- Use all information available to you to create a comprehensive and accurate summary of the assessment results.",
    "2. maturityInterpretation",
    "- anchorTruth should explain that maturity is structural capability and readiness is how safely the company can move into practical AI action.",
    "- explanation should be a concise executive narrative using plain language.",
    "",
    "3. currentState",
    "- strengths: what the company is already doing well.",
    "- gaps: what is missing or inconsistent.",
    "- blockers: what could slow progress, create risk, or prevent execution.",
    "",
    "4. opportunities",
    "- note: one short framing paragraph.",
    "- items: 3 to 5 practical business opportunities tied to real workflows.",
    "- Focus on efficiency, manual work reduction, knowledge access, decision support, or coordination.",
    "",
    "5. Northline High Value Entry Points",
    "- use up to 600 words per project but be concise and easy to understand.",
    "- Besure to take into account inputs from the participants where they believe is the best use cases for Ai and automation for the business",
    "- Provide EXACTLY 2 or 3 pilot projects.",
    "- Each must include: name, businessProblem, aiRole, expectedOutcome, whyThisIsAGoodStart.",
    "- These must be high-value, low-risk, practical first moves.",
    "- Do not recommend vendor tools.",
    "- The pilotProjects array is what the product shows as Northline High-Value Entry Points (outcome = expectedOutcome, first move = whyThisIsAGoodStart); make those fields specific and workshop-ready.",
    "",
    "5b. executiveRecommendations (Northline Executive recommendations — separate from pilotProjects)",
    "- This is NOT the three entry-point pilots. It is a structured executive action layer grounded in the same evidence as the memo.",
    "- framing: 2–4 sentences that orient the leadership team on how to use these recommendations in planning and governance forums.",
    "- For each pillar key (systemIntegrity, humanAlignment, strategicCoherence, sustainabilityPractice): write 3–5 sentences of C-suite actionable guidance for improving how AI performs in the business (ownership, sequencing, funding, metrics, policy).",
    "- Each pillar paragraph must reference that pillar's score from INPUT.results.pillars and echo themes from your Executive Memo (e.g., data flows, trust, alignment, sustainment) without contradicting protected scores.",
    "- Tone: decisive, practical, calm; no vendor names; no invented facts.",
    "",
    "6. guardrails",
    "- Include practical bullets for dataProtection, humanOversight, toolGovernance, and adoptionRisks.",
    "",
    "7. actionPlan90Days",
    "- Fill all three phases: days0to30, days31to60, days61to90.",
    "- Each phase must include actions, owners, and successIndicators.",
    "- Be conservative and realistic.",
    "",
    "8. leadershipAlignment",
    "- whereToStart: one concise recommendation.",
    "- whatToPrioritize: concrete leadership priorities.",
    '- suggestedInvestmentLevel must be exactly one of: "low", "moderate", "strategic".',
    "",
    "9. risks",
    "- Use provided risk flags when present.",
    "- implications (shown as 'In brief' in the product) must be a substantive paragraph (at least 4 sentences).",
    "- When INPUT.results.riskFlags is empty, this is a value moment: explain where the organization can still improve AI outcomes even without doctrine flags—summarize themes from your Executive Memo (e.g., data flows, ownership, governance) and connect them to disciplined sequencing.",
    "- When INPUT.results.perceptionAlignmentSignals is non-empty, risks.implications should acknowledge that additional validation may strengthen implementation—without implying respondents were wrong.",
    "- When risk flags exist, implications should connect those flags to leadership sequencing and ownership.",
    "- pillarRiskInterpretation is REQUIRED: four camelCase keys: systemIntegrity, humanAlignment, strategicCoherence, sustainabilityPractice.",
    "- Each pillar field: at least 3 substantial sentences; plain-language, executive audience—what this score means for AI adoption risk OR upside, why it matters, and concrete actions leadership can take (priorities, guardrails, sequencing). Avoid jargon.",
    "- NEVER return placeholder phrases like 'TBD', 'insufficient context', or generic one-liners. If evidence is thin, still write a careful, conservative interpretation grounded in scores and memo themes.",
    "- Each paragraph must tie to that pillar's score from INPUT.results.pillars and reference risk flags that touch that pillar when relevant.",
    "- Explain adoption risk (scope, governance, sequencing) with practical implications—not generic advice.",
    "",
    "10. evidenceUsed",
    "- freeTextThemes: short bullets summarizing patterns seen in free-text responses.",
    "- participantOpportunityThemes: short bullets summarizing patterns seen in participant opportunity notes.",
    "",
    "PERCEPTION & ALIGNMENT LAYER (INPUT.results.perceptionAlignmentSignals):",
    "- These are pattern-based discrepancy checks. They are NOT accusations, NOT score overrides, and NOT claims that respondents were wrong.",
    "- Never identify or infer specific participants, roles, titles, departments, or hierarchy levels in narrative prose.",
    "- Use generic references only (for example: 'one respondent', 'another respondent', 'responses varied across participants').",
    "- Avoid blame-oriented or finger-pointing language. Do not frame recommendations as willingness/failure by a person or leadership group.",
    "- When INPUT.results.perceptionAlignmentSignals is non-empty:",
    "  - Add INPUT.results.perceptionAlignmentExecutiveNote verbatim as its own item in executiveSummaryBullets (one bullet).",
    "  - Reflect the same themes once in maturityInterpretation.explanation (within the Executive narrative / takeaway sections) using neutral, insight-oriented language about validation and cross-functional alignment.",
    "- When the array is empty, ignore this layer.",
    "",
    "OUTPUT RULES:",
    "- Return ONLY valid JSON through the tool.",
    "- No markdown.",
    "- No extra keys.",
    "- Keep the language simple, executive, and workshop-ready.",
  ].join("\n");

  const userText =
    "Generate a workshop-ready executive AI readout that matches the required JSON shape.\n\n" +
    "Important requirements:\n" +
    "- Do not use a real company name, brand, or domain.\n" +
    "- Use only the provided organization.reference value or 'the company'.\n" +
    "- Use the free-text evidence in the analysis.\n" +
    "- Keep every recommendation practical and grounded in the assessment data.\n" +
    "- Return ONLY valid JSON.\n\n" +
    "INPUT:\n" +
    JSON.stringify(aiInput);

  const narrativeToolSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "assessmentId",
      "organization",
      "executiveSummaryBullets",
      "maturityInterpretation",
      "currentState",
      "opportunities",
      "pilotProjects",
      "guardrails",
      "actionPlan90Days",
      "leadershipAlignment",
      "executiveRecommendations",
      "risks",
      "evidenceUsed",
      "missingInputs",
    ],
    properties: {
      schemaVersion: { type: "string" },
      assessmentId: { type: "string" },
      organization: {
        type: "object",
        additionalProperties: false,
        required: ["reference"],
        properties: {
          reference: { type: "string" },
          industry: { anyOf: [{ type: "string" }, { type: "null" }] },
          size: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
      },
      executiveSummaryBullets: {
        type: "array",
        items: { type: "string" },
        maxItems: 6,
      },
      maturityInterpretation: {
        type: "object",
        additionalProperties: false,
        required: ["anchorTruth", "tier", "explanation"],
        properties: {
          anchorTruth: { type: "string" },
          tier: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: { anyOf: [{ type: "string" }, { type: "null" }] },
              posture: { anyOf: [{ type: "string" }, { type: "null" }] },
              protectedScore: { anyOf: [{ type: "number" }, { type: "null" }] },
            },
          },
          explanation: { type: "string", maxLength: 12000 },
        },
      },
      executiveRecommendations: {
        type: "object",
        additionalProperties: false,
        required: [
          "framing",
          "systemIntegrity",
          "humanAlignment",
          "strategicCoherence",
          "sustainabilityPractice",
        ],
        properties: {
          framing: { type: "string", maxLength: 8000 },
          systemIntegrity: { type: "string", maxLength: 8000 },
          humanAlignment: { type: "string", maxLength: 8000 },
          strategicCoherence: { type: "string", maxLength: 8000 },
          sustainabilityPractice: { type: "string", maxLength: 8000 },
        },
      },
      currentState: {
        type: "object",
        additionalProperties: false,
        required: ["strengths", "gaps", "blockers"],
        properties: {
          strengths: { type: "array", items: { type: "string" }, maxItems: 8 },
          gaps: { type: "array", items: { type: "string" }, maxItems: 8 },
          blockers: { type: "array", items: { type: "string" }, maxItems: 8 },
        },
      },
      opportunities: {
        type: "object",
        additionalProperties: false,
        required: ["note", "items"],
        properties: {
          note: { type: "string" },
          items: { type: "array", items: { type: "string" }, maxItems: 8 },
        },
      },
      pilotProjects: {
        type: "array",
        minItems: 2,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "name",
            "businessProblem",
            "aiRole",
            "expectedOutcome",
            "whyThisIsAGoodStart",
          ],
          properties: {
            name: { type: "string" },
            businessProblem: { type: "string" },
            aiRole: { type: "string" },
            expectedOutcome: { type: "string" },
            whyThisIsAGoodStart: { type: "string" },
          },
        },
      },
      guardrails: {
        type: "object",
        additionalProperties: false,
        required: ["dataProtection", "humanOversight", "toolGovernance", "adoptionRisks"],
        properties: {
          dataProtection: { type: "array", items: { type: "string" }, maxItems: 6 },
          humanOversight: { type: "array", items: { type: "string" }, maxItems: 6 },
          toolGovernance: { type: "array", items: { type: "string" }, maxItems: 6 },
          adoptionRisks: { type: "array", items: { type: "string" }, maxItems: 6 },
        },
      },
      actionPlan90Days: {
        type: "object",
        additionalProperties: false,
        required: ["days0to30", "days31to60", "days61to90"],
        properties: {
          days0to30: {
            type: "object",
            additionalProperties: false,
            required: ["actions", "owners", "successIndicators"],
            properties: {
              actions: { type: "array", items: { type: "string" }, maxItems: 8 },
              owners: { type: "array", items: { type: "string" }, maxItems: 8 },
              successIndicators: { type: "array", items: { type: "string" }, maxItems: 8 },
            },
          },
          days31to60: {
            type: "object",
            additionalProperties: false,
            required: ["actions", "owners", "successIndicators"],
            properties: {
              actions: { type: "array", items: { type: "string" }, maxItems: 8 },
              owners: { type: "array", items: { type: "string" }, maxItems: 8 },
              successIndicators: { type: "array", items: { type: "string" }, maxItems: 8 },
            },
          },
          days61to90: {
            type: "object",
            additionalProperties: false,
            required: ["actions", "owners", "successIndicators"],
            properties: {
              actions: { type: "array", items: { type: "string" }, maxItems: 8 },
              owners: { type: "array", items: { type: "string" }, maxItems: 8 },
              successIndicators: { type: "array", items: { type: "string" }, maxItems: 8 },
            },
          },
        },
      },
      leadershipAlignment: {
        type: "object",
        additionalProperties: false,
        required: ["whereToStart", "whatToPrioritize", "suggestedInvestmentLevel"],
        properties: {
          whereToStart: { type: "string" },
          whatToPrioritize: { type: "array", items: { type: "string" }, maxItems: 6 },
          suggestedInvestmentLevel: {
            type: "string",
            enum: ["low", "moderate", "strategic"],
          },
        },
      },
      risks: {
        type: "object",
        additionalProperties: false,
        required: ["flags", "implications", "pillarRiskInterpretation"],
        properties: {
          flags: { type: "array", items: {} },
          implications: { type: "string", maxLength: 8000 },
          pillarRiskInterpretation: {
            type: "object",
            additionalProperties: false,
            required: [
              "systemIntegrity",
              "humanAlignment",
              "strategicCoherence",
              "sustainabilityPractice",
            ],
            properties: {
              systemIntegrity: { type: "string", maxLength: 4800 },
              humanAlignment: { type: "string", maxLength: 4800 },
              strategicCoherence: { type: "string", maxLength: 4800 },
              sustainabilityPractice: { type: "string", maxLength: 4800 },
            },
          },
        },
      },
      evidenceUsed: {
        type: "object",
        additionalProperties: false,
        required: ["freeTextThemes", "participantOpportunityThemes"],
        properties: {
          freeTextThemes: { type: "array", items: { type: "string" }, maxItems: 10 },
          participantOpportunityThemes: {
            type: "array",
            items: { type: "string" },
            maxItems: 10,
          },
        },
      },
      missingInputs: { type: "array", items: { type: "string" }, maxItems: 20 },
    },
  } as const;

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    system: systemText,
    messages: [{ role: "user", content: userText }],
    tools: [
      {
        name: "narrative_json",
        description:
          "Return the executive narrative as structured JSON matching the required schema.",
        input_schema: narrativeToolSchema as any,
      },
    ],
    tool_choice: { type: "tool", name: "narrative_json" },
  } as any);

  const toolUse = (response as any)?.content?.find(
    (b: any) => b?.type === "tool_use" && b?.name === "narrative_json"
  );

  const toolInput = toolUse?.input;

  if (!toolInput || typeof toolInput !== "object") {
    console.log("AI RAW CONTENT (debug):", (response as any)?.content);
    throw new Error("Anthropic did not return tool JSON (tool_use input missing).");
  }

  return toolInput;
}

/**
 * Stable stringify: deterministic key ordering to make input_hash reproducible.
 */
function stableStringify(value: any): string {
  const seen = new WeakSet();

  const sorter = (obj: any): any => {
    if (obj === null || typeof obj !== "object") return obj;
    if (seen.has(obj)) return "[Circular]";
    seen.add(obj);
    if (Array.isArray(obj)) return obj.map(sorter);

    const keys = Object.keys(obj).sort();
    const out: Record<string, any> = {};
    for (const k of keys) out[k] = sorter(obj[k]);
    return out;
  };

  return JSON.stringify(sorter(value));
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function sha256NullableText(input: string | null | undefined): string | null {
  if (!input) return null;
  return sha256(input);
}

function fmtPillarScore(results: any, key: string) {
  const v = results?.aggregate?.pillars?.[key]?.weightedAverage;
  return typeof v === "number" ? v.toFixed(2) : "n/a";
}

function placeholderPillarRiskInterpretation(results: any, riskFlags: any[]) {
  const si = fmtPillarScore(results, "SYSTEM_INTEGRITY");
  const ha = fmtPillarScore(results, "HUMAN_ALIGNMENT");
  const sc = fmtPillarScore(results, "STRATEGIC_COHERENCE");
  const sp = fmtPillarScore(results, "SUSTAINABILITY_PRACTICE");
  const anyFlags = Array.isArray(riskFlags) && riskFlags.length > 0;

  return {
    systemIntegrity: [
      `System Integrity is at ${si} on a 1–5 scale. This pillar speaks to whether data, workflows, and operational discipline can support AI without amplifying errors or ambiguity.`,
      anyFlags
        ? "Structural risk signals are present in the assessment—treat weak foundations as a constraint on automation breadth until ownership and data access are clarified."
        : "Even without triggered doctrine flags, use this score as a practical gate for how much autonomy any model should have in production-like workflows.",
      "Enable full AI narrative generation for a deeper, evidence-grounded interpretation.",
    ].join(" "),
    humanAlignment: [
      `Human Alignment reads ${ha}. It reflects training, trust, review habits, and how teams absorb new ways of working.`,
      "Low to middling scores usually mean narrower pilots, clearer human review checkpoints, and simpler user experiences—not smaller ambitions across every team at once.",
      "Use participant evidence and opportunity notes to name where friction will show up first.",
    ].join(" "),
    strategicCoherence: [
      `Strategic Coherence is ${sc}. It captures whether efforts line up with stated priorities, customers, and measurable outcomes.`,
      "When this pillar lags, AI work can still be useful, but it should be tied to one or two executive-owned outcomes so it does not become an orphan initiative.",
      "The radar view alongside this memo should make gaps obvious for leadership discussion.",
    ].join(" "),
    sustainabilityPractice: [
      `Sustainability Practice scores ${sp}. It covers governance rhythms, maintenance expectations, and whether change will stick after the workshop.`,
      "Strong launch plans fail when no one owns monitoring, retraining, and policy updates; call that out plainly in sequencing and pilot adoption rules.",
      "Regenerate with AI enabled for pillar narratives tuned to this organization's actual responses.",
    ].join(" "),
  };
}

function buildPlaceholderNarrative(args: {
  assessmentId: string;
  org: { industry?: string | null; size?: string | null };
  results: any;
  docCount: number;
}) {
  const { assessmentId, org, results, docCount } = args;

  const maturity = results?.maturity ?? {};
  const riskFlags = results?.riskFlags ?? [];
  const reference = results?.narrativeContext?.reference?.companyDescriptor ?? "the company";

  const tierLabel = maturity?.label ?? "Unknown";
  const posture = maturity?.posture ?? "Unknown";
  const protectedScore = maturity?.tierScore ?? null;

  const freeTextResponses = results?.narrativeContext?.evidence?.freeTextResponses ?? [];
  const participantOpportunityNotes =
    results?.narrativeContext?.evidence?.participantOpportunityNotes ?? [];

  return {
    schemaVersion: "2.0",
    assessmentId,
    organization: {
      reference,
      industry: org.industry ?? null,
      size: org.size ?? null,
    },
    executiveSummaryBullets: (() => {
      const bullets = [
        `${reference} shows a current maturity profile of ${tierLabel}${
          posture ? ` with a ${String(posture).toLowerCase()} posture` : ""
        }.`,
        protectedScore !== null
          ? `The protected readiness score is ${protectedScore}, which should guide sequencing and expectations.`
          : "The protected readiness score could not be calculated from available data.",
        riskFlags.length > 0
          ? "There are clear structural risks that should shape how the first AI efforts are scoped."
          : "No major doctrine-based risk flags were triggered, but disciplined sequencing still matters.",
        "The next step should focus on a small number of practical, low-risk pilots tied to real workflow friction.",
      ];
      const perception = results?.perceptionAlignmentSignals;
      if (Array.isArray(perception) && perception.length > 0) {
        bullets.push(PERCEPTION_ALIGNMENT_EXECUTIVE_NOTE);
      }
      return bullets;
    })(),
    maturityInterpretation: {
      anchorTruth:
        "Maturity represents structural capability, while readiness indicates how safely the company can move into practical AI action.",
      tier: { label: tierLabel, posture, protectedScore },
      explanation:
        results?.protectionExplanation ??
        "Protected readiness and maturity results are available, but the narrative explanation is currently using a fallback.",
    },
    currentState: {
      strengths: [],
      gaps: [],
      blockers: [],
    },
    opportunities: {
      note:
        "Opportunity areas should be grounded in the assessment results, intake context, and the free-text participant evidence.",
      items: [],
    },
    pilotProjects: [
      {
        name: "Operations Knowledge Support Pilot",
        businessProblem:
          "Teams may be losing time finding information, clarifying steps, or handling repeat requests manually.",
        aiRole:
          "Use AI to surface approved internal knowledge and support faster execution in a narrow workflow.",
        expectedOutcome:
          "Reduce repeat manual effort and improve consistency in routine decisions.",
        whyThisIsAGoodStart:
          "It is practical, bounded, and easier to govern than a broad automation rollout.",
      },
      {
        name: "Manual Workflow Reduction Pilot",
        businessProblem:
          "The assessment suggests there may be opportunities to reduce repetitive coordination or administrative work.",
        aiRole:
          "Use AI assistance to summarize, draft, classify, or route work inside one defined process.",
        expectedOutcome: "Save time, reduce friction, and show measurable value quickly.",
        whyThisIsAGoodStart:
          "It is easier to test and measure before expanding into broader transformation work.",
      },
    ],
    guardrails: {
      dataProtection: [],
      humanOversight: [],
      toolGovernance: [],
      adoptionRisks: [],
    },
    actionPlan90Days: {
      days0to30: { actions: [], owners: [], successIndicators: [] },
      days31to60: { actions: [], owners: [], successIndicators: [] },
      days61to90: { actions: [], owners: [], successIndicators: [] },
    },
    leadershipAlignment: {
      whereToStart: "Start with one or two narrow pilots tied to clear operational friction.",
      whatToPrioritize: [],
      suggestedInvestmentLevel: "low",
    },
    executiveRecommendations: defaultExecutiveRecommendations({
      assessmentId,
      companyReference: reference,
      industry: org.industry ?? null,
      size: org.size ?? null,
      aggregatePillars: results?.aggregate?.pillars ?? null,
    }),
    risks: {
      flags: riskFlags,
      implications:
        riskFlags.length > 0
          ? "Structural risks are present and should influence sequencing, ownership, and guardrails."
          : "No major doctrine-based risk flags were triggered, but early efforts should still stay narrow and measurable.",
      pillarRiskInterpretation: placeholderPillarRiskInterpretation(results, riskFlags),
    },
    evidenceUsed: {
      freeTextThemes: freeTextResponses
        .slice(0, 5)
        .map((x: any) => x?.answer ?? "")
        .filter(Boolean),
      participantOpportunityThemes: participantOpportunityNotes
        .slice(0, 5)
        .map((x: any) => x?.note ?? "")
        .filter(Boolean),
    },
    missingInputs: [
      "This is a fallback narrative structure.",
      freeTextResponses.length === 0 ? "No response-level free-text evidence was available." : null,
      participantOpportunityNotes.length === 0
        ? "No participant AI opportunity notes were available."
        : null,
      docCount > 0 ? null : "No organization documents were available for additional grounding.",
    ].filter(Boolean),
  };
}

function buildUnauthorized(message?: string) {
  return NextResponse.json({ ok: false, error: "Unauthorized", message }, { status: 401 });
}

/**
 * Raw SQL helper coverage for fields currently out of sync with Prisma TS types:
 * - Participant.invite_token_expires_at, invite_accepted_at, completed_at
 * - Assessment.locked_at
 */

async function assertInviteAccess(args: { assessmentId: string; email: string; token: string }) {
  const email = args.email.trim().toLowerCase();
  const tokenHash = crypto.createHash("sha256").update(args.token).digest("hex");

  const rows = await prisma.$queryRaw<Array<{ id: string; can_view_executive_insights: boolean }>>`
    SELECT id, can_view_executive_insights
    FROM "Participant"
    WHERE assessment_id = ${args.assessmentId}::uuid
      AND email = ${email}
      AND invite_token_hash = ${tokenHash}
      AND (invite_token_expires_at IS NULL OR invite_token_expires_at > NOW())
    LIMIT 1;
  `;

  const row = rows?.[0] ?? null;
  if (!row || !row.can_view_executive_insights) return { ok: false as const, participantId: null as any };

  return { ok: true as const, participantId: row.id };
}

async function markInviteAccepted(participantId: string) {
  await prisma.$executeRaw`
    UPDATE "Participant"
    SET invite_accepted_at = COALESCE(invite_accepted_at, NOW())
    WHERE id = ${participantId}::uuid;
  `;
}

async function lockAssessmentIfUnlocked(assessmentId: string) {
  await prisma.$executeRaw`
    UPDATE "Assessment"
    SET locked_at = NOW()
    WHERE id = ${assessmentId}::uuid
      AND locked_at IS NULL;
  `;
}

async function getAssessmentLockSnapshot(assessmentId: string) {
  const rows = await prisma.$queryRaw<Array<{ id: string; locked_at: Date | null; status: string }>>`
    SELECT id, locked_at, status
    FROM "Assessment"
    WHERE id = ${assessmentId}::uuid
    LIMIT 1;
  `;
  return rows?.[0] ?? null;
}

/**
 * GET: fetch latest narrative (auth: invite OR supabase session) + cache/inflight + completion gate
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const params = await context.params;
    const parsed = ParamsSchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid assessment id (UUID)" }, { status: 400 });
    }
    const assessmentId = parsed.data.id;

    const url = new URL(req.url);
    const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
    const token = (url.searchParams.get("token") ?? "").trim();

    let cacheKeyOwner = "anon";

    if (email && token) {
      const access = await assertInviteAccess({ assessmentId, email, token });
      if (!access.ok) return buildUnauthorized("Invalid or expired invite link.");
      cacheKeyOwner = `invite:${access.participantId}`;
    } else {
      const supabase = await getSupabaseServerClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) return buildUnauthorized();

      const membership = await prisma.participant.findFirst({
        where: { assessment_id: assessmentId, user_id: user.id },
        select: { id: true },
      });
      if (!membership && !isAdminEmail(user.email ?? null)) {
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }

      cacheKeyOwner = `admin:${user.id}`;
    }

    const cacheKey = `assessment-narrative:${assessmentId}:${cacheKeyOwner}`;

    const cached = narrativeCacheGet(cacheKey);
    if (cached) return NextResponse.json(cached, { status: 200 });

    const existingInflight = narrativeInflight.get(cacheKey);
    if (existingInflight) {
      const payload = await existingInflight;
      return NextResponse.json(payload, { status: 200 });
    }

    const p = (async () => {
      const completion = await getReportingParticipantCompletionStats(assessmentId);
      const latest = await prisma.assessmentNarrative.findFirst({
        where: { assessment_id: assessmentId },
        orderBy: [{ version: "desc" }],
      });

      return {
        ok: true,
        narrative: latest,
        participants_total: completion.participants_total,
        participants_completed: completion.participants_completed,
        all_participants_completed: completion.all_participants_completed,
        progress_message: completion.all_participants_completed
          ? null
          : ASSESSMENTS_IN_PROGRESS_MESSAGE,
      };
    })();

    narrativeInflight.set(cacheKey, p);

    let payload: any;
    try {
      payload = await p;
    } finally {
      narrativeInflight.delete(cacheKey);
    }

    narrativeCacheSet(cacheKey, payload);
    return NextResponse.json(payload, { status: 200 });
  } catch (err: any) {
    console.error("GET narrative error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error.", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}

/**
 * POST: generate a new narrative (auth: admin session OR invite).
 * Features preserved:
 * - invite + admin auth
 * - draft regeneration (admin only)
 * - force regeneration (dev only + flag)
 * - deterministic input hash
 * - AI behind flag, fallback placeholder
 * - narrative versioning
 * - assessment locking
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const params = await context.params;
    const parsed = ParamsSchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid assessment id (UUID)" }, { status: 400 });
    }
    const assessmentId = parsed.data.id;

    const urlForAuth = req.nextUrl;

    const qsEmail = (urlForAuth.searchParams.get("email") ?? "").trim().toLowerCase();
    const qsToken = (urlForAuth.searchParams.get("token") ?? "").trim();

    let bodyEmail = "";
    let bodyToken = "";
    {
      const ct = req.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const body = await req.json().catch(() => ({} as any));
        bodyEmail = String((body as any)?.email ?? "").trim().toLowerCase();
        bodyToken = String((body as any)?.token ?? "").trim();
      }
    }

    const finalEmail = bodyEmail || qsEmail;
    const finalToken = bodyToken || qsToken;

    let user: { id: string; email?: string | null } | null = null;
    let authType: "admin" | "invite" = "invite";
    let participantIdForAccess: string | null = null;
    let adminSessionWithoutParticipant = false;

    {
      const supabase = await getSupabaseServerClient();
      const {
        data: { user: supaUser },
        error: userError,
      } = await supabase.auth.getUser();

      if (!userError && supaUser?.id) {
        user = { id: supaUser.id, email: supaUser.email };
        authType = "admin";

        const membership = await prisma.participant.findFirst({
          where: { assessment_id: assessmentId, user_id: supaUser.id },
          select: { id: true },
        });

        if (membership) {
          const visibilityRows = await prisma.$queryRaw<Array<{ can_view_executive_insights: boolean }>>`
            SELECT can_view_executive_insights
            FROM "Participant"
            WHERE id = ${membership.id}::uuid
            LIMIT 1;
          `;
          const canView = visibilityRows?.[0]?.can_view_executive_insights ?? true;
          if (!canView) {
            return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
          }
          participantIdForAccess = membership.id;
        } else if (isAdminEmail(supaUser.email ?? null)) {
          adminSessionWithoutParticipant = true;
        } else {
          return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
        }
      }
    }

    if (!participantIdForAccess && !adminSessionWithoutParticipant) {
      if (!finalEmail || !finalToken) {
        return buildUnauthorized("Missing email or token.");
      }

      const access = await assertInviteAccess({
        assessmentId,
        email: finalEmail,
        token: finalToken,
      });
      if (!access.ok) return buildUnauthorized("Invalid or expired invite link.");

      participantIdForAccess = access.participantId;
      authType = "invite";

      await markInviteAccepted(participantIdForAccess);
    }

    const allowForce =
      process.env.NODE_ENV !== "production" &&
      String(process.env.ALLOW_NARRATIVE_FORCE ?? "").toLowerCase() === "true";

    const force =
      allowForce &&
      ["1", "true", "yes"].includes((req.nextUrl.searchParams.get("force") ?? "").toLowerCase());

    const draft = ["1", "true", "yes"].includes(
      (req.nextUrl.searchParams.get("draft") ?? "").toLowerCase()
    );

    const isAdmin = authType === "admin" && isAdminEmail(user?.email ?? null);

    if (draft && !isAdmin) {
      return NextResponse.json(
        {
          ok: false,
          error: "Forbidden",
          message: "Admin only: draft regeneration is not allowed for participants.",
        },
        { status: 403 }
      );
    }

    const completion = await getReportingParticipantCompletionStats(assessmentId);
    if (!completion.all_participants_completed) {
      return NextResponse.json(
        {
          ok: false,
          error: `${ASSESSMENTS_IN_PROGRESS_MESSAGE} The narrative memo unlocks after every invited participant has submitted.`,
          meta: {
            total: completion.participants_total,
            completed: completion.participants_completed,
          },
        },
        { status: 409 }
      );
    }

    const results = await buildAssessmentResultsPayload({ assessmentId });
    if (!results.ok) {
      return NextResponse.json(results.body, { status: results.status });
    }
    
    const resultsBody = results.body;
    const assessment = resultsBody?.assessment;
    
    if (!assessment) {
      return NextResponse.json(
        { ok: false, error: "Assessment payload is missing assessment metadata." },
        { status: 500 }
      );
    }
    
    const org = await prisma.organization.findUnique({
      where: { id: assessment.organization_id },
      select: {
        id: true,
        name: true,
        industry: true,
        size: true,
        growth_stage: true,
        primary_pressures: true,
        website: true,
      },
    });

    if (!org) {
      return NextResponse.json({ ok: false, error: "Organization not found" }, { status: 404 });
    }

    const docs = await prisma.organizationDocument.findMany({
      where: { organization_id: org.id },
      select: {
        id: true,
        title: true,
        source_type: true,
        source_url: true,
        storage_path: true,
        mime_type: true,
        created_at: true,
        text_extracted: true,
      },
      orderBy: [{ created_at: "desc" }],
    });

    const docsEvidence = docs
      .map((d) => {
        const title = anonymizeOrgText({
          text: d.title,
          organizationName: org.name ?? null,
          industry: org.industry ?? null,
        });
        const excerpt = anonymizeOrgText({
          text: d.text_extracted,
          organizationName: org.name ?? null,
          industry: org.industry ?? null,
        });
        if (!excerpt) return null;
        return {
          title: title ?? "uploaded document",
          excerpt: excerpt.slice(0, 2000),
        };
      })
      .filter((x): x is { title: string; excerpt: string } => x !== null)
      .slice(0, 12);

    const docFingerprints = docs.map((d) => ({
      id: d.id,
      title: d.title,
      source_type: d.source_type,
      source_url: d.source_url ?? null,
      storage_path: d.storage_path ?? null,
      mime_type: d.mime_type ?? null,
      created_at: d.created_at,
      text_hash: sha256NullableText(d.text_extracted),
    }));

    function normalizeForHash(value: any): any {
      if (value === null || value === undefined) return value;
      if (typeof value !== "object") return value;
      if (value instanceof Date) return null;

      if (Array.isArray(value)) {
        const arr = value.map(normalizeForHash);

        const allObjs = arr.every((x) => x && typeof x === "object" && !Array.isArray(x));
        if (allObjs) {
          const sortable = arr as any[];
          const getSortKey = (o: any) =>
            String(o?.key ?? o?.id ?? o?.rule ?? o?.title ?? o?.name ?? "");
          return sortable.slice().sort((a, b) => getSortKey(a).localeCompare(getSortKey(b)));
        }

        const allPrimitives = arr.every(
          (x) => x === null || ["string", "number", "boolean"].includes(typeof x)
        );
        if (allPrimitives) {
          return (arr as any[]).slice().sort((a, b) => String(a).localeCompare(String(b)));
        }

        return arr;
      }

      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) {
        const key = String(k);
        const upper = key.toUpperCase();

        const isVolatileKey =
          upper.endsWith("_AT") ||
          upper.endsWith("AT") ||
          upper === "GENERATEDAT" ||
          upper === "COMPUTEDAT" ||
          upper === "REQUESTEDAT" ||
          upper === "SERVERNOW" ||
          upper === "SERVERTIME" ||
          upper === "NOW";

        if (isVolatileKey) continue;
        out[key] = normalizeForHash(v);
      }
      return out;
    }

    let webContextForHash: { excerpt_sha256: string | null; summary_present: boolean } = {
      excerpt_sha256: null,
      summary_present: false,
    };
    let publicWebSummaryForAi: string | null = null;

    if (isNarrativeAIEnabled() && isWebEnrichmentEnabled() && org.website) {
      const siteUrl = normalizePublicWebsiteUrl(org.website);
      if (siteUrl) {
        const fetched = await fetchPublicWebsiteExcerpt(siteUrl);
        if (fetched) {
          publicWebSummaryForAi = await summarizePublicWebExcerptForMemo({
            excerpt: fetched.excerpt,
            industry: org.industry ?? null,
          });
          webContextForHash = {
            excerpt_sha256: fetched.excerptSha256,
            summary_present: Boolean(publicWebSummaryForAi),
          };
        }
      }
    }

    const canonicalInput = {
      engine_version: "v2.0",
      schema_version: "2.0",
      assessment_id: assessmentId,
      organization: {
        id: org.id,
        name: org.name,
        industry: org.industry ?? null,
        size: org.size ?? null,
        growth_stage: org.growth_stage ?? null,
        primary_pressures: org.primary_pressures ?? null,
      },
      web_context: webContextForHash,
      results: normalizeForHash(resultsBody),
      documents: docFingerprints,
    };

    const input_hash = sha256(stableStringify(canonicalInput));

    const finalNarrative = await prisma.assessmentNarrative.findFirst({
      where: { assessment_id: assessmentId, status: "FINAL" },
      orderBy: [{ version: "desc" }],
    });

    if (finalNarrative && !draft) {
      await lockAssessmentIfUnlocked(assessmentId);
      return NextResponse.json({ ok: true, cached: true, narrative: finalNarrative }, { status: 200 });
    }

    if (draft) {
      const cachedDraft = await prisma.assessmentNarrative.findFirst({
        where: { assessment_id: assessmentId, status: "DRAFT", input_hash },
        orderBy: [{ version: "desc" }],
      });

      if (cachedDraft && !force) {
        await lockAssessmentIfUnlocked(assessmentId);
        return NextResponse.json({ ok: true, cached: true, narrative: cachedDraft }, { status: 200 });
      }
    }

    const latest = await prisma.assessmentNarrative.findFirst({
      where: { assessment_id: assessmentId },
      orderBy: [{ version: "desc" }],
    });

    if (latest && latest.input_hash === input_hash && !force) {
      await lockAssessmentIfUnlocked(assessmentId);
      return NextResponse.json({ ok: true, cached: true, narrative: latest }, { status: 200 });
    }

    if (latest && !force && !draft) {
      await lockAssessmentIfUnlocked(assessmentId);
      const snap = await getAssessmentLockSnapshot(assessmentId);
      return NextResponse.json(
        {
          ok: true,
          cached: true,
          narrative: latest,
          note:
            "A narrative already exists. Returning the latest narrative instead of rejecting with 409.",
          lock: { assessment: snap },
        },
        { status: 200 }
      );
    }

    const nextVersion = (latest?.version ?? 0) + 1;

    let narrativeCandidate: any;
    let usedAI = false;

    if (isNarrativeAIEnabled()) {
      try {
        narrativeCandidate = await generateNarrativeJsonWithAI({
          assessmentId,
          org: {
            industry: org.industry ?? null,
            size: org.size ?? null,
          },
          resultsBody: results.body,
          docCount: docs.length,
          docsEvidence,
          orgLegalName: org.name ?? null,
          publicWebSummary: publicWebSummaryForAi,
        });
        usedAI = true;
      } catch (e: any) {
        console.warn("AI narrative generation failed; falling back to placeholder:", {
          message: e?.message ?? null,
          name: e?.name ?? null,
        });
        narrativeCandidate = buildPlaceholderNarrative({
          assessmentId,
          org: {
            industry: org.industry ?? null,
            size: org.size ?? null,
          },
          results: results.body,
          docCount: docs.length,
        });
      }
    } else {
      narrativeCandidate = buildPlaceholderNarrative({
        assessmentId,
        org: {
          industry: org.industry ?? null,
          size: org.size ?? null,
        },
        results: results.body,
        docCount: docs.length,
      });
    }

    const narrative_json = sanitizeNarrativeJson(narrativeCandidate, {
      assessmentId,
      companyReference:
        results.body?.narrativeContext?.reference?.companyDescriptor ?? "the company",
      industry: org.industry ?? null,
      size: org.size ?? null,
      aggregatePillars: results.body?.aggregate?.pillars ?? null,
    });

    const created = await prisma.assessmentNarrative.create({
      data: {
        assessment_id: assessmentId,
        version: nextVersion,
        status: "DRAFT",
        input_hash,
        engine_version: "v2.0",
        schema_version: "2.0",
        prompt_version: usedAI ? "northline-workshop-v2.3" : "placeholder-v2",
        model_provider: usedAI ? "anthropic" : null,
        model_name: usedAI ? (process.env.NARRATIVE_AI_MODEL || DEFAULT_NARRATIVE_MODEL) : null,
        narrative_json,
        memo_markdown: null,
      },
    });

    await lockAssessmentIfUnlocked(assessmentId);

    return NextResponse.json({ ok: true, cached: false, narrative: created }, { status: 201 });
  } catch (err: any) {
    console.error("POST /api/assessments/[id]/narrative/generate error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error.", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
