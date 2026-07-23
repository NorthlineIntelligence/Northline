/* eslint-disable @typescript-eslint/no-explicit-any */
import { callModelRouter } from "@/lib/ai/modelRouter";
import {
  stableHash,
  type PriorityDiscoveryAnalysisInput,
} from "@/lib/priorityDiscovery/analysis";

export type ClientSpecificInternalReadout = {
  internalBrief: string;
  clientContext: {
    organizationName: string;
    industry: string | null;
    statedPressures: string[];
    techStack: string[];
    integrations: string[];
    workflows: string[];
  };
  documentFindings: Array<{
    documentTitle: string;
    sourceType: string | null;
    keyFacts: string[];
    gaps: string[];
    contradictions: string[];
  }>;
  assessmentFindings: {
    participantCount: number;
    responseCount: number;
    consensusThemes: string[];
    contradictions: string[];
    blindSpots: string[];
    leadershipVsTeamGaps: string[];
  };
  systemsAndWorkflows: Array<{
    name: string;
    currentState: string;
    painPoints: string[];
    gaps: string[];
    evidence: string[];
  }>;
  criticalGaps: Array<{
    gap: string;
    severity: "low" | "medium" | "high" | "critical";
    evidence: string[];
    blocksWhat: string;
    recommendedFix: string;
  }>;
  readinessBlockers: string[];
  participantQuotes: Array<{
    participantRole: string | null;
    participantDepartment: string | null;
    question: string;
    quote: string;
    significance: string;
  }>;
  strategicNotes: {
    whatLeadershipBelieves: string;
    whatTeamsExperience: string;
    documentVsAssessmentConflicts: string[];
    whereToPushBack: string[];
    whereToAlign: string[];
  };
  consultantWorkingNotes: string;
  recommendedInvestigations: string[];
  missingInputs: string[];
};

const CLIENT_SPECIFIC_INTERNAL_SYSTEM_PROMPT = `You are a senior Northline delivery consultant writing an ADMIN-ONLY internal diagnostic readout.

This is NOT an executive-facing deliverable. Write for another consultant who needs the nitty-gritty truth to formulate notes, strategy, and delivery plans.

Rules:
* Use only the provided input. Do not invent systems, metrics, teams, or initiatives.
* Be specific: name systems, workflows, documents, roles, and participant language from the input.
* Be direct and critical when the evidence supports it. Call out gaps, contradictions, weak ownership, missing data, and readiness blockers plainly.
* Separate facts from inference. Label inference clearly when you must infer.
* Quote or closely paraphrase participant answers in participantQuotes and evidence arrays.
* Pull concrete facts from uploaded document excerpts and CRM notes.
* If readiness results are provided, use them to explain what is safe vs unsafe to pursue now.
* Do not use generic consulting filler or hype.
* Return valid JSON only using the required schema.
* Prefer depth over polish. This should read like working notes, not a board deck.`;

function extractJsonObject(raw: string) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return JSON.parse(trimmed);
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
  throw new Error("AI response did not include a JSON object.");
}

function asStringList(value: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    return value
      .split("\n")
      .map((line) => line.replace(/^[-*•]\s*/, "").trim())
      .filter(Boolean);
  }
  return fallback;
}

function normalizeSeverity(value: unknown): "low" | "medium" | "high" | "critical" {
  const normalized = String(value ?? "medium").toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "critical") {
    return normalized;
  }
  return "medium";
}

function fallbackReadout(input: PriorityDiscoveryAnalysisInput): ClientSpecificInternalReadout {
  const orgName = input.organization.name ?? "Client";
  const quotes = (input.evidenceDigest ?? []).slice(0, 12).map((entry) => ({
    participantRole: entry.participantRole ?? null,
    participantDepartment: entry.participantDepartment ?? null,
    question: entry.question,
    quote: entry.answer,
    significance: entry.section,
  }));

  return {
    internalBrief: `Internal diagnostic readout for ${orgName}. Review participant evidence, uploaded documents, and CRM notes before delivery planning.`,
    clientContext: {
      organizationName: orgName,
      industry: input.organization.industry ?? null,
      statedPressures: asStringList(input.organization.contextNotes),
      techStack: asStringList(input.organization.techStackNotes),
      integrations: asStringList(input.organization.integrationNotes),
      workflows: asStringList(input.organization.processWorkflowNotes),
    },
    documentFindings: (input.documentExcerpts ?? []).slice(0, 8).map((doc) => ({
      documentTitle: doc.title,
      sourceType: doc.sourceType ?? null,
      keyFacts: [doc.excerpt.slice(0, 400)],
      gaps: doc.truncated ? ["Document excerpt was truncated; full document may contain additional detail."] : [],
      contradictions: [],
    })),
    assessmentFindings: {
      participantCount: input.participants.length,
      responseCount: input.responses.length,
      consensusThemes: [],
      contradictions: [],
      blindSpots: [],
      leadershipVsTeamGaps: [],
    },
    systemsAndWorkflows: [],
    criticalGaps: quotes.slice(0, 5).map((quote) => ({
      gap: quote.quote.slice(0, 200),
      severity: "medium" as const,
      evidence: [quote.quote],
      blocksWhat: "Needs consultant review",
      recommendedFix: "Validate with client and document owner",
    })),
    readinessBlockers: [],
    participantQuotes: quotes,
    strategicNotes: {
      whatLeadershipBelieves: "",
      whatTeamsExperience: "",
      documentVsAssessmentConflicts: [],
      whereToPushBack: [],
      whereToAlign: [],
    },
    consultantWorkingNotes: (input.evidenceDigest ?? [])
      .slice(0, 20)
      .map((entry) => `- [${entry.section}] ${entry.question}: ${entry.answer}`)
      .join("\n"),
    recommendedInvestigations: ["Validate document-backed workflow details with client sponsor."],
    missingInputs: input.documentExcerpts?.length ? [] : ["No uploaded document excerpts were available."],
  };
}

function normalizeReadout(raw: any, input: PriorityDiscoveryAnalysisInput): ClientSpecificInternalReadout {
  const fallback = fallbackReadout(input);
  const clientContextRaw =
    raw?.clientContext && typeof raw.clientContext === "object" ? raw.clientContext : {};

  return {
    internalBrief: String(raw?.internalBrief ?? fallback.internalBrief).slice(0, 12000),
    clientContext: {
      organizationName: String(clientContextRaw.organizationName ?? fallback.clientContext.organizationName),
      industry:
        clientContextRaw.industry == null ? fallback.clientContext.industry : String(clientContextRaw.industry),
      statedPressures: asStringList(clientContextRaw.statedPressures, fallback.clientContext.statedPressures),
      techStack: asStringList(clientContextRaw.techStack, fallback.clientContext.techStack),
      integrations: asStringList(clientContextRaw.integrations, fallback.clientContext.integrations),
      workflows: asStringList(clientContextRaw.workflows, fallback.clientContext.workflows),
    },
    documentFindings: Array.isArray(raw?.documentFindings)
      ? raw.documentFindings.slice(0, 12).map((entry: any) => ({
          documentTitle: String(entry?.documentTitle ?? "Document"),
          sourceType: entry?.sourceType ? String(entry.sourceType) : null,
          keyFacts: asStringList(entry?.keyFacts),
          gaps: asStringList(entry?.gaps),
          contradictions: asStringList(entry?.contradictions),
        }))
      : fallback.documentFindings,
    assessmentFindings: {
      participantCount: Number(raw?.assessmentFindings?.participantCount) || fallback.assessmentFindings.participantCount,
      responseCount: Number(raw?.assessmentFindings?.responseCount) || fallback.assessmentFindings.responseCount,
      consensusThemes: asStringList(raw?.assessmentFindings?.consensusThemes),
      contradictions: asStringList(raw?.assessmentFindings?.contradictions),
      blindSpots: asStringList(raw?.assessmentFindings?.blindSpots),
      leadershipVsTeamGaps: asStringList(raw?.assessmentFindings?.leadershipVsTeamGaps),
    },
    systemsAndWorkflows: Array.isArray(raw?.systemsAndWorkflows)
      ? raw.systemsAndWorkflows.slice(0, 20).map((entry: any) => ({
          name: String(entry?.name ?? "Workflow"),
          currentState: String(entry?.currentState ?? ""),
          painPoints: asStringList(entry?.painPoints),
          gaps: asStringList(entry?.gaps),
          evidence: asStringList(entry?.evidence),
        }))
      : fallback.systemsAndWorkflows,
    criticalGaps: Array.isArray(raw?.criticalGaps)
      ? raw.criticalGaps.slice(0, 20).map((entry: any) => ({
          gap: String(entry?.gap ?? ""),
          severity: normalizeSeverity(entry?.severity),
          evidence: asStringList(entry?.evidence),
          blocksWhat: String(entry?.blocksWhat ?? ""),
          recommendedFix: String(entry?.recommendedFix ?? ""),
        }))
      : fallback.criticalGaps,
    readinessBlockers: asStringList(raw?.readinessBlockers, fallback.readinessBlockers),
    participantQuotes: Array.isArray(raw?.participantQuotes)
      ? raw.participantQuotes.slice(0, 30).map((entry: any) => ({
          participantRole: entry?.participantRole ? String(entry.participantRole) : null,
          participantDepartment: entry?.participantDepartment ? String(entry.participantDepartment) : null,
          question: String(entry?.question ?? ""),
          quote: String(entry?.quote ?? ""),
          significance: String(entry?.significance ?? ""),
        }))
      : fallback.participantQuotes,
    strategicNotes: {
      whatLeadershipBelieves: String(
        raw?.strategicNotes?.whatLeadershipBelieves ?? fallback.strategicNotes.whatLeadershipBelieves
      ).slice(0, 4000),
      whatTeamsExperience: String(
        raw?.strategicNotes?.whatTeamsExperience ?? fallback.strategicNotes.whatTeamsExperience
      ).slice(0, 4000),
      documentVsAssessmentConflicts: asStringList(raw?.strategicNotes?.documentVsAssessmentConflicts),
      whereToPushBack: asStringList(raw?.strategicNotes?.whereToPushBack),
      whereToAlign: asStringList(raw?.strategicNotes?.whereToAlign),
    },
    consultantWorkingNotes: String(raw?.consultantWorkingNotes ?? fallback.consultantWorkingNotes).slice(0, 20000),
    recommendedInvestigations: asStringList(raw?.recommendedInvestigations, fallback.recommendedInvestigations),
    missingInputs: asStringList(raw?.missingInputs, fallback.missingInputs),
  };
}

export async function analyzeClientSpecificInternalReadout(input: PriorityDiscoveryAnalysisInput) {
  const orgName = input.organization.name?.trim() || "this organization";
  const prompt = `Produce an admin-only internal diagnostic readout for ${orgName}.

Return JSON only with this exact shape:
{
  "internalBrief": "",
  "clientContext": {
    "organizationName": "",
    "industry": "",
    "statedPressures": [],
    "techStack": [],
    "integrations": [],
    "workflows": []
  },
  "documentFindings": [{
    "documentTitle": "",
    "sourceType": "",
    "keyFacts": [],
    "gaps": [],
    "contradictions": []
  }],
  "assessmentFindings": {
    "participantCount": 0,
    "responseCount": 0,
    "consensusThemes": [],
    "contradictions": [],
    "blindSpots": [],
    "leadershipVsTeamGaps": []
  },
  "systemsAndWorkflows": [{
    "name": "",
    "currentState": "",
    "painPoints": [],
    "gaps": [],
    "evidence": []
  }],
  "criticalGaps": [{
    "gap": "",
    "severity": "low | medium | high | critical",
    "evidence": [],
    "blocksWhat": "",
    "recommendedFix": ""
  }],
  "readinessBlockers": [],
  "participantQuotes": [{
    "participantRole": "",
    "participantDepartment": "",
    "question": "",
    "quote": "",
    "significance": ""
  }],
  "strategicNotes": {
    "whatLeadershipBelieves": "",
    "whatTeamsExperience": "",
    "documentVsAssessmentConflicts": [],
    "whereToPushBack": [],
    "whereToAlign": []
  },
  "consultantWorkingNotes": "",
  "recommendedInvestigations": [],
  "missingInputs": []
}

Requirements:
- internalBrief: 400-1200 words. Raw, specific, critical where warranted. Name systems, workflows, teams, and document facts.
- documentFindings: one entry per meaningful uploaded document excerpt when available.
- systemsAndWorkflows: name actual systems/workflows from documents, CRM notes, or participant answers.
- criticalGaps: 5-15 specific gaps with severity and evidence. Be blunt about what is missing or broken.
- participantQuotes: 8-20 high-signal quotes with role/department when known.
- consultantWorkingNotes: long-form working notes (800-2500 words) for the consultant to edit into strategy.
- strategicNotes.whereToPushBack: include direct pushback points when evidence supports them.
- missingInputs: list exact missing data that blocks confident recommendations.
- Do NOT produce a polished executive summary. This is internal only.

Organization profile:
${JSON.stringify(input.organization, null, 2)}

Uploaded documents:
${JSON.stringify(input.documentExcerpts ?? [], null, 2)}

CRM / workflow notes:
${JSON.stringify(
    {
      contextNotes: input.organization.contextNotes,
      techStackNotes: input.organization.techStackNotes,
      integrationNotes: input.organization.integrationNotes,
      processWorkflowNotes: input.organization.processWorkflowNotes,
      workflowMapSummary: input.workflowMapSummary,
    },
    null,
    2
  )}

Participant evidence digest:
${JSON.stringify(input.evidenceDigest ?? [], null, 2)}

Readiness results:
${JSON.stringify(input.readinessResults ?? null, null, 2)}

Full assessment responses:
${JSON.stringify(input.responses, null, 2)}`;

  const result = await callModelRouter({
    prompt,
    taskType: "workflow_gap_analysis",
    requestedMode: input.aiProcessingMode ?? "executive",
    clientId: input.organization.id,
    systemPrompt: CLIENT_SPECIFIC_INTERNAL_SYSTEM_PROMPT,
    temperature: 0.25,
    maxTokens: 12000,
  });

  let raw: any;
  try {
    raw = extractJsonObject(result.response);
  } catch {
    return {
      output: fallbackReadout(input),
      modelUsed: result.modelUsed,
      providerUsed: result.providerUsed,
      modeUsed: result.modeUsed,
      warnings: [...result.warnings, "AI response could not be parsed; fallback internal readout used."],
      inputHash: stableHash({ ...input, readoutKind: "client_specific_internal_v2" }),
    };
  }

  return {
    output: normalizeReadout(raw, input),
    modelUsed: result.modelUsed,
    providerUsed: result.providerUsed,
    modeUsed: result.modeUsed,
    warnings: result.warnings,
    inputHash: stableHash({ ...input, readoutKind: "client_specific_internal_v2" }),
  };
}
