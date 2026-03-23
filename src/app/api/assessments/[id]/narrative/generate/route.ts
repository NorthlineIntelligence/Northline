// src/app/api/assessments/[id]/narrative/generate/route.ts
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
        industry: z.union([TrimmedText, z.null()]).optional(),
        size: z.union([TrimmedText, z.null()]).optional(),
      })
      .strip(),

    executiveSummaryBullets: z.array(ShortBullet).max(6).default([]),

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
        explanation: TrimmedText,
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
            typeof input.schemaVersion === "string" ? input.schemaVersion : "2.0",

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

          risks:
            input.risks && typeof input.risks === "object"
              ? input.risks
              : { flags: [], implications: "TBD (insufficient context)." },

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
    risks: {
      flags: [],
      implications:
        "Narrative validation failed; review risk signals and protected scoring directly in the assessment results payload.",
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
      "Return ONLY valid JSON for the required schema: schemaVersion, assessmentId, organization, executiveSummaryBullets, maturityInterpretation, currentState, opportunities, pilotProjects, guardrails, actionPlan90Days, leadershipAlignment, risks, evidenceUsed, missingInputs.",
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
    "ANONYMIZATION RULE:",
    "- Do NOT use any real company name.",
    '- Refer to the organization only as the provided organization.reference value or as "the company".',
    "- Never address the output to a named company.",
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
    "1. executiveSummaryBullets",
    "- 4 to 6 bullets.",
    "- Summarize readiness, practical direction, and the main leadership takeaway.",
    "",
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
    "5. pilotProjects",
    "- Provide EXACTLY 2 or 3 pilot projects.",
    "- Each must include: name, businessProblem, aiRole, expectedOutcome, whyThisIsAGoodStart.",
    "- These must be high-value, low-risk, practical first moves.",
    "- Do not recommend vendor tools.",
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
    "- implications should explain what failure or delay would look like if sequencing is ignored.",
    "",
    "10. evidenceUsed",
    "- freeTextThemes: short bullets summarizing patterns seen in free-text responses.",
    "- participantOpportunityThemes: short bullets summarizing patterns seen in participant opportunity notes.",
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
    "- Do not use a real company name.\n" +
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
          explanation: { type: "string", maxLength: 8000 },
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
        required: ["flags", "implications"],
        properties: {
          flags: { type: "array", items: {} },
          implications: { type: "string" },
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
    max_tokens: 2600,
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
    executiveSummaryBullets: [
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
    ],
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
    risks: {
      flags: riskFlags,
      implications:
        riskFlags.length > 0
          ? "Structural risks are present and should influence sequencing, ownership, and guardrails."
          : "No major doctrine-based risk flags were triggered, but early efforts should still stay narrow and measurable.",
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
        engine_version: "v2.0",
        schema_version: "2.0",
        prompt_version: usedAI ? "northline-workshop-v2" : "placeholder-v2",
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