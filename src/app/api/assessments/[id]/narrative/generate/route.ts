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
 * ✅ REQUIRED: exactly one server client helper, used by BOTH GET and POST.
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
        name: TrimmedText,
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

    risks: z
      .object({
        flags: z.array(z.any()).max(25).default([]),
        implications: TrimmedText,
      })
      .strip(),

    whereAIHelpsNow: z
      .object({
        note: TrimmedText,
        candidates: z
          .array(
            z
              .object({
                pillar: TrimmedText,
                reason: TrimmedText,
              })
              .strip()
          )
          .max(8)
          .default([]),
      })
      .strip(),

    whereAIWillNotHelp: z
      .object({
        note: TrimmedText,
        items: z.array(TrimmedText).max(10).default([]),
      })
      .strip(),

    whereAICouldHurtOrFail: z
      .object({
        note: TrimmedText,
        items: z.array(TrimmedText).max(10).default([]),
      })
      .strip(),

    useCases: z
      .object({
        top5: z.array(TrimmedText).max(5).default([]),
        top3Priorities: z.array(TrimmedText).max(3).default([]),
        note: TrimmedText,
      })
      .strip(),

    timelineAndResourcing: z
      .object({
        ranges: TrimmedText,
        resourcingTypes: z.array(TrimmedText).max(25).default([]),
      })
      .strip(),

    missingInputs: z.array(TrimmedText).max(20).default([]),
  })
  .strip();

function sanitizeNarrativeJson(
  input: any,
  ctx: { assessmentId: string; orgName: string }
) {
  // Normalize BEFORE Zod validation
  const normalized =
    input && typeof input === "object"
      ? {
          ...input,

          schemaVersion:
            typeof (input as any).schemaVersion === "string"
              ? (input as any).schemaVersion
              : "1.0",
          assessmentId:
            typeof (input as any).assessmentId === "string"
              ? (input as any).assessmentId
              : ctx.assessmentId,

          organization:
            (input as any).organization &&
            typeof (input as any).organization === "object"
              ? (input as any).organization
              : { name: ctx.orgName, industry: null, size: null },

          executiveSummaryBullets: Array.isArray(
            (input as any).executiveSummaryBullets
          )
            ? (input as any).executiveSummaryBullets
            : [],

          maturityInterpretation:
            (input as any).maturityInterpretation &&
            typeof (input as any).maturityInterpretation === "object"
              ? (input as any).maturityInterpretation
              : {
                  anchorTruth:
                    "Maturity represents structural capability (not readiness scoring).",
                  tier: { label: null, posture: null, protectedScore: null },
                  explanation: "TBD (insufficient context).",
                },

          risks:
            (input as any).risks && typeof (input as any).risks === "object"
              ? (input as any).risks
              : { flags: [], implications: "TBD (insufficient context)." },

          whereAIHelpsNow:
            (input as any).whereAIHelpsNow &&
            typeof (input as any).whereAIHelpsNow === "object"
              ? (input as any).whereAIHelpsNow
              : { note: "TBD (insufficient context).", candidates: [] },

          whereAIWillNotHelp:
            (input as any).whereAIWillNotHelp &&
            typeof (input as any).whereAIWillNotHelp === "object"
              ? (input as any).whereAIWillNotHelp
              : { note: "TBD (insufficient context).", items: [] },

          whereAICouldHurtOrFail:
            (input as any).whereAICouldHurtOrFail &&
            typeof (input as any).whereAICouldHurtOrFail === "object"
              ? (input as any).whereAICouldHurtOrFail
              : { note: "TBD (insufficient context).", items: [] },

          useCases:
            (input as any).useCases && typeof (input as any).useCases === "object"
              ? (input as any).useCases
              : { top5: [], top3Priorities: [], note: "TBD (insufficient context)." },

          timelineAndResourcing:
            (input as any).timelineAndResourcing &&
            typeof (input as any).timelineAndResourcing === "object"
              ? (input as any).timelineAndResourcing
              : { ranges: "TBD (insufficient context).", resourcingTypes: [] },

          missingInputs: Array.isArray((input as any).missingInputs)
            ? (input as any).missingInputs
            : [],
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
    schemaVersion: "1.0",
    assessmentId: ctx.assessmentId,
    organization: { name: ctx.orgName, industry: null, size: null },
    executiveSummaryBullets: [
      "Narrative summary is temporarily unavailable due to an output validation issue.",
      "Core results are still available on this page; regenerate to try again.",
    ],
    maturityInterpretation: {
      anchorTruth: "Maturity represents structural capability (not readiness scoring).",
      tier: { label: null, posture: null, protectedScore: null },
      explanation:
        "Narrative validation failed; see protected results payload for scoring method.",
    },
    risks: {
      flags: [],
      implications:
        "Narrative validation failed; review risk signals section for doctrine-based constraints.",
    },
    whereAIHelpsNow: { note: "Narrative validation failed.", candidates: [] },
    whereAIWillNotHelp: { note: "Narrative validation failed.", items: [] },
    whereAICouldHurtOrFail: { note: "Narrative validation failed.", items: [] },
    useCases: { top5: [], top3Priorities: [], note: "Narrative validation failed." },
    timelineAndResourcing: {
      ranges: "Narrative validation failed.",
      resourcingTypes: [],
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
  org: { name: string; industry?: string | null; size?: string | null };
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

  const aiInput = {
    assessmentId,
    organization: {
      name: org.name,
      industry: org.industry ?? null,
      size: org.size ?? null,
    },
    results: {
      readinessIndex: resultsBody?.aggregate?.overall?.weightedAverage ?? null,
      maturity,
      protectionExplanation: resultsBody?.protectionExplanation ?? null,
      riskFlags,
      pillars: pillarScores,
    },
    documents: { count: docCount },
    schema:
      "Return ONLY valid JSON for NarrativeSchema (schemaVersion, assessmentId, organization, executiveSummaryBullets, maturityInterpretation, risks, whereAIHelpsNow, whereAIWillNotHelp, whereAICouldHurtOrFail, useCases, timelineAndResourcing, missingInputs).",
  };

  const model = process.env.NARRATIVE_AI_MODEL || DEFAULT_NARRATIVE_MODEL;
  const client = getAnthropicClient();

  const systemText = [
    "You are a senior strategy consultant at Northline Intelligence.",
    "You write consulting-grade executive briefs that read like a paid advisory memo.",
    "",
    "NON-NEGOTIABLE EVIDENCE RULE:",
    "- Use ONLY the provided INPUT object.",
    "- Do not invent facts.",
    "- Make sure that we are here to inform, help and consult do not criticize or use criticizing language",
    "- If a claim cannot be supported by INPUT, state that clearly and add it to missingInputs.",
    "- Treat the results payload as protected truth. Do not contradict it.",
    "",
    "NORTHLINE BRAND VOICE:",
    "- Executive, Conservative, grounded, and specific.",
    "- Plain language. Short sentences.",
    "- No buzzwords. No hype.",
    "- Avoid technical AI jargon.",
    "- be consultative and kind do not overwhelming. The idea is showing them in simple terms how they strategically and safely implement ai with the highest value and lowest risk",
    "- Never over-promise.",
    "- AI amplifies what exists. Structure before automation.",
    "",
    "EXECUTIVE OUTPUT STRUCTURE (STRICT SECTION FORMAT REQUIRED):",
    "The maturityInterpretation.explanation field MUST contain five clearly labeled sections in this exact order:",
    "",
    "Executive Narrative",
    "- Maximum 2500 characters.",
    "- 8 to 12 strong sentences.",
    "- Interpret the pillar pattern holistically.",
    "- Explain structural strengths and structural constraints.",
    "- Explain what failure would look like if rushed.",
    "- Explain what is viable now, be specific, consultative and kind here",
    "- Do NOT list raw scores as standalone commentary.",
    "- Numbers may appear once only to support interpretation.",
    "",
    "Structured Pillar Breakdown",
    "- Maximum 800 characters.",
    "- Briefly interpret all four pillars.",
    "- Translate each pillar into operational meaning.",
    "- Avoid repetitive 'X scored Y' phrasing.",
    "",
    "Risk Interpretation",
    "- Maximum 800 characters.",
    "- If risk flags exist, reference each signal and the pillar it aligns with.",
    "- Explain what failure mode it predicts, kindly and consultatively. Be sure to use plain language that relates to their business specifically.",
    "- Explain what sequencing adjustment it requires.",
    "- If no flags exist, provide a short monitoring watchlist.",
    "",
    "Northline High-Value Entry Points",
    "- Maximum 1000 characters.",
    "- EXACTLY 3 detailed project scopes. based off of the assessment,company/organization info, and the added potential use cases and pain points, these should be concrete strategic recommendations for Ai projects based on the company info, the assessment and the usecases. they should be walking away with a clear vision of 3 high value low impact projects relating to ai and automation for their specific business. this should not be how they should fix their systems and process",
    "- Each formatted exactly as:",
    "  Project Name:",
    "  Outcome:",
    "  First Move:",
    "- Projects must acknowledge structure status before automation scale, but ultimately be strategic recommendations for high value low impact progects, and discussing where the usage of Ai and automation can be used. what can be created by leveraging Ai and automation.",
    "- No tool recommendations as first move.",
    "",
    "Suggested Sequencing",
    "- Maximum 600 characters.",
    "- Make sure this is clear to everyone participating in the assessment individual contributors to executives. Be sure to be consultative they want to know what a projects they can work on in this sequence. These should be strategic high value low impact project recommendations against the 30 60 90 day timeline",
    "- Provide phased horizon:",
    "  0 to 30 days",
    "  30 to 90 days",
    "  90 plus days",
    "- Conservative and realistic.",
    "",
    "OUTPUT RULES:",
    "- Return ONLY valid JSON via the tool.",
    "- No markdown.",
    "- No Em-dashes.",
    "- Use simple to understand consultative terms, we dont want to overwhelm we want to inform about their for ai to help their business",
    "- No extra commentary.",
    "- Use and consider their tech stack and where Ai could be helpful, remember do not suggest tools, suggest where and How Ai can help with pain points, tech etc",
    "- No extra keys beyond the required schema.",
    "- Be specific and Monday-morning actionable.",
  ].join("\n");

  const userText =
    "Generate a doctrine-consistent executive narrative JSON that matches the required shape.\n\n" +
    "IMPORTANT: Return ONLY valid JSON (no markdown, no commentary).\n\n" +
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
      "risks",
      "whereAIHelpsNow",
      "whereAIWillNotHelp",
      "whereAICouldHurtOrFail",
      "useCases",
      "timelineAndResourcing",
      "missingInputs",
    ],
    properties: {
      schemaVersion: { type: "string" },
      assessmentId: { type: "string" },
      organization: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: { type: "string" },
          industry: { anyOf: [{ type: "string" }, { type: "null" }] },
          size: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
      },
      executiveSummaryBullets: { type: "array", items: { type: "string" }, maxItems: 6 },
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
      risks: {
        type: "object",
        additionalProperties: false,
        required: ["flags", "implications"],
        properties: {
          flags: { type: "array", items: {} },
          implications: { type: "string" },
        },
      },
      whereAIHelpsNow: {
        type: "object",
        additionalProperties: false,
        required: ["note", "candidates"],
        properties: {
          note: { type: "string" },
          candidates: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["pillar", "reason"],
              properties: {
                pillar: { type: "string" },
                reason: { type: "string" },
              },
            },
          },
        },
      },
      whereAIWillNotHelp: {
        type: "object",
        additionalProperties: false,
        required: ["note", "items"],
        properties: {
          note: { type: "string" },
          items: { type: "array", items: { type: "string" }, maxItems: 10 },
        },
      },
      whereAICouldHurtOrFail: {
        type: "object",
        additionalProperties: false,
        required: ["note", "items"],
        properties: {
          note: { type: "string" },
          items: { type: "array", items: { type: "string" }, maxItems: 10 },
        },
      },
      useCases: {
        type: "object",
        additionalProperties: false,
        required: ["top5", "top3Priorities", "note"],
        properties: {
          top5: { type: "array", items: { type: "string" }, maxItems: 5 },
          top3Priorities: { type: "array", items: { type: "string" }, maxItems: 3 },
          note: { type: "string" },
        },
      },
      timelineAndResourcing: {
        type: "object",
        additionalProperties: false,
        required: ["ranges", "resourcingTypes"],
        properties: {
          ranges: { type: "string" },
          resourcingTypes: { type: "array", items: { type: "string" }, maxItems: 25 },
        },
      },
      missingInputs: { type: "array", items: { type: "string" }, maxItems: 20 },
    },
  } as const;

  const response = await client.messages.create({
    model,
    max_tokens: 2200,
    system: systemText,
    messages: [{ role: "user", content: userText }],
    tools: [
      {
        name: "narrative_json",
        description:
          "Return the executive narrative as structured JSON matching the NarrativeSchema shape.",
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
  org: { name: string; industry?: string | null; size?: string | null };
  results: any;
  docCount: number;
}) {
  const { assessmentId, org, results, docCount } = args;

  const maturity = results?.maturity ?? {};
  const aggregate = results?.aggregate ?? {};
  const riskFlags = results?.riskFlags ?? [];

  const tierLabel = maturity?.label ?? "Unknown";
  const posture = maturity?.posture ?? "Unknown";
  const protectedScore = maturity?.tierScore ?? null;

  const topPillars: Array<{ pillar: string; score: number | null }> = Object.entries(
    aggregate?.pillars ?? {}
  ).map(([pillar, v]: any) => ({
    pillar,
    score: typeof v?.weightedAverage === "number" ? v.weightedAverage : null,
  }));

  topPillars.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));

  return {
    schemaVersion: "1.0",
    assessmentId,
    organization: {
      name: org.name,
      industry: org.industry ?? null,
      size: org.size ?? null,
    },
    executiveSummaryBullets: [
      `Maturity Tier: ${tierLabel} (${posture}).`,
      protectedScore !== null
        ? `Protected overall score: ${protectedScore}.`
        : "Protected overall score: insufficient data.",
      riskFlags.length > 0 ? `Risk flags present: ${riskFlags.length}.` : "No risk flags triggered by current rules.",
      docCount > 0 ? `Organization documents provided: ${docCount}.` : "No organization documents provided yet.",
    ],
    maturityInterpretation: {
      anchorTruth: "Maturity represents structural capability (not readiness scoring).",
      tier: { label: tierLabel, posture, protectedScore },
      explanation:
        results?.protectionExplanation ??
        "No protective explanation available (missing results payload).",
    },
    risks: {
      flags: riskFlags,
      implications:
        riskFlags.length > 0
          ? "Risk flags modify sequencing and emphasis. Address structural constraints before scaling adoption."
          : "No doctrine-based risk flags triggered; proceed with disciplined sequencing.",
    },
    whereAIHelpsNow: {
      note:
        "Placeholder until organization context + current AI usage are provided. Will prioritize highest value, lowest risk opportunities.",
      candidates: topPillars.slice(0, 3).map((p) => ({
        pillar: p.pillar,
        reason:
          p.score === null
            ? "Insufficient data."
            : `Relative strength (pillar score ${p.score}). Focus on adjacent low-risk automation/assist patterns.`,
      })),
    },
    whereAIWillNotHelp: {
      note:
        "Placeholder. Will explicitly call out areas where AI will not help without foundational fixes (data integrity, process clarity, human alignment).",
      items: [],
    },
    whereAICouldHurtOrFail: {
      note:
        "Placeholder. Will highlight likely failure modes: brittle workflows, incorrect automations, compliance leakage, and change resistance.",
      items: [],
    },
    useCases: {
      top5: [],
      top3Priorities: [],
      note:
        "Use cases require admin-provided context (tools, workflows, constraints) and current AI usage notes. Missing inputs will be called out explicitly.",
    },
    timelineAndResourcing: {
      ranges:
        "Placeholder. Will provide conservative timeline ranges and resource types (not headcount promises) after context is provided.",
      resourcingTypes: [
        "Operator/Owner sponsor",
        "Process owner(s)",
        "Systems integrator",
        "AI systems architect",
      ],
    },
    missingInputs: [
      "Admin org context (tools, operating reality, current AI usage)",
      "Workshop notes / constraints",
      docCount > 0 ? null : "Organization documents/notes for grounding",
    ].filter(Boolean),
  };
}

function buildUnauthorized(message?: string) {
  return NextResponse.json({ ok: false, error: "Unauthorized", message }, { status: 401 });
}

/**
 * Because your TS types are currently out of sync with the DB columns,
 * we use raw SQL for the fields Prisma is complaining about:
 * - Participant.invite_token_expires_at, invite_accepted_at, completed_at
 * - Assessment.locked_at
 *
 * This keeps ALL FEATURES working while eliminating TS errors.
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

    // --- AUTH: invite OR supabase session ---
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
      if (!membership) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

      cacheKeyOwner = `admin:${user.id}`;
    }

    // --- Completion gate (ALL participants must be completed) ---
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
 * - assessment locking (raw SQL, TS-safe)
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const params = await context.params;
    const parsed = ParamsSchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid assessment id (UUID)" }, { status: 400 });
    }
    const assessmentId = parsed.data.id;

    // --- AUTH: invite OR supabase session ---
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

    // 1) Supabase session first (admin flow)
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

    // 2) If no session, require invite token (participant flow)
    if (!participantIdForAccess) {
      if (!finalEmail || !finalToken) {
        return buildUnauthorized("Missing email or token.");
      }

      const access = await assertInviteAccess({ assessmentId, email: finalEmail, token: finalToken });
      if (!access.ok) return buildUnauthorized("Invalid or expired invite link.");

      participantIdForAccess = access.participantId;
      authType = "invite";

      // Mark accepted on first successful token use
      await markInviteAccepted(participantIdForAccess);
    }

    // --- query flags ---
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

    // --- Completion gate: require ALL participants completed before generation ---
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

    // 1) Results payload (protected truth)
    const results = await buildAssessmentResultsPayload({ assessmentId });
    if (!results.ok) return NextResponse.json(results.body, { status: results.status });

    // 2) Org + docs
    const assessment = results.body.assessment;
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

    if (!org) return NextResponse.json({ ok: false, error: "Organization not found" }, { status: 404 });

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
      engine_version: "v1.2",
      schema_version: "1.0",
      assessment_id: assessmentId,
      organization: {
        id: org.id,
        name: org.name,
        industry: org.industry ?? null,
        size: org.size ?? null,
        growth_stage: org.growth_stage ?? null,
        primary_pressures: org.primary_pressures ?? null,
      },
      results: normalizeForHash(results.body),
      documents: docFingerprints,
    };

    const input_hash = sha256(stableStringify(canonicalInput));

    // If FINAL exists and not draft, return it and lock assessment
    const finalNarrative = await prisma.assessmentNarrative.findFirst({
      where: { assessment_id: assessmentId, status: "FINAL" },
      orderBy: [{ version: "desc" }],
    });

    if (finalNarrative && !draft) {
      await lockAssessmentIfUnlocked(assessmentId);
      return NextResponse.json({ ok: true, cached: true, narrative: finalNarrative }, { status: 200 });
    }

    // If DRAFT exists with same hash and not force, return it (draft mode)
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

    // Latest narrative for versioning + caching
    const latest = await prisma.assessmentNarrative.findFirst({
      where: { assessment_id: assessmentId },
      orderBy: [{ version: "desc" }],
    });

    // If latest matches input hash and not force, return it (any status)
    if (latest && latest.input_hash === input_hash && !force) {
      await lockAssessmentIfUnlocked(assessmentId);
      return NextResponse.json({ ok: true, cached: true, narrative: latest }, { status: 200 });
    }

    // If a narrative exists and user is not forcing and not draft, return latest instead of 409
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

    // --- Generate candidate (AI behind flag, fallback placeholder) ---
    let narrativeCandidate: any;
    let usedAI = false;

    if (isNarrativeAIEnabled()) {
      try {
        narrativeCandidate = await generateNarrativeJsonWithAI({
          assessmentId,
          org,
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
          org,
          results: results.body,
          docCount: docs.length,
        });
      }
    } else {
      narrativeCandidate = buildPlaceholderNarrative({
        assessmentId,
        org,
        results: results.body,
        docCount: docs.length,
      });
    }

    const narrative_json = sanitizeNarrativeJson(narrativeCandidate, {
      assessmentId,
      orgName: org.name,
    });

    const created = await prisma.assessmentNarrative.create({
      data: {
        assessment_id: assessmentId,
        version: nextVersion,
        status: "DRAFT",
        input_hash,
        engine_version: "v1.2",
        schema_version: "1.0",
        prompt_version: usedAI ? "northline-v1" : "placeholder-v1",
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