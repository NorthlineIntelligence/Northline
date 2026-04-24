import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { buildAssessmentResultsPayload } from "@/lib/assessmentResultsEngine";
import { isAdminEmail } from "@/lib/admin";
import {
  authorizeParticipantOrInvite,
  allParticipantsCompleted,
  markInviteAccepted,
} from "@/lib/assessmentRouteAuth";

const ParamsSchema = z.object({ id: z.string().uuid() });
const DEFAULT_MODEL = "claude-sonnet-4-6";

const CostEnum = z.enum(["low", "medium", "high", "low-medium", "medium-high"]);
const TimelineUnitEnum = z.enum(["days", "weeks", "months"]);
const BandKeyEnum = z.enum(["stabilize", "proceed", "ready", "unknown"]);
const IntegrationTypeEnum = z.enum(["native", "custom_build", "automation_platform"]);

const PhaseSchema = z.object({
  label: z.string().min(1).max(120),
  portionPct: z.number().min(5).max(92),
  durationLabel: z.string().min(1).max(160),
});

const ProjectSchema = z.object({
  name: z.string().min(1).max(400),
  scopeOfWork: z.string().min(1).max(12000),
  objectives: z.string().min(1).max(8000),
  expectedOutcomes: z.array(z.string().min(1).max(800)).min(1).max(8),
  costEstimate: CostEnum,
  risksAndBarriers: z.array(z.string().min(1).max(800)).max(12),
  timeline: z.object({
    unit: TimelineUnitEnum,
    valueRealistic: z.number().positive(),
    displayLabel: z.string().min(1).max(240),
  }),
  timelinePhases: z.array(PhaseSchema).min(2).max(5),
  recommendedTools: z.object({
    ai: z.array(z.string().min(1).max(300)).max(10),
    nonAi: z.array(z.string().min(1).max(300)).max(10),
  }).optional().default({ ai: [], nonAi: [] }),
  integrationRecommendations: z.array(
    z.object({
      name: z.string().min(1).max(300),
      type: IntegrationTypeEnum,
      rationale: z.string().min(1).max(600),
    })
  ).max(10).optional().default([]),
});

const ReadinessSchema = z.object({
  executiveMemo: z.string().min(1).max(12000),
  stabilizeFirstAccelerators: z.array(z.string().min(1).max(800)).max(12),
});

const ScopeDocSchema = z.object({
  schemaVersion: z.literal("1.0"),
  assessmentId: z.string().uuid(),
  disclaimer: z.string().min(1).max(2000),
  readiness: ReadinessSchema,
  projects: z.array(ProjectSchema).min(1).max(3),
});

export type ProjectScopeDoc = z.infer<typeof ScopeDocSchema>;

function parseTechStackItems(text: string | null | undefined): string[] {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/\n|,|;|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set(parts)).slice(0, 20);
}

function buildGenericTools(projectName: string) {
  return {
    ai: [
      `LLM assistant workflow for ${projectName}`,
      "AI prompt + quality guardrail layer",
    ],
    nonAi: [
      "Project tracking workspace (e.g., Jira/Asana/ClickUp)",
      "Documentation + SOP workspace (e.g., Notion/Confluence)",
    ],
  };
}

function buildGenericIntegrations() {
  return [
    {
      name: "CRM sync (bi-directional)",
      type: "native" as const,
      rationale: "Keep account, activity, and delivery status aligned with go-to-market workflows.",
    },
    {
      name: "PM status + milestone sync",
      type: "automation_platform" as const,
      rationale: "Use Zapier/Make.com if native connectors are unavailable for rapid deployment.",
    },
    {
      name: "Knowledge base and reporting handoff",
      type: "custom_build" as const,
      rationale: "Support reusable reporting and governance artifacts beyond off-the-shelf mappings.",
    },
  ];
}

function inferToolsFromTechStack(techStack: string[]) {
  const normalized = techStack.map((s) => s.toLowerCase());
  const has = (x: string) => normalized.some((v) => v.includes(x));
  const ai: string[] = ["AI copilot for workflow execution and QA"];
  const nonAi: string[] = [];
  const integrations = buildGenericIntegrations();

  if (has("salesforce")) nonAi.push("Salesforce");
  if (has("hubspot")) nonAi.push("HubSpot");
  if (has("jira")) nonAi.push("Jira");
  if (has("asana")) nonAi.push("Asana");
  if (has("clickup")) nonAi.push("ClickUp");
  if (has("notion")) nonAi.push("Notion");
  if (has("slack")) nonAi.push("Slack");
  if (has("microsoft") || has("office 365")) nonAi.push("Microsoft 365");
  if (has("google workspace")) nonAi.push("Google Workspace");

  if (!nonAi.length) nonAi.push("Existing CRM and PM stack");
  return { ai, nonAi, integrations };
}

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function isNarrativeAIEnabled() {
  return String(process.env.NARRATIVE_AI_ENABLED ?? "").toLowerCase() === "true";
}

function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is missing.");
  return new Anthropic({ apiKey });
}

function stableStringify(value: unknown): string {
  const seen = new WeakSet();
  const sorter = (obj: any): any => {
    if (obj === null || typeof obj !== "object") return obj;
    if (seen.has(obj)) return "[Circular]";
    seen.add(obj);
    if (Array.isArray(obj)) return obj.map(sorter);
    const keys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = sorter(obj[k]);
    return out;
  };
  return JSON.stringify(sorter(value));
}

function applyTimelineBuffer(project: z.infer<typeof ProjectSchema>) {
  const vr = Math.max(0.5, Number(project.timeline.valueRealistic));
  const valueBuffered = Math.max(1, Math.ceil(vr * 1.15));
  const unit = project.timeline.unit;
  const unitLabel = unit === "days" ? "days" : unit === "weeks" ? "weeks" : "months";
  return {
    ...project,
    timeline: {
      unit,
      valueRealistic: vr,
      valueBuffered,
      displayLabel:
        project.timeline.displayLabel.trim() ||
        `About ${valueBuffered} ${unitLabel} (includes ~15% schedule buffer)`,
    },
  };
}

function finalizeScopeDoc(
  raw: ProjectScopeDoc,
  ctx: {
    assessmentId: string;
    readinessScore: number | null;
    readinessBand: string | null;
    readinessKey: string;
    companyTechStack: string[];
  }
): ProjectScopeDoc {
  const bandKeyParsed = BandKeyEnum.safeParse(ctx.readinessKey);
  const bandKey = bandKeyParsed.success ? bandKeyParsed.data : "unknown";

  const inferred = inferToolsFromTechStack(ctx.companyTechStack);
  const projects = raw.projects.map((p) => {
    const buffered = applyTimelineBuffer(p);
    const fallbackTools = buildGenericTools(buffered.name);
    return {
      ...buffered,
      recommendedTools: {
        ai: buffered.recommendedTools?.ai?.length ? buffered.recommendedTools.ai : inferred.ai.length ? inferred.ai : fallbackTools.ai,
        nonAi:
          buffered.recommendedTools?.nonAi?.length
            ? buffered.recommendedTools.nonAi
            : inferred.nonAi.length
              ? inferred.nonAi
              : fallbackTools.nonAi,
      },
      integrationRecommendations:
        buffered.integrationRecommendations?.length
          ? buffered.integrationRecommendations
          : inferred.integrations.length
            ? inferred.integrations
            : buildGenericIntegrations(),
    };
  });

  const accelerators =
    bandKey === "stabilize"
      ? raw.readiness.stabilizeFirstAccelerators.slice(0, 12)
      : [];

  return {
    schemaVersion: "1.0",
    assessmentId: ctx.assessmentId,
    disclaimer: raw.disclaimer,
    readiness: {
      executiveMemo: raw.readiness.executiveMemo,
      stabilizeFirstAccelerators: accelerators,
    },
    projects,
    // appended after zod — store as extended json
  } as ProjectScopeDoc;
}

function attachReadinessMetrics(fin: Record<string, unknown>, ctx: { readinessScore: number | null; readinessBand: string | null; readinessKey: string }) {
  (fin as any).readinessMetrics = {
    protectedReadinessScore: ctx.readinessScore,
    readinessBand: ctx.readinessBand,
    readinessBandKey: ctx.readinessKey,
  };
}

function buildPlaceholderScope(args: {
  assessmentId: string;
  pilotProjects: any[];
  results: any;
}): ProjectScopeDoc {
  const { assessmentId, results } = args;
  const pilots: any[] = Array.isArray(args.pilotProjects) ? args.pilotProjects : [];

  const readinessScore = results?.aggregate?.overall?.weightedAverage ?? null;
  const readinessBand = results?.aggregate?.overall?.readinessBand ?? null;
  const readinessKey = results?.aggregate?.overall?.readinessKey ?? "unknown";

  const projects =
    pilots.slice(0, 3).map((p, i) => ({
      name: String(p?.name ?? `Initiative ${i + 1}`).slice(0, 400),
      scopeOfWork:
        `Executive overview for ${String(p?.name ?? "this initiative")}. ` +
        `Define boundaries, stakeholders, and success measures before build-out. Subject to refinement.`,
      objectives: String(
        p?.businessProblem ?? "Clarify the targeted workflow, pain points, and measurable success criteria."
      ).slice(0, 8000),
      expectedOutcomes: [String(p?.expectedOutcome ?? "Measurable time, quality, or risk improvement in-scope.")].filter(
        Boolean
      ),
      costEstimate: "medium" as const,
      risksAndBarriers: [
        "Scope creep without an executive owner",
        "Data access and permissioning delays",
        "Change management underestimated",
      ],
      timeline: {
        unit: "weeks" as const,
        valueRealistic: 8,
        displayLabel: "About 9–11 weeks inclusive of buffer (placeholder)",
      },
      timelinePhases: [
        { label: "Discovery & design", portionPct: 25, durationLabel: "~2–3 weeks" },
        { label: "Build / configure", portionPct: 45, durationLabel: "~4–5 weeks" },
        { label: "Pilot & hardening", portionPct: 30, durationLabel: "~3–4 weeks" },
      ],
      recommendedTools: buildGenericTools(String(p?.name ?? `Initiative ${i + 1}`)),
      integrationRecommendations: buildGenericIntegrations(),
    })) ?? [];

  while (projects.length < 1) {
    projects.push({
      name: "Foundational pilot",
      scopeOfWork: "Placeholder scope until AI generation is enabled.",
      objectives: "Establish a narrow, measurable AI-assisted workflow.",
      expectedOutcomes: ["Documented time savings or quality lift in one workflow"],
      costEstimate: "medium" as const,
      risksAndBarriers: ["Incomplete requirements", "Unclear ownership"],
      timeline: { unit: "weeks" as const, valueRealistic: 10, displayLabel: "Placeholder timeline" },
      timelinePhases: [
        { label: "Discovery", portionPct: 30, durationLabel: "TBD" },
        { label: "Delivery", portionPct: 70, durationLabel: "TBD" },
      ],
      recommendedTools: buildGenericTools("Foundational pilot"),
      integrationRecommendations: buildGenericIntegrations(),
    });
  }

  const stabilize = readinessKey === "stabilize";
  const memo = [
    `Readiness index (protected): ${readinessScore ?? "—"} on a 0–5 scale.`,
    readinessBand ? `Band: ${readinessBand}.` : "",
    stabilize
      ? "The organization is in a stabilize-first posture: sequence governance and data foundations before scaling pilots."
      : "The organization may proceed with bounded pilots while maintaining explicit guardrails.",
    "This scope overview is illustrative; refine with your team and Northline as facts evolve.",
  ]
    .filter(Boolean)
    .join(" ");

  const doc: ProjectScopeDoc = {
    schemaVersion: "1.0",
    assessmentId,
    disclaimer:
      "This Northline Intelligence project scope overview is generated for discussion only. Estimates, costs, timelines, and risks are not commitments and will change as requirements and constraints emerge.",
    readiness: {
      executiveMemo: memo,
      stabilizeFirstAccelerators: stabilize
        ? [
            "Assign a named executive sponsor and weekly steering for AI pilots",
            "Inventory critical data sources and access controls before build",
            "Run a 30-day stability sprint on the weakest readiness pillar",
            "Adopt a lightweight AI use policy and human review standard",
          ]
        : [],
    },
    projects: projects.slice(0, 3) as z.infer<typeof ProjectSchema>[],
  };

  return doc;
}

async function generateScopeWithAI(args: {
  assessmentId: string;
  results: any;
  narrativeJson: any;
  pilotProjects: any[];
  companyTechStack: string[];
  integrationContext: string;
}) {
  const { assessmentId, results, narrativeJson, pilotProjects, companyTechStack, integrationContext } = args;
  const companyReference = results?.narrativeContext?.reference?.companyDescriptor ?? "the company";
  const readinessScore = results?.aggregate?.overall?.weightedAverage ?? null;
  const readinessBand = results?.aggregate?.overall?.readinessBand ?? null;
  const readinessKey = results?.aggregate?.overall?.readinessKey ?? "unknown";

  const executiveBullets = Array.isArray(narrativeJson?.executiveSummaryBullets)
    ? narrativeJson.executiveSummaryBullets
    : [];
  const maturityExpl = narrativeJson?.maturityInterpretation?.explanation ?? "";

  const input = {
    assessmentId,
    companyReference,
    readiness: { score: readinessScore, band: readinessBand, bandKey: readinessKey },
    executiveSummaryBullets: executiveBullets.slice(0, 6),
    maturityInterpretationSummary: maturityExpl,
    pilotProjects,
    companyTechStack,
    integrationContext,
    instructions: {
      costScale:
        "costEstimate must be one of: low, medium, high, low-medium, medium-high. Be conservative; when uncertain prefer the higher band or a blended band (e.g. low-medium).",
      timeline:
        "timeline.valueRealistic is your best single-number realistic duration BEFORE buffer. The server will apply a 15% buffer automatically. Use unit days, weeks, or months. Pick the unit that fits (avoid unrealistic precision).",
      phases:
        "timelinePhases: 2–5 phases that sum visually to ~100% of the bar via portionPct (rough planning breakdown).",
      risks: "risksAndBarriers: concrete delivery and adoption risks, not generic filler.",
      stabilize:
        readinessKey === "stabilize"
          ? "Include 3–8 practical stabilizeFirstAccelerators bullets to raise readiness (governance, data, ownership, training)."
          : "stabilizeFirstAccelerators should be an empty array.",
      toolsAndIntegrations:
        "For each project include recommendedTools.ai[], recommendedTools.nonAi[], and integrationRecommendations[]. Evaluate whether non-AI systems integration/workflow structuring is a prerequisite or higher priority than AI when signals suggest fragmentation, manual transfers, no unified operational view, inconsistent workflows, or low system integrity/readiness. Frame this as a foundation layer (Foundational Systems Layer / Unified Operational Layer / Integration & Workflow Standardization). Include concrete non-AI recommendations such as CRM-billing-support synchronization, centralized data/reporting layer, workflow automation via Zapier/Make.com, API-based system connections, and cross-team process standardization. If companyTechStack/integrationContext is present, reference specific tools and connections; otherwise use generalized but actionable language. Clearly distinguish integration/UOL as the foundation and AI as an enhancement layer. If readiness.bandKey is stabilize, strongly prioritize non-AI foundational work and position AI as a secondary phase.",
    },
  };

  const model = process.env.NARRATIVE_AI_MODEL || DEFAULT_MODEL;
  const client = getAnthropicClient();

  const system = [
    "You are a senior engagement lead at Northline Intelligence.",
    "Produce an executive-consumable PROJECT SCOPE overview for EACH pilot project in INPUT.pilotProjects.",
    "Use ONLY INPUT. Do not invent vendors, products, or facts not supported by INPUT.",
    "Never use a real company name; use companyReference or 'the company'.",
    "Tone: calm, decisive, practical. Acknowledge uncertainty; be conservative on cost and time.",
    "",
    "For each project you MUST output:",
    "- scopeOfWork: what is in scope for the engagement (clear boundaries).",
    "- objectives: what we are trying to accomplish (plain English).",
    "- expectedOutcomes: bullet list of measurable or observable outcomes.",
    "- costEstimate: qualitative conservative estimate per instructions.",
    "- risksAndBarriers: barriers that could delay or derail.",
    "- timeline.valueRealistic + timeline.unit + timeline.displayLabel (realistic BEFORE 15% buffer).",
    "- timelinePhases for a simple executive timeline visual.",
    "- recommendedTools.ai and recommendedTools.nonAi (concrete where stack context exists).",
    "- integrationRecommendations[] with name, type (native|custom_build|automation_platform), and rationale.",
    "- If foundational systems issues exist, prioritize non-AI integration/workflow recommendations ahead of AI automation.",
    "",
    "readiness.executiveMemo: short executive memo on whether the company is ready to move forward NOW, tied to readiness.bandKey. If stabilize-first, say so plainly.",
    "readiness.stabilizeFirstAccelerators: only if bandKey is stabilize; else [].",
    "If readiness.bandKey is stabilize, prioritize foundational non-AI integration/workflow work and treat AI as secondary/future phase.",
    "",
    "disclaimer: one paragraph that plans are subject to change as information emerges.",
    "Do not force AI solutions where foundational system issues are the real blocker.",
  ].join("\n");

  const user =
    "Return structured JSON via the tool. INPUT:\n" + JSON.stringify(input);

  const toolSchema = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "assessmentId", "disclaimer", "readiness", "projects"],
    properties: {
      schemaVersion: { type: "string", enum: ["1.0"] },
      assessmentId: { type: "string" },
      disclaimer: { type: "string", maxLength: 2000 },
      readiness: {
        type: "object",
        additionalProperties: false,
        required: ["executiveMemo", "stabilizeFirstAccelerators"],
        properties: {
          executiveMemo: { type: "string", maxLength: 12000 },
          stabilizeFirstAccelerators: { type: "array", items: { type: "string" }, maxItems: 12 },
        },
      },
      projects: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "name",
            "scopeOfWork",
            "objectives",
            "expectedOutcomes",
            "costEstimate",
            "risksAndBarriers",
            "timeline",
            "timelinePhases",
          ],
          properties: {
            name: { type: "string" },
            scopeOfWork: { type: "string" },
            objectives: { type: "string" },
            expectedOutcomes: { type: "array", items: { type: "string" }, maxItems: 8 },
            costEstimate: {
              type: "string",
              enum: ["low", "medium", "high", "low-medium", "medium-high"],
            },
            risksAndBarriers: { type: "array", items: { type: "string" }, maxItems: 12 },
            timeline: {
              type: "object",
              additionalProperties: false,
              required: ["unit", "valueRealistic", "displayLabel"],
              properties: {
                unit: { type: "string", enum: ["days", "weeks", "months"] },
                valueRealistic: { type: "number" },
                displayLabel: { type: "string" },
              },
            },
            timelinePhases: {
              type: "array",
              minItems: 2,
              maxItems: 5,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["label", "portionPct", "durationLabel"],
                properties: {
                  label: { type: "string" },
                  portionPct: { type: "number" },
                  durationLabel: { type: "string" },
                },
              },
            },
            recommendedTools: {
              type: "object",
              additionalProperties: false,
              properties: {
                ai: { type: "array", items: { type: "string" }, maxItems: 10 },
                nonAi: { type: "array", items: { type: "string" }, maxItems: 10 },
              },
            },
            integrationRecommendations: {
              type: "array",
              maxItems: 10,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "type", "rationale"],
                properties: {
                  name: { type: "string" },
                  type: { type: "string", enum: ["native", "custom_build", "automation_platform"] },
                  rationale: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  } as const;

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: user }],
    tools: [
      {
        name: "project_scope_json",
        description: "Structured project scope overview JSON",
        input_schema: toolSchema as any,
      },
    ],
    tool_choice: { type: "tool", name: "project_scope_json" },
  } as any);

  const toolUse = (response as any)?.content?.find(
    (b: any) => b?.type === "tool_use" && b?.name === "project_scope_json"
  );
  const toolInput = toolUse?.input;
  if (!toolInput || typeof toolInput !== "object") {
    throw new Error("Anthropic did not return project_scope_json tool output.");
  }
  return toolInput;
}

function sanitizeAndParse(raw: any, assessmentId: string, results: any, companyTechStack: string[]): Record<string, unknown> {
  const readinessScore = results?.aggregate?.overall?.weightedAverage ?? null;
  const readinessBand = results?.aggregate?.overall?.readinessBand ?? null;
  const readinessKey = String(results?.aggregate?.overall?.readinessKey ?? "unknown");

  const parsed = ScopeDocSchema.parse({
    schemaVersion: "1.0",
    assessmentId,
    disclaimer:
      typeof raw.disclaimer === "string" && raw.disclaimer.trim()
        ? raw.disclaimer.trim()
        : "This overview is for planning discussions only and will change as requirements mature.",
    readiness: {
      executiveMemo: String(raw?.readiness?.executiveMemo ?? "").slice(0, 12000),
      stabilizeFirstAccelerators: Array.isArray(raw?.readiness?.stabilizeFirstAccelerators)
        ? raw.readiness.stabilizeFirstAccelerators.map((x: any) => String(x)).filter(Boolean)
        : [],
    },
    projects: Array.isArray(raw.projects) ? raw.projects : [],
  });

  let finalized = finalizeScopeDoc(parsed, {
    assessmentId,
    readinessScore,
    readinessBand,
    readinessKey,
    companyTechStack,
  });

  const asRecord = {
    ...finalized,
    projects: finalized.projects.map(applyTimelineBuffer),
  } as unknown as Record<string, unknown>;

  attachReadinessMetrics(asRecord, { readinessScore, readinessBand, readinessKey });
  return asRecord;
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const params = await context.params;
    const parsedParams = ParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json({ ok: false, error: "Invalid assessment id (UUID)" }, { status: 400 });
    }
    const assessmentId = parsedParams.data.id;

    let body: any = {};
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      body = await req.json().catch(() => ({}));
    }

    const urlEmail = (req.nextUrl.searchParams.get("email") ?? "").trim().toLowerCase();
    const urlToken = (req.nextUrl.searchParams.get("token") ?? "").trim();
    const finalEmail = (String(body?.email ?? "").trim().toLowerCase() || urlEmail).trim().toLowerCase();
    const finalToken = (String(body?.token ?? "").trim() || urlToken).trim();

    const authInvite = await authorizeParticipantOrInvite(req, assessmentId, {
      email: finalEmail,
      token: finalToken,
    });

    if (!authInvite.ok) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    if (authInvite.auth === "invite" && authInvite.participantId) {
      await markInviteAccepted(authInvite.participantId);
    }

    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        organization_id: true,
        organization: {
          select: {
            show_project_scope_review: true,
            context_notes: true,
            tech_stack_notes: true,
            integration_notes: true,
            process_workflow_notes: true,
            primary_pressures: true,
            website: true,
            industry: true,
          },
        },
      },
    });

    if (!assessment) {
      return NextResponse.json({ ok: false, error: "Assessment not found" }, { status: 404 });
    }

    let adminBypass = authInvite.auth === "admin";
    if (!adminBypass && authInvite.auth === "session" && authInvite.userEmail) {
      adminBypass = isAdminEmail(authInvite.userEmail);
    }

    const enabled = Boolean(assessment.organization?.show_project_scope_review);
    if (!enabled && !adminBypass) {
      return NextResponse.json(
        { ok: false, error: "Project scope review is not enabled for this organization." },
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

    const resultsPack = await buildAssessmentResultsPayload({ assessmentId });
    if (!resultsPack.ok) {
      return NextResponse.json(resultsPack.body, { status: resultsPack.status });
    }
    const results = resultsPack.body;

    const latestNarrative = await prisma.assessmentNarrative.findFirst({
      where: { assessment_id: assessmentId },
      orderBy: [{ version: "desc" }],
    });

    if (!latestNarrative) {
      return NextResponse.json(
        {
          ok: false,
          error: "Generate Executive Insights first so pilot projects are available for scoping.",
        },
        { status: 400 }
      );
    }

    const narrativeJson = latestNarrative.narrative_json as any;
    const pilotProjects = Array.isArray(narrativeJson?.pilotProjects) ? narrativeJson.pilotProjects : [];
    const participantContextRows = await prisma.participant.findMany({
      where: { assessment_id: assessmentId },
      select: { ai_opportunities_notes: true },
      take: 30,
      orderBy: { created_at: "asc" },
    });
    const intakeContext = participantContextRows
      .map((p) => String(p.ai_opportunities_notes ?? "").trim())
      .filter(Boolean)
      .join("\n");
    const companyTechStack = parseTechStackItems(
      assessment.organization?.tech_stack_notes ?? assessment.organization?.context_notes ?? ""
    );
    const integrationContext = [
      assessment.organization?.integration_notes
        ? `Known integrations:\n${assessment.organization.integration_notes}`
        : "",
      assessment.organization?.process_workflow_notes
        ? `Known processes/workflows:\n${assessment.organization.process_workflow_notes}`
        : "",
      assessment.organization?.primary_pressures ? `Primary pressures: ${assessment.organization.primary_pressures}` : "",
      assessment.organization?.website ? `Website: ${assessment.organization.website}` : "",
      assessment.organization?.industry ? `Industry: ${assessment.organization.industry}` : "",
      intakeContext ? `Participant intake context:\n${intakeContext}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    if (pilotProjects.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Narrative has no pilot projects to scope." },
        { status: 400 }
      );
    }

    const force = ["1", "true", "yes"].includes(String(body?.force ?? "").toLowerCase());

    const input_hash = sha256Hex(
      stableStringify({
        scope_schema: "1.0",
        assessment_id: assessmentId,
        narrative_version: latestNarrative.version,
        narrative_id: latestNarrative.id,
        pilot_fingerprint: pilotProjects.map((p: any) => ({
          n: p?.name,
          o: p?.expectedOutcome,
        })),
        results_score: results?.aggregate?.overall?.weightedAverage ?? null,
      })
    );

    if (!force) {
      const existing = await prisma.assessmentProjectScope.findFirst({
        where: { assessment_id: assessmentId, input_hash },
        orderBy: [{ version: "desc" }],
      });
      if (existing) {
        return NextResponse.json({ ok: true, cached: true, scope: existing }, { status: 200 });
      }
    }

    const latestScope = await prisma.assessmentProjectScope.findFirst({
      where: { assessment_id: assessmentId },
      orderBy: [{ version: "desc" }],
    });
    const nextVersion = (latestScope?.version ?? 0) + 1;

    let scopeJson: Record<string, unknown>;
    let usedAI = false;

    if (isNarrativeAIEnabled()) {
      try {
        const aiRaw = await generateScopeWithAI({
          assessmentId,
          results,
          narrativeJson,
          pilotProjects,
          companyTechStack,
          integrationContext,
        });
        scopeJson = sanitizeAndParse(aiRaw, assessmentId, results, companyTechStack);
        usedAI = true;
      } catch (e: any) {
        console.warn("project-scope AI failed, using placeholder:", e?.message ?? e);
        const ph = buildPlaceholderScope({
          assessmentId,
          pilotProjects,
          results,
        });
        scopeJson = sanitizeAndParse(ph, assessmentId, results, companyTechStack);
      }
    } else {
      const ph = buildPlaceholderScope({
        assessmentId,
        pilotProjects,
        results,
      });
      scopeJson = sanitizeAndParse(ph, assessmentId, results, companyTechStack);
    }

    const created = await prisma.assessmentProjectScope.create({
      data: {
        assessment_id: assessmentId,
        version: nextVersion,
        input_hash,
        engine_version: "v1",
        schema_version: "1.0",
        model_provider: usedAI ? "anthropic" : null,
        model_name: usedAI ? (process.env.NARRATIVE_AI_MODEL || DEFAULT_MODEL) : null,
        scope_json: scopeJson as any,
      },
    });

    return NextResponse.json({ ok: true, cached: false, scope: created }, { status: 201 });
  } catch (err: any) {
    console.error("POST project-scope/generate error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error.", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
