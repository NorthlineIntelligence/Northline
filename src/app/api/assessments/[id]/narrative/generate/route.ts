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

const ParamsSchema = z.object({ id: z.string().uuid() });
const DEFAULT_NARRATIVE_MODEL = "claude-sonnet-4-6";
const SCHEMA_VERSION = "3.0";
const ENGINE_VERSION = "v3.0";
const PROMPT_VERSION = "northline-executive-insights-v3";

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

const TrimmedText = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v),
  z.string().min(1).max(8000)
);

const ShortBullet = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v),
  z.string().min(1).max(600)
);

const ExecutiveMemoText = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v),
  z.string().min(1).max(7000)
);

const RiskInterpretationText = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v),
  z.string().min(1).max(2500)
);

const EntryPointLongText = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v),
  z.string().min(1).max(4500)
);

const NarrativeSchema = z
  .object({
    schemaVersion: z.string().min(1).max(20),
    assessmentId: z.string().uuid(),

    organization: z
      .object({
        reference: TrimmedText,
        industry: z.union([TrimmedText, z.null()]).optional(),
        size: z.union([TrimmedText, z.null()]).optional(),
      })
      .strip(),

    executiveSummaryBullets: z.array(ShortBullet).max(6).default([]),

    executiveMemo: z
      .object({
        heading: ShortBullet,
        body: ExecutiveMemoText,
      })
      .strip(),

    maturityInterpretation: z
      .object({
        anchorTruth: TrimmedText,
        tier: z
          .object({
            label: z.union([TrimmedText, z.null()]).optional(),
            posture: z.union([TrimmedText, z.null()]).optional(),
            protectedScore: z.union([z.number(), z.null()]).optional(),
          })
          .strip(),
        explanation: ExecutiveMemoText,
      })
      .strip(),

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

    structuredPillarBreakdown: z
      .array(
        z
          .object({
            pillar: ShortBullet,
            score: z.number(),
            interpretation: TrimmedText,
          })
          .strip()
      )
      .min(4)
      .max(4)
      .default([]),

    pilotProjects: z
      .array(
        z
          .object({
            name: ShortBullet,
            businessProblem: TrimmedText,
            aiRole: TrimmedText,
            expectedOutcome: TrimmedText,
            whyThisIsAGoodStart: TrimmedText,
            firstMove: TrimmedText,
          })
          .strip()
      )
      .min(3)
      .max(3)
      .default([]),

    highValueEntryPoints: z
      .array(
        z
          .object({
            projectName: ShortBullet,
            outcome: TrimmedText,
            firstMove: TrimmedText,
            whyNow: TrimmedText,
            executiveRationale: EntryPointLongText,
          })
          .strip()
      )
      .min(3)
      .max(3)
      .default([]),

    suggestedSequencing: z
      .object({
        phase0to30: TrimmedText,
        phase31to90: TrimmedText,
        phase90Plus: TrimmedText,
      })
      .strip(),

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
        summary: ShortBullet,
        implications: RiskInterpretationText,
      })
      .strip(),

    riskSignals: z
      .object({
        summary: ShortBullet,
        count: z.number(),
        interpretation: RiskInterpretationText,
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

function fallbackNarrative(ctx: {
  assessmentId: string;
  companyReference: string;
  industry?: string | null;
  size?: string | null;
}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    assessmentId: ctx.assessmentId,
    organization: {
      reference: ctx.companyReference,
      industry: ctx.industry ?? null,
      size: ctx.size ?? null,
    },
    executiveSummaryBullets: [
      "Narrative summary is temporarily unavailable due to an output validation issue.",
      "Core assessment results are still available and can be used for workshop preparation.",
      "Use the protected readiness score and pillar balance as the source of truth for sequencing.",
      "Keep the first AI efforts narrow, measurable, and tied to operational friction.",
    ],
    executiveMemo: {
      heading: "Executive decision-making module.",
      body:
        "The executive narrative could not be generated in a validated form. Use the protected readiness score, pillar balance, and risk flags as the source of truth. The practical next step is to choose one narrow pilot tied to a recurring business bottleneck, assign clear ownership, and define success in operational terms before any wider rollout.",
    },
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
    structuredPillarBreakdown: [],
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
        firstMove:
          "Identify one recurring workflow where teams repeatedly search for the same internal answers.",
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
        firstMove:
          "Map one manual workflow with repeat handoffs, delays, or frequent rework.",
      },
      {
        name: "Reporting and Summary Automation Pilot",
        businessProblem:
          "Leadership teams often spend unnecessary time turning raw updates into recurring summaries and status reports.",
        aiRole:
          "Use AI to generate first-draft summaries and recurring update packages inside one controlled reporting process.",
        expectedOutcome:
          "Reduce reporting effort, improve consistency, and speed up internal decision cycles.",
        whyThisIsAGoodStart:
          "It is visible, low risk, and easier to measure than a broad process redesign.",
        firstMove:
          "Choose one recurring reporting workflow and document the current inputs, owners, and delays.",
      },
    ],
    highValueEntryPoints: [
      {
        projectName: "Operations Knowledge Support Pilot",
        outcome:
          "Reduce time spent finding approved information and improve consistency in routine execution.",
        firstMove:
          "Identify one recurring workflow where teams repeatedly search for the same internal answers.",
        whyNow:
          "This is a bounded, practical starting point that fits an early-stage execution posture.",
        executiveRationale:
          "This entry point is valuable because it targets a visible source of friction without requiring a large system overhaul. When teams repeatedly stop to find the same information, the cost shows up in cycle time, inconsistency, and avoidable managerial escalations. A focused knowledge support pilot gives leadership a controlled way to test AI in a real workflow, prove value quickly, and build confidence before moving into broader automation. It also creates a cleaner path for governance because the scope is narrow, the content can be curated, and the human review model is straightforward.",
      },
      {
        projectName: "Manual Workflow Reduction Pilot",
        outcome:
          "Reduce repetitive coordination and administrative effort in one defined process.",
        firstMove:
          "Map one manual workflow with repeat handoffs, delays, or frequent rework.",
        whyNow:
          "This creates measurable value without requiring broad transformation.",
        executiveRationale:
          "This is a strong early entry point because it focuses on a workflow that already consumes time and attention every week. Instead of trying to transform the organization at once, leadership can isolate one process where summaries, routing, classification, or drafting create visible drag. That makes the business case easier to understand and the operating risk easier to contain. It also helps the organization build better habits around ownership, success metrics, and adoption support, which are the same muscles needed for more ambitious AI work later.",
      },
      {
        projectName: "Reporting and Summary Automation Pilot",
        outcome:
          "Shorten the time required to produce recurring updates, summaries, or internal reporting outputs.",
        firstMove:
          "Choose one recurring reporting workflow and document the current inputs, owners, and delays.",
        whyNow:
          "This is visible to leadership, easy to measure, and relatively low risk.",
        executiveRationale:
          "This entry point works well when leadership wants a practical win that is both visible and governable. Reporting workflows often sit in the background, but they consume meaningful staff time and can slow down decision-making when updates are delayed or inconsistent. A controlled summary automation pilot can improve speed and consistency while preserving human review. That makes it well suited for organizations that need proof of value, stronger internal alignment, and a manageable way to introduce AI into everyday work without creating operational disruption.",
      },
    ],
    suggestedSequencing: {
      phase0to30:
        "Choose one narrow workflow, define success, confirm the data inputs needed, and assign role-based ownership.",
      phase31to90:
        "Launch one controlled pilot, monitor adoption and output quality, and refine the workflow using real operating feedback.",
      phase90Plus:
        "Expand only after the first pilot shows measurable value, clear oversight, and enough internal discipline to sustain the work.",
    },
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
      whereToStart: "Start with one narrowly scoped pilot tied to clear operational friction.",
      whatToPrioritize: [],
      suggestedInvestmentLevel: "low",
    },
    risks: {
      flags: [],
      summary: "No validated narrative risk summary available.",
      implications:
        "Narrative validation failed; review risk signals and protected scoring directly in the assessment results payload.",
    },
    riskSignals: {
      summary: "Narrative validation failed.",
      count: 0,
      interpretation:
        "Narrative validation failed; review risk signals directly in the protected results payload.",
    },
    evidenceUsed: {
      freeTextThemes: [],
      participantOpportunityThemes: [],
    },
    missingInputs: ["Narrative output did not pass schema validation."],
  };
}

function sanitizeNarrativeJson(
  input: any,
  ctx: {
    assessmentId: string;
    companyReference: string;
    industry?: string | null;
    size?: string | null;
  }
) {
  const normalized =
    input && typeof input === "object"
      ? {
          ...input,
          schemaVersion:
            typeof input.schemaVersion === "string" ? input.schemaVersion : SCHEMA_VERSION,
          assessmentId:
            typeof input.assessmentId === "string" ? input.assessmentId : ctx.assessmentId,
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
          executiveMemo:
            input.executiveMemo && typeof input.executiveMemo === "object"
              ? input.executiveMemo
              : {
                  heading: "Executive decision-making module.",
                  body:
                    "Executive memo unavailable. Use the protected readiness score and pillar balance as the source of truth.",
                },
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
          structuredPillarBreakdown: Array.isArray(input.structuredPillarBreakdown)
            ? input.structuredPillarBreakdown
            : [],
          pilotProjects: Array.isArray(input.pilotProjects) ? input.pilotProjects : [],
          highValueEntryPoints: Array.isArray(input.highValueEntryPoints)
            ? input.highValueEntryPoints
            : [],
          suggestedSequencing:
            input.suggestedSequencing && typeof input.suggestedSequencing === "object"
              ? input.suggestedSequencing
              : {
                  phase0to30: "TBD (insufficient context).",
                  phase31to90: "TBD (insufficient context).",
                  phase90Plus: "TBD (insufficient context).",
                },
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
          risks:
            input.risks && typeof input.risks === "object"
              ? input.risks
              : {
                  flags: [],
                  summary: "TBD (insufficient context).",
                  implications: "TBD (insufficient context).",
                },
          riskSignals:
            input.riskSignals && typeof input.riskSignals === "object"
              ? input.riskSignals
              : {
                  summary: "TBD (insufficient context).",
                  count: 0,
                  interpretation: "TBD (insufficient context).",
                },
          evidenceUsed:
            input.evidenceUsed && typeof input.evidenceUsed === "object"
              ? input.evidenceUsed
              : { freeTextThemes: [], participantOpportunityThemes: [] },
          missingInputs: Array.isArray(input.missingInputs) ? input.missingInputs : [],
        }
      : input;

  const parsed = NarrativeSchema.safeParse(normalized);
  if (parsed.success) return parsed.data;

  console.warn("NarrativeSchema validation failed (Zod):", {
    issues: parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      code: i.code,
      message: i.message,
    })),
  });

  return fallbackNarrative(ctx);
}

function isNarrativeAIEnabled() {
  return String(process.env.NARRATIVE_AI_ENABLED ?? "").toLowerCase() === "true";
}

function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is missing.");
  return new Anthropic({ apiKey });
}

async function generateNarrativeJsonWithAI(args: {
  assessmentId: string;
  org: { industry?: string | null; size?: string | null };
  resultsBody: any;
  docCount: number;
}) {
  const { assessmentId, org, resultsBody, docCount } = args;

  const maturity = resultsBody?.maturity ?? null;
  const riskFlags = Array.isArray(resultsBody?.riskFlags) ? resultsBody.riskFlags : [];

  const pillarsObj = resultsBody?.aggregate?.pillars ?? {};
  const pillarScores = Object.entries(pillarsObj).map(([pillar, v]: any) => ({
    pillar,
    weightedAverage: typeof v?.weightedAverage === "number" ? v.weightedAverage : null,
  }));

  const companyReference =
    resultsBody?.narrativeContext?.reference?.companyDescriptor ?? "the company";

  const businessContext = resultsBody?.narrativeContext?.businessContext ?? {};
  const evidence = resultsBody?.narrativeContext?.evidence ?? {};

  const freeTextResponses = Array.isArray(evidence?.freeTextResponses)
    ? evidence.freeTextResponses
    : [];

  const participantOpportunityNotes = Array.isArray(evidence?.participantOpportunityNotes)
    ? evidence.participantOpportunityNotes
    : [];

  const aiInput = {
    assessmentId,
    organization: {
      reference: companyReference,
      industry: org.industry ?? null,
      size: org.size ?? null,
    },
    businessContext: {
      industry: businessContext?.industry ?? null,
      website: businessContext?.website ?? null,
      contextNotes: businessContext?.contextNotes ?? null,
      primaryPressures: businessContext?.primaryPressures ?? null,
      growthStage: businessContext?.growthStage ?? null,
      size: businessContext?.size ?? null,
    },
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
      pillars: pillarScores,
    },
    documents: { count: docCount },
    schema:
      "Return ONLY valid JSON for the required schema: schemaVersion, assessmentId, organization, executiveSummaryBullets, executiveMemo, maturityInterpretation, currentState, opportunities, structuredPillarBreakdown, pilotProjects, highValueEntryPoints, suggestedSequencing, guardrails, actionPlan90Days, leadershipAlignment, risks, riskSignals, evidenceUsed, missingInputs.",
  };

  const model = process.env.NARRATIVE_AI_MODEL || DEFAULT_NARRATIVE_MODEL;
  const client = getAnthropicClient();

  const systemText = [
    "You are Northline Intelligence's senior executive advisor and AI readiness strategist.",
    "You produce premium executive readouts that feel board-ready, workshop-ready, and immediately actionable.",
    "The audience is a mix of decision-makers and participants.",
    "The output must help them understand where they stand, what it means, where the best opportunities are, and what to do next.",
    "",
    "NON-NEGOTIABLE RULES:",
    "- Use ONLY the provided INPUT object.",
    "- Do not invent facts, systems, budgets, tools, vendors, integrations, or capabilities.",
    "- Treat the assessment results payload as protected truth.",
    "- Do not contradict the readiness index, maturity tier, posture, pillar scores, or risk flags.",
    "- Be calm, plainspoken, commercially credible, and specific.",
    "- This is a premium advisory deliverable, not a generic AI summary.",
    "",
    "TONE RULES:",
    "- Write in simple executive English.",
    "- Sound confident, useful, and practical.",
    "- Avoid hype, fluff, jargon, and vague innovation language.",
    "- Every section must create clarity and direction.",
    "- Never shame the organization. Frame weaknesses as execution constraints and opportunities.",
    "",
    "ANONYMIZATION RULE:",
    "- Do NOT use any real company name unless it appears in organization.reference.",
    "- Prefer organization.reference or 'the company'.",
    "",
    "EVIDENCE RULE:",
    "- You MUST use freeTextResponses and participantOpportunityNotes when available.",
    "- Pull out real friction, repeated pain points, workflow bottlenecks, decision bottlenecks, manual work, coordination issues, compliance burdens, reporting burdens, and adoption realities.",
    "- If evidence is thin, say so clearly in missingInputs.",
    "",
    "PRIMARY OUTPUT GOAL:",
    "- Produce an executive readout that mirrors a premium Northline Executive Insights document.",
    "- It must clearly answer four questions:",
    "  1. Where do we stand now?",
    "  2. What does that mean for how aggressively we should move?",
    "  3. What are the best high-value entry points?",
    "  4. What should we do first, next, and after that?",
    "",
    "LENGTH RULES:",
    "- executiveMemo.body: target 700 to 1000 words, but never exceed 1000 words.",
    "- maturityInterpretation.explanation: concise but substantial executive narrative, ideally 250 to 600 words.",
    "- highValueEntryPoints[*].executiveRationale: target 300 to 500 words each.",
    "- risks.implications: target 200 to 300 words.",
    "- riskSignals.interpretation: target 200 to 300 words when enough evidence exists.",
    "",
    "SECTION REQUIREMENTS:",
    "",
    "1. executiveSummaryBullets",
    "- Provide 4 to 6 bullets.",
    "- These must summarize current readiness, what is working, what needs strengthening, and the leadership implication.",
    "- At least one bullet must state how the company should move: stabilize first, proceed with intention, or ready to scale.",
    "",
    "2. executiveMemo",
    "- heading should be a short label suitable for the Executive Memo section.",
    "- body should be a premium executive memo in plain English.",
    "- Explain current position, strongest pillars, weakest pillars, what that means commercially, where leadership should focus, and how to move from insight into action.",
    "- It should sound like an advisor briefing a CEO or COO before a working session.",
    "",
    "3. maturityInterpretation",
    "- anchorTruth must explain that maturity is structural capability and readiness is how safely the organization can move into practical AI execution.",
    "- tier should reflect the protected maturity output.",
    "- explanation must explicitly explain what the readiness score means in business terms.",
    "",
    "4. currentState",
    "- strengths: what the organization can realistically build on now.",
    "- gaps: what is underdeveloped or inconsistent.",
    "- blockers: what could stall adoption, weaken ROI, or create waste if ignored.",
    "",
    "5. opportunities",
    "- note: one short executive framing paragraph.",
    "- items: 3 to 5 business opportunities tied to actual workflows and pains suggested by the evidence.",
    "",
    "6. structuredPillarBreakdown",
    "- Provide all 4 pillars.",
    "- Each must include pillar, score, and interpretation.",
    "- The interpretation should explain what that pillar score means for execution readiness in plain language.",
    "",
    "7. pilotProjects",
    "- Provide EXACTLY 3 pilot projects.",
    "- Each must include name, businessProblem, aiRole, expectedOutcome, whyThisIsAGoodStart, and firstMove.",
    "- These are the operational project definitions behind the executive presentation.",
    "",
    "8. highValueEntryPoints",
    "- Provide EXACTLY 3 items.",
    "- These should usually mirror the 3 pilotProjects, rewritten for executive presentation.",
    "- Each item must contain: projectName, outcome, firstMove, whyNow, executiveRationale.",
    "- executiveRationale must be 300 to 500 words, plain English, commercially strong, and directly connected to the readiness profile.",
    "",
    "9. suggestedSequencing",
    "- Fill phase0to30, phase31to90, and phase90Plus.",
    "- These must explain what to do in order and why.",
    "",
    "10. guardrails",
    "- Include practical bullets for dataProtection, humanOversight, toolGovernance, and adoptionRisks.",
    "",
    "11. actionPlan90Days",
    "- Fill all three phases: days0to30, days31to60, days61to90.",
    "- Each phase must include actions, owners, and successIndicators.",
    "- Owners should be role-based, not named individuals.",
    "",
    "12. leadershipAlignment",
    "- whereToStart: one clear executive recommendation.",
    "- whatToPrioritize: concrete leadership priorities.",
    "- suggestedInvestmentLevel must be exactly one of: low, moderate, strategic.",
    "",
    "13. risks",
    "- summary should be a short executive risk line.",
    "- Use provided risk flags when present.",
    "- implications should explain what happens if sequencing and governance are ignored.",
    "- implications must target 200 to 300 words when enough evidence exists.",
    "",
    "14. riskSignals",
    "- summary should read like the executive PDF summary line.",
    "- count should reflect the number of active risk flags when available.",
    "- interpretation should explain the practical risk picture in plain language.",
    "- Even if count is zero, explain what leadership should still monitor.",
    "",
    "15. evidenceUsed",
    "- freeTextThemes: short theme bullets pulled from free-text responses.",
    "- participantOpportunityThemes: short theme bullets pulled from participant opportunity notes.",
    "",
    "16. missingInputs",
    "- List missing inputs, weak evidence, or context gaps that limit confidence.",
    "",
    "QUALITY BAR:",
    "- This should feel like a premium executive advisory deliverable.",
    "- It must be insightful enough to guide a live executive readout.",
    "- It must be practical enough to turn into action immediately after the workshop.",
    "",
    "OUTPUT RULES:",
    "- Return ONLY valid JSON through the tool.",
    "- No markdown.",
    "- No extra keys.",
    "- Keep the language clear, executive, and directly useful.",
  ].join("\n");

  const userText =
    "Generate a premium executive AI readout that matches the required JSON shape.\n\n" +
    "Important requirements:\n" +
    "- Use only the provided INPUT object.\n" +
    "- Keep every recommendation practical and grounded in the assessment data.\n" +
    "- The executive memo must stay within 1000 words.\n" +
    "- Each high-value entry point rationale must stay within 300 to 500 words.\n" +
    "- The risk interpretation must stay within 200 to 300 words.\n" +
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
      "executiveMemo",
      "maturityInterpretation",
      "currentState",
      "opportunities",
      "structuredPillarBreakdown",
      "pilotProjects",
      "highValueEntryPoints",
      "suggestedSequencing",
      "guardrails",
      "actionPlan90Days",
      "leadershipAlignment",
      "risks",
      "riskSignals",
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
      executiveMemo: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "body"],
        properties: {
          heading: { type: "string" },
          body: { type: "string", maxLength: 7000 },
        },
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
          explanation: { type: "string", maxLength: 7000 },
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
      structuredPillarBreakdown: {
        type: "array",
        minItems: 4,
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["pillar", "score", "interpretation"],
          properties: {
            pillar: { type: "string" },
            score: { type: "number" },
            interpretation: { type: "string" },
          },
        },
      },
      pilotProjects: {
        type: "array",
        minItems: 3,
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
            "firstMove",
          ],
          properties: {
            name: { type: "string" },
            businessProblem: { type: "string" },
            aiRole: { type: "string" },
            expectedOutcome: { type: "string" },
            whyThisIsAGoodStart: { type: "string" },
            firstMove: { type: "string" },
          },
        },
      },
      highValueEntryPoints: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "projectName",
            "outcome",
            "firstMove",
            "whyNow",
            "executiveRationale",
          ],
          properties: {
            projectName: { type: "string" },
            outcome: { type: "string" },
            firstMove: { type: "string" },
            whyNow: { type: "string" },
            executiveRationale: { type: "string", maxLength: 4500 },
          },
        },
      },
      suggestedSequencing: {
        type: "object",
        additionalProperties: false,
        required: ["phase0to30", "phase31to90", "phase90Plus"],
        properties: {
          phase0to30: { type: "string" },
          phase31to90: { type: "string" },
          phase90Plus: { type: "string" },
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
        required: ["flags", "summary", "implications"],
        properties: {
          flags: { type: "array", items: {} },
          summary: { type: "string" },
          implications: { type: "string", maxLength: 2500 },
        },
      },
      riskSignals: {
        type: "object",
        additionalProperties: false,
        required: ["summary", "count", "interpretation"],
        properties: {
          summary: { type: "string" },
          count: { type: "number" },
          interpretation: { type: "string", maxLength: 2500 },
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
    max_tokens: 5200,
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

function pickMovementLabel(score: number | null | undefined) {
  if (typeof score !== "number") return "Proceed with Intention";
  if (score < 2.5) return "Stabilize First";
  if (score < 3.5) return "Proceed with Intention";
  return "Ready to Scale";
}

function buildPillarBreakdown(results: any) {
  const pillars = results?.aggregate?.pillars ?? {};

  const order = [
    { key: "system_integrity", label: "System Integrity" },
    { key: "human_alignment", label: "Human Alignment" },
    { key: "strategic_coherence", label: "Strategic Coherence" },
    { key: "sustainability_practice", label: "Sustainability Practice" },
  ];

  return order
    .map(({ key, label }) => {
      const score = pillars?.[key]?.weightedAverage;
      if (typeof score !== "number") return null;

      let interpretation = "";
      if (label === "System Integrity") {
        interpretation =
          score >= 3
            ? "Core operating data and process foundations appear stable enough to support controlled AI use in defined workflows."
            : "Core operating data and process foundations need more consistency before AI can be trusted in higher-stakes workflows.";
      } else if (label === "Human Alignment") {
        interpretation =
          score >= 3
            ? "People and teams appear aligned enough to absorb new ways of working, which lowers early adoption risk."
            : "Adoption may slow unless leadership creates clearer ownership, communication, and process support around new tools.";
      } else if (label === "Strategic Coherence") {
        interpretation =
          score >= 3
            ? "AI goals appear reasonably tied to business priorities, making it easier to choose projects with a clear commercial case."
            : "The link between AI activity and business outcomes is still forming, so projects should stay tightly scoped and outcome-led.";
      } else {
        interpretation =
          score >= 3
            ? "The organization shows enough operational discipline to sustain pilots, review results, and build on early wins."
            : "Sustainability habits are still developing, so early projects should stay simple enough to govern, review, and maintain.";
      }

      return { pillar: label, score, interpretation };
    })
    .filter(Boolean);
}

function buildPlaceholderNarrative(args: {
  assessmentId: string;
  org: { industry?: string | null; size?: string | null };
  results: any;
  docCount: number;
}) {
  const { assessmentId, org, results, docCount } = args;

  const maturity = results?.maturity ?? {};
  const riskFlags = Array.isArray(results?.riskFlags) ? results.riskFlags : [];
  const reference = results?.narrativeContext?.reference?.companyDescriptor ?? "the company";

  const tierLabel = maturity?.label ?? "Unknown";
  const posture = maturity?.posture ?? "Unknown";
  const protectedScore =
    typeof results?.aggregate?.overall?.weightedAverage === "number"
      ? results.aggregate.overall.weightedAverage
      : (maturity?.tierScore ?? null);

  const movementLabel = pickMovementLabel(protectedScore);
  const pillarBreakdown = buildPillarBreakdown(results);

  return {
    schemaVersion: SCHEMA_VERSION,
    assessmentId,
    organization: {
      reference,
      industry: org.industry ?? null,
      size: org.size ?? null,
    },
    executiveSummaryBullets: [
      `${reference} shows a readiness profile in the ${tierLabel} tier${posture ? ` with a ${String(posture).toLowerCase()} posture` : ""}.`,
      protectedScore !== null
        ? `The protected readiness score is ${protectedScore}, which should guide sequencing and ambition.`
        : "The protected readiness score could not be calculated from available data.",
      `The recommended movement posture is: ${movementLabel}.`,
      riskFlags.length > 0
        ? "Structural risk signals are present and should shape how the first AI efforts are scoped and governed."
        : "No major doctrine-based risk flags were triggered, but disciplined sequencing still matters.",
      "The next step should focus on three practical, low-risk entry points tied to real workflow friction.",
    ],
    executiveMemo: {
      heading: "Executive decision-making module.",
      body:
        `${reference} enters this assessment with a readiness profile that suggests the organization should move with discipline rather than speed for its own sake. The strongest reading from the protected results is not that the company is unready, but that it should be selective. A premium executive response here is to avoid broad AI transformation language and instead choose a small set of well-bounded opportunities that can produce value, clarify ownership, and strengthen operating habits at the same time. ` +
        `From a leadership perspective, the real question is not whether AI should be introduced, but how to introduce it without creating wasted effort, weak adoption, or tools that get used once and abandoned. That means tying early use cases to recurring friction, defining success before launch, and keeping human oversight visible. ` +
        `The operating implication is straightforward: begin where the workflow is repetitive, measurable, and already painful enough that improvement will be felt quickly. Use the first 90 days to prove value, tighten governance, and turn insight into a repeatable operating motion. This approach gives the organization a credible path from assessment to action without overreaching beyond what the current readiness profile supports. ` +
        `Documents reviewed for context: ${docCount}.`,
    },
    maturityInterpretation: {
      anchorTruth:
        "Maturity represents structural capability, while readiness indicates how safely the company can move into practical AI action.",
      tier: { label: tierLabel, posture, protectedScore },
      explanation:
        results?.protectionExplanation ??
        "Protected readiness and maturity results are available, but the narrative explanation is currently using a fallback.",
    },
    currentState: {
      strengths: [
        "There is enough assessment structure to identify practical first moves rather than generic AI ambitions.",
        "The readiness profile can support narrow, governed pilots tied to visible workflow friction.",
      ],
      gaps: [
        "The assessment does not yet provide enough validated narrative detail to support a more tailored strategy recommendation.",
      ],
      blockers: [
        "Weak project definition, unclear ownership, and thin success metrics would slow adoption and reduce return on early pilots.",
      ],
    },
    opportunities: {
      note:
        "The most credible opportunities are the ones that remove repeat manual work, improve consistency, or shorten decision cycles inside existing workflows.",
      items: [
        "Workflow summarization and handoff support in one recurring process.",
        "Knowledge access support for repeat operational questions.",
        "Reporting and compliance-oriented drafting or review assistance.",
      ],
    },
    structuredPillarBreakdown: pillarBreakdown.length === 4 ? pillarBreakdown : [],
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
        firstMove:
          "Identify one recurring workflow where teams repeatedly search for the same internal answers.",
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
        firstMove:
          "Map one manual workflow with repeat handoffs, delays, or frequent rework.",
      },
      {
        name: "Reporting and Summary Automation Pilot",
        businessProblem:
          "Leadership teams often spend unnecessary time turning raw updates into recurring summaries and status reports.",
        aiRole:
          "Use AI to generate first-draft summaries and recurring update packages inside one controlled reporting process.",
        expectedOutcome:
          "Reduce reporting effort, improve consistency, and speed up internal decision cycles.",
        whyThisIsAGoodStart:
          "It is visible, low risk, and easier to measure than a broad process redesign.",
        firstMove:
          "Choose one recurring reporting workflow and document the current inputs, owners, and delays.",
      },
    ],
    highValueEntryPoints: [
      {
        projectName: "Operations Knowledge Support Pilot",
        outcome:
          "Reduce time spent finding approved information and improve consistency in routine execution.",
        firstMove:
          "Identify one recurring workflow where teams repeatedly search for the same internal answers.",
        whyNow:
          "This is a bounded, practical starting point that fits the current readiness posture.",
        executiveRationale:
          "This entry point is valuable because it targets a visible source of friction without requiring a large system overhaul. When teams repeatedly stop to find the same information, the cost shows up in cycle time, inconsistency, and avoidable managerial escalations. A focused knowledge support pilot gives leadership a controlled way to test AI in a real workflow, prove value quickly, and build confidence before moving into broader automation. It also creates a cleaner path for governance because the scope is narrow, the content can be curated, and the human review model is straightforward. For an organization still converting readiness into action, this is exactly the kind of project that can generate practical momentum without creating unnecessary operational risk.",
      },
      {
        projectName: "Manual Workflow Reduction Pilot",
        outcome:
          "Reduce repetitive coordination and administrative effort in one defined process.",
        firstMove:
          "Map one manual workflow with repeat handoffs, delays, or frequent rework.",
        whyNow:
          "This creates measurable value without requiring broad transformation.",
        executiveRationale:
          "This is a strong early entry point because it focuses on a workflow that already consumes time and attention every week. Instead of trying to transform the organization at once, leadership can isolate one process where summaries, routing, classification, or drafting create visible drag. That makes the business case easier to understand and the operating risk easier to contain. It also helps the organization build better habits around ownership, success metrics, and adoption support, which are the same muscles needed for more ambitious AI work later. In practical terms, it lets the company learn how to run AI-enabled work with discipline before expanding into larger or more integrated use cases.",
      },
      {
        projectName: "Reporting and Summary Automation Pilot",
        outcome:
          "Shorten the time required to produce recurring updates, summaries, or internal reporting outputs.",
        firstMove:
          "Choose one recurring reporting workflow and document the current inputs, owners, and delays.",
        whyNow:
          "This is visible to leadership, easy to measure, and relatively low risk.",
        executiveRationale:
          "This entry point works well when leadership wants a practical win that is both visible and governable. Reporting workflows often sit in the background, but they consume meaningful staff time and can slow down decision-making when updates are delayed or inconsistent. A controlled summary automation pilot can improve speed and consistency while preserving human review. That makes it well suited for organizations that need proof of value, stronger internal alignment, and a manageable way to introduce AI into everyday work without creating operational disruption. It also helps leadership establish a higher standard for how output quality is reviewed, approved, and maintained over time.",
      },
    ],
    suggestedSequencing: {
      phase0to30:
        "Choose one narrow workflow, define success in business terms, identify the required inputs, and confirm who owns the pilot.",
      phase31to90:
        "Launch one controlled pilot, monitor usage and output quality weekly, and refine the workflow based on actual operating feedback.",
      phase90Plus:
        "Only expand into a second or third entry point after the first pilot shows measurable value, visible adoption, and sustainable governance.",
    },
    guardrails: {
      dataProtection: [
        "Use only approved business data in the pilot scope.",
        "Separate sensitive content from general workflow content before testing.",
      ],
      humanOversight: [
        "Require human review for any high-impact output before action is taken.",
        "Assign one operational owner for output quality and exception handling.",
      ],
      toolGovernance: [
        "Define the approved workflow, success criteria, and fallback process before launch.",
        "Limit the pilot to one use case until evidence supports expansion.",
      ],
      adoptionRisks: [
        "If the workflow is unclear or cumbersome, teams will route around it.",
        "If success is not measured, leadership will not know whether value is real or assumed.",
      ],
    },
    actionPlan90Days: {
      days0to30: {
        actions: [
          "Choose one pilot use case.",
          "Map the current workflow and define success metrics.",
        ],
        owners: ["Executive sponsor", "Process owner", "Operational lead"],
        successIndicators: [
          "Pilot scope approved.",
          "Baseline process metrics captured.",
        ],
      },
      days31to60: {
        actions: [
          "Launch the pilot in a controlled environment.",
          "Review outputs and exceptions weekly.",
        ],
        owners: ["Process owner", "Functional manager", "AI implementation lead"],
        successIndicators: [
          "Pilot is live with real workflow usage.",
          "Output quality and adoption patterns are being tracked.",
        ],
      },
      days61to90: {
        actions: [
          "Assess value against baseline.",
          "Decide whether to refine, scale, or stop.",
        ],
        owners: ["Executive sponsor", "Finance or ops analyst", "Process owner"],
        successIndicators: [
          "Pilot value is measurable.",
          "Leadership decision made on next-phase expansion.",
        ],
      },
    },
    leadershipAlignment: {
      whereToStart:
        "Start with one high-friction workflow where the value case is visible and the governance model can stay simple.",
      whatToPrioritize: [
        "Clear pilot ownership",
        "Narrow scope",
        "Measurable success criteria",
        "Human review discipline",
      ],
      suggestedInvestmentLevel:
        typeof protectedScore === "number" && protectedScore >= 3.5 ? "strategic" : "moderate",
    },
    risks: {
      flags: riskFlags,
      summary:
        riskFlags.length > 0
          ? "Structural risk signals should shape the first-wave project scope."
          : "No major structural risk flags were detected, but sequencing discipline still matters.",
      implications:
        riskFlags.length > 0
          ? "The main risk is not simply technical failure. It is leadership approving activity that looks progressive but is not yet supported by enough organizational discipline. When that happens, teams can end up piloting tools without clear ownership, weak success metrics, and inconsistent human review. The result is usually not catastrophic failure; it is wasted effort, low adoption, and a growing perception that AI is more work than value. That is why the first projects should remain narrow, well-governed, and closely tied to business outcomes. The organization should use the early phase to prove operational value and strengthen execution habits before taking on broader change."
          : "Even without major risk flags, the company should not mistake a clean assessment for permission to move broadly. The more common failure pattern in this situation is overreach: launching too many use cases at once, choosing projects without strong ownership, or skipping the discipline of baseline metrics and review. That creates noise instead of progress. The practical protection is to keep the first wave small, define success clearly, and require visible leadership follow-through. When sequencing remains disciplined, the organization can build confidence and value without turning early wins into fragile experiments.",
    },
    riskSignals: {
      summary:
        riskFlags.length > 0
          ? "Structural risk signals detected"
          : "No structural risk signals detected",
      count: riskFlags.length,
      interpretation:
        riskFlags.length > 0
          ? "The current risk picture suggests leadership should pay close attention to sequencing, ownership, and sustainability. The presence of structural flags does not mean the organization should stop. It means the first AI efforts need tighter boundaries, clearer review, and stronger executive discipline than a more mature environment would require. In practice, that means no broad automation push, no loosely defined pilots, and no success claims without measurable evidence. The right response is to choose a small number of controlled entry points, watch how they perform, and use that learning to reduce risk before expanding further."
          : "No active structural risk flags were triggered in the assessment, which is encouraging, but it does not remove the need for good operating discipline. The main things leadership should still monitor are project sprawl, unclear ownership, weak success metrics, and the tendency to treat pilot enthusiasm as proof of long-term value. The strongest response is to keep the first wave focused, review outcomes regularly, and make sure each use case is connected to a real business problem. That approach protects momentum and keeps the organization from drifting into low-value experimentation.",
    },
    evidenceUsed: {
      freeTextThemes: [],
      participantOpportunityThemes: [],
    },
    missingInputs: docCount > 0 ? [] : ["No supporting documents were available to deepen the narrative context."],
  };
}

function buildUnauthorized(message?: string) {
  return NextResponse.json({ ok: false, error: "Unauthorized", message }, { status: 401 });
}

async function assertInviteAccess(args: { assessmentId: string; email: string; token: string }) {
  const email = args.email.trim().toLowerCase();
  const tokenHash = crypto.createHash("sha256").update(args.token).digest("hex");

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "Participant"
    WHERE assessment_id = ${args.assessmentId}::uuid
      AND email = ${email}
      AND invite_token_hash = ${tokenHash}
      AND (invite_token_expires_at IS NULL OR invite_token_expires_at > NOW())
    LIMIT 1;
  `;

  const row = rows?.[0] ?? null;
  if (!row) return { ok: false as const, participantId: null as any };

  return { ok: true as const, participantId: row.id };
}

async function markInviteAccepted(participantId: string) {
  await prisma.$executeRaw`
    UPDATE "Participant"
    SET invite_accepted_at = COALESCE(invite_accepted_at, NOW())
    WHERE id = ${participantId}::uuid;
  `;
}

async function allParticipantsCompleted(assessmentId: string) {
  const rows = await prisma.$queryRaw<
    Array<{ email: string | null; completed_at: Date | null }>
  >`
    SELECT email, completed_at
    FROM "Participant"
    WHERE assessment_id = ${assessmentId}::uuid
      AND email IS NOT NULL;
  `;

  const total = rows.length;
  const completed = rows.filter((p) => p.completed_at != null).length;

  return {
    total,
    completed,
    ok: total > 0 && completed >= total,
  };
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
      if (!membership) {
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }

      cacheKeyOwner = `admin:${user.id}`;
    }

    const completion = await allParticipantsCompleted(assessmentId);
    if (!completion.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "All participants have not completed the assessment. Please check back once the administrator confirms completion.",
          meta: { total: completion.total, completed: completion.completed },
        },
        { status: 409 }
      );
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
      const latest = await prisma.assessmentNarrative.findFirst({
        where: { assessment_id: assessmentId },
        orderBy: [{ version: "desc" }],
      });

      if (!latest) return { ok: false, error: "Narrative not found" };

      return { ok: true, narrative: latest };
    })();

    narrativeInflight.set(cacheKey, p);

    let payload: any;
    try {
      payload = await p;
    } finally {
      narrativeInflight.delete(cacheKey);
    }

    narrativeCacheSet(cacheKey, payload);
    return NextResponse.json(payload, { status: payload.ok ? 200 : 404 });
  } catch (err: any) {
    console.error("GET narrative error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error.", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}

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

        if (!membership) {
          return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
        }

        participantIdForAccess = membership.id;
      }
    }

    if (!participantIdForAccess) {
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

    const url = new URL(req.url);
    const draft = url.searchParams.get("draft") === "1" || url.searchParams.get("draft") === "true";
    const force = allowForce && (url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true");

    if (draft && authType !== "admin") {
      return NextResponse.json({ ok: false, error: "Draft regeneration requires admin access." }, { status: 403 });
    }

    if (authType === "admin" && user?.email && !isAdminEmail(user.email)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const completion = await allParticipantsCompleted(assessmentId);
    if (!completion.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "All participants have not completed the assessment. Please check back once the administrator confirms completion.",
          meta: { total: completion.total, completed: completion.completed },
        },
        { status: 409 }
      );
    }

    const results = await buildAssessmentResultsPayload({
      assessmentId,
      viewer: authType === "admin" ? { type: "admin", userId: user?.id ?? null } : { type: "participant", participantId: participantIdForAccess },
    } as any);

    if (!results || (results as any)?.ok === false) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unable to build assessment results payload.",
        },
        { status: 500 }
      );
    }

    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
      },
    });
    
    if (!assessment) {
      return NextResponse.json({ ok: false, error: "Assessment not found." }, { status: 404 });
    }
    
    if (!assessment) {
      return NextResponse.json({ ok: false, error: "Assessment not found." }, { status: 404 });
    }
    
    /**
     * Do not query document tables here unless the Prisma model is confirmed in the real schema.
     * We can still generate a strong narrative from the protected results payload.
     */
    const docs: Array<{
      id: string;
      kind?: string | null;
      title?: string | null;
      content_text?: string | null;
      file_name?: string | null;
    }> = [];
    
    const org = {
      industry: results.body?.narrativeContext?.businessContext?.industry ?? null,
      size: results.body?.narrativeContext?.businessContext?.size ?? null,
    };

    const inputForHash = {
      assessmentId,
      authType,
      org,
      docCount: docs.length,
      docs: docs.map((d: any) => ({
        id: d.id,
        kind: d.kind ?? null,
        title: d.title ?? null,
        file_name: d.file_name ?? null,
        content_hash: sha256NullableText(d.content_text ?? null),
      })),
      results: results.body,
      schemaVersion: SCHEMA_VERSION,
      promptVersion: PROMPT_VERSION,
    };

    const input_hash = sha256(stableStringify(inputForHash));

    const finalNarrative = await prisma.assessmentNarrative.findFirst({
      where: { assessment_id: assessmentId, status: "FINAL", input_hash },
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
    });

    const created = await prisma.assessmentNarrative.create({
      data: {
        assessment_id: assessmentId,
        version: nextVersion,
        status: "DRAFT",
        input_hash,
        engine_version: ENGINE_VERSION,
        schema_version: SCHEMA_VERSION,
        prompt_version: usedAI ? PROMPT_VERSION : "placeholder-v3",
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
