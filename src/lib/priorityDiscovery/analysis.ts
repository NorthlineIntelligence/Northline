/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "crypto";
import { callModelRouter } from "@/lib/ai/modelRouter";

export type PriorityParticipantInput = {
  id: string;
  email?: string | null;
  role?: string | null;
  seniorityLevel?: string | null;
  department?: string | null;
};

export type PriorityResponseInput = {
  participantId: string;
  questionId: string;
  section: string;
  questionText: string;
  responseType: string;
  scoringDimension?: string | null;
  answerText?: string | null;
  answerNumber?: number | null;
  answerJson?: unknown;
};

export type PriorityDiscoveryAnalysisInput = {
  organization: {
    id: string;
    name?: string | null;
    industry?: string | null;
    contextNotes?: string | null;
    techStackNotes?: string | null;
    integrationNotes?: string | null;
    processWorkflowNotes?: string | null;
  };
  assessmentId: string;
  participants: PriorityParticipantInput[];
  responses: PriorityResponseInput[];
  readinessResults?: unknown;
  notes?: string | null;
  questionSetVersion: string;
  aiProcessingMode?: "fast" | "executive";
  readoutProfile?: "standard" | "client_specific";
  documentExcerpts?: Array<{
    title: string;
    sourceType?: string | null;
    excerpt: string;
    truncated?: boolean;
  }>;
  workflowMapSummary?: string | null;
  evidenceDigest?: Array<{
    section: string;
    question: string;
    answer: string;
    participantRole?: string | null;
    participantDepartment?: string | null;
    participantSeniority?: string | null;
  }>;
};

export type PriorityProjectOutput = {
  rank: number;
  projectName: string;
  problemStatement: string;
  recommendedSolution: string;
  whyThisMatters: string;
  evidenceFromResponses: string[];
  affectedDepartments: string[];
  shortTermImpact: string;
  longTermImpact: string;
  implementationRisk: string;
  riskExplanation: string;
  readinessDependency: string;
  firstStep: string;
  estimatedEffort: "low" | "medium" | "high";
  estimatedTimeHorizon: "0-30 days" | "30-90 days" | "90-180 days" | "6-12 months";
  aiSuitabilityScore: number;
  automationSuitabilityScore: number;
  businessImpactScore: number;
  urgencyScore: number;
  synergyScore: number;
  riskScore: number;
  priorityScore: number;
  confidenceLevel: "low" | "medium" | "high";
};

export type PriorityDiscoveryAnalysisOutput = {
  executiveSummary: string;
  executiveReadout: {
    headline: string;
    executiveNarrative: string;
    coreProblem: string;
    strategicImplication: string;
    decisionPoint: string;
  };
  impactAssessment: {
    valueCreation: string;
    shortTermImpact: string;
    longTermImpact: string;
    costOfInaction: string;
  };
  aiRecommendations: Array<{
    title: string;
    recommendation: string;
    executiveRationale: string;
    expectedImpact: string;
    requiredGuardrail: string;
    confidenceLevel: "low" | "medium" | "high";
  }>;
  topPainPoints: Array<{
    painPoint: string;
    description: string;
    evidence: string[];
    mentionedByCount: number;
    affectedFunctions: string[];
    urgencyScore: number;
    impactScore: number;
  }>;
  topPriorityProjects: PriorityProjectOutput[];
  alignmentAnalysis: {
    overallSynergyScore: number;
    areasOfStrongAgreement: string[];
    areasOfDisagreement: string[];
    leadershipVsTeamGaps: string[];
    blindSpots: string[];
  };
  shortTermOpportunities: string[];
  longTermOpportunities: string[];
  risksAndDependencies: string[];
  riskRegister: Array<{
    risk: string;
    impact: string;
    severity: "low" | "medium" | "high";
    mitigation: string;
  }>;
  managerReviewChecklist: string[];
  recommendedNextStep: string;
  missingInputs: string[];
};

export const PRIORITY_DISCOVERY_SYSTEM_PROMPT = `You are a senior AI systems strategist and organizational assessment expert for Northline Intelligence.
You are analyzing an AI Priority Discovery Assessment.
Your job is not to summarize responses. Your job is to identify the highest-value AI and automation opportunities the organization should consider based on participant evidence, business pain, workflow friction, urgency, alignment, and readiness constraints.

This output is the executive readout and must feel like a premium consulting deliverable. It should be concise, polished, helpful, and firm. It should be easy for a manager to review, edit, and approve, and strong enough for an executive audience to accept as practical decision support.

Rules:
* Use only the provided input.
* Do not invent company facts.
* Do not assume every AI idea is a good idea.
* Treat free-text responses as evidence.
* Identify repeated themes, contradictions, urgency signals, and blind spots.
* Prioritize practical AI and automation projects that solve real business problems.
* Separate quick wins from long-term transformation opportunities.
* Identify risks clearly.
* If readiness assessment results are provided, use them to determine whether each project is safe to pursue now.
* Do not overhype AI.
* Keep recommendations executive-ready, practical, concise, and human-centered. Concise does not mean thin: use enough depth to make the recommendation defensible.
* Speak in business language: problems, solutions, impacts, risks, dependencies, and next decisions.
* Be consultative and professional: helpful but firm, never clinical, academic, fluffy, or vendor-hype oriented.
* Recommendations should read like a $10K strategy readout: clear judgment, strong prioritization, executive-level framing, and enough evidence to defend the recommendation.
* Format longer narrative fields for easy consumption. Use short section headings, short paragraphs, and bullet lines beginning with "- " where helpful.
* Executive-level narrative fields may be up to 800 words each when the evidence supports it, but should never feel padded.
* Return valid JSON only using the required schema.

Evaluation logic:
* High priority projects solve repeated, painful, business-relevant problems.
* Strong projects have clear ownership, repeated evidence, measurable value, and manageable risk.
* Weak projects sound exciting but lack process clarity, data readiness, ownership, or alignment.
* AI should assist, recommend, summarize, route, draft, analyze, or orchestrate.
* Automation should only be recommended when the workflow is stable enough to repeat safely.`;

export const PRIORITY_DISCOVERY_CLIENT_SPECIFIC_SYSTEM_PROMPT = `${PRIORITY_DISCOVERY_SYSTEM_PROMPT}

Additional rules for client-specific readouts:
* Write for this exact client using their organization name, industry, systems, workflows, and uploaded documents.
* Every major claim must trace to participant answers, CRM notes, readiness results, workflow map summary, or uploaded document excerpts.
* Use verbatim participant language in evidenceFromResponses and pain point evidence whenever possible.
* Name specific tools, teams, workflows, customers, or process steps mentioned in the input. Do not substitute generic labels.
* Avoid generic consulting filler such as "digital transformation", "leverage AI", "streamline operations", "unlock value", or "move the needle" unless the input used that exact language.
* Top 5 project names must describe this client's actual workflow or business problem, not generic project templates.
* If documents or notes mention constraints, vendors, KPIs, or initiatives, reference them explicitly in the readout and Top 5 cards.
* When evidence conflicts, explain the disagreement using roles/departments from the evidence digest.
* If a recommendation depends on missing data, say exactly what is missing and why it blocks action.`;

function buildClientSpecificPromptInstructions(input: PriorityDiscoveryAnalysisInput) {
  const orgName = input.organization.name?.trim() || "this organization";
  return `CLIENT-SPECIFIC READOUT MODE

You are generating a client-specific executive readout for ${orgName}. The current output is too generic. Your job is to make every section unmistakably about this client.

Mandatory specificity rules:
- Reference ${orgName} by name throughout the readout.
- Use the evidenceDigest entries as primary source material. Quote or paraphrase participant answers closely.
- Use documentExcerpts and CRM notes to name systems, workflows, initiatives, constraints, and stakeholders mentioned by the client.
- Each topPriorityProjects item MUST include at least 2 evidenceFromResponses entries that sound like real participant quotes or document-backed facts.
- Each topPainPoints item MUST include evidence entries tied to named functions, workflows, or document titles when available.
- Each aiRecommendations item MUST explain why it fits ${orgName}'s stated context, not a generic company.
- Do not invent vendors, metrics, teams, or initiatives that are not supported by the input.
- Prefer concrete nouns from the input over abstract strategy language.

Organization profile:
${JSON.stringify(input.organization, null, 2)}

Uploaded documents and extracted excerpts:
${JSON.stringify(input.documentExcerpts ?? [], null, 2)}

CRM / workflow notes:
${JSON.stringify(
    {
      contextNotes: input.organization.contextNotes,
      techStackNotes: input.organization.techStackNotes,
      integrationNotes: input.organization.integrationNotes,
      processWorkflowNotes: input.organization.processWorkflowNotes,
      workflowMapSummary: input.workflowMapSummary,
      legacyNotesField: input.notes,
    },
    null,
    2
  )}

Participant evidence digest:
${JSON.stringify(input.evidenceDigest ?? [], null, 2)}

Readiness results:
${JSON.stringify(input.readinessResults ?? null, null, 2)}

Full raw responses for cross-check:
${JSON.stringify(input.responses, null, 2)}`;
}

export function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function clampScore(value: unknown, fallback = 50) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function calculatePriorityScore(args: {
  businessImpactScore: number;
  urgencyScore: number;
  aiSuitabilityScore: number;
  automationSuitabilityScore: number;
  synergyScore: number;
  dataReadinessScore?: number;
  riskScore: number;
}) {
  return clampScore(
    args.businessImpactScore * 0.25 +
      args.urgencyScore * 0.2 +
      args.aiSuitabilityScore * 0.15 +
      args.automationSuitabilityScore * 0.15 +
      args.synergyScore * 0.15 +
      (args.dataReadinessScore ?? 60) * 0.05 -
      args.riskScore * 0.05
  );
}

function asTextAnswer(response: PriorityResponseInput) {
  if (typeof response.answerText === "string" && response.answerText.trim()) return response.answerText.trim();
  if (typeof response.answerNumber === "number") return String(response.answerNumber);
  if (response.answerJson !== undefined && response.answerJson !== null) {
    if (Array.isArray(response.answerJson)) return response.answerJson.map(String).join(", ");
    return JSON.stringify(response.answerJson);
  }
  return "";
}

function estimateSynergyScore(input: PriorityDiscoveryAnalysisInput) {
  const byQuestion = new Map<string, PriorityResponseInput[]>();
  for (const r of input.responses) {
    const arr = byQuestion.get(r.questionId) ?? [];
    arr.push(r);
    byQuestion.set(r.questionId, arr);
  }

  let numericConsistency = 0;
  let numericCount = 0;
  let selectionOverlap = 0;
  let selectionCount = 0;

  for (const group of byQuestion.values()) {
    const nums = group.map((r) => r.answerNumber).filter((n): n is number => typeof n === "number");
    if (nums.length > 1) {
      const mean = nums.reduce((sum, n) => sum + n, 0) / nums.length;
      const variance = nums.reduce((sum, n) => sum + Math.pow(n - mean, 2), 0) / nums.length;
      numericConsistency += Math.max(0, 100 - variance * 22);
      numericCount += 1;
    }

    const selected = group
      .map((r) => (Array.isArray(r.answerJson) ? r.answerJson.map(String) : []))
      .filter((arr) => arr.length > 0);
    if (selected.length > 1) {
      const counts = new Map<string, number>();
      for (const arr of selected) for (const item of new Set(arr)) counts.set(item, (counts.get(item) ?? 0) + 1);
      const maxOverlap = Math.max(...Array.from(counts.values()));
      selectionOverlap += (maxOverlap / selected.length) * 100;
      selectionCount += 1;
    }
  }

  const freeText = input.responses
    .filter((r) => r.responseType === "FREE_TEXT")
    .map(asTextAnswer)
    .filter(Boolean);
  const tokens = freeText
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 4 && !["would", "could", "should", "there", "their", "about", "because"].includes(word));
  const tokenCounts = new Map<string, number>();
  for (const token of tokens) tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
  const repeatedThemeCount = Array.from(tokenCounts.values()).filter((count) => count >= 2).length;
  const textScore = freeText.length > 1 ? Math.min(100, 35 + repeatedThemeCount * 8) : 45;

  const scores = [
    numericCount ? numericConsistency / numericCount : null,
    selectionCount ? selectionOverlap / selectionCount : null,
    textScore,
  ].filter((n): n is number => n !== null);

  return clampScore(scores.reduce((sum, score) => sum + score, 0) / Math.max(1, scores.length), 55);
}

function extractJsonObject(raw: string) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return JSON.parse(trimmed);
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
  throw new Error("AI response did not include a JSON object.");
}

function topEvidence(input: PriorityDiscoveryAnalysisInput, limit = 8) {
  return input.responses
    .map((response) => ({
      text: asTextAnswer(response),
      section: response.section,
      question: response.questionText,
      participantId: response.participantId,
    }))
    .filter((r) => r.text.length > 0)
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, limit);
}

function fallbackAnalysis(input: PriorityDiscoveryAnalysisInput): PriorityDiscoveryAnalysisOutput {
  const evidence = topEvidence(input, 12);
  const synergyScore = estimateSynergyScore(input);
  const sections = Array.from(new Set(evidence.map((e) => e.section)));
  const primaryEvidence = evidence.slice(0, 5).map((e) => e.text);
  const departmentAnswers = input.responses
    .filter((r) => r.responseType === "DEPARTMENT")
    .map(asTextAnswer)
    .filter(Boolean);
  const affectedDepartments = Array.from(new Set(departmentAnswers.length ? departmentAnswers : ["Cross-functional"]));

  const projectSeeds = [
    {
      name: "Workflow Friction Reduction Pilot",
      problem: "Repeated manual work and handoffs are slowing execution.",
      solution: "Map the highest-friction workflow, then pilot AI-assisted intake, summarization, routing, or task creation.",
    },
    {
      name: "Decision Visibility and Reporting Assistant",
      problem: "Teams need clearer visibility, cleaner summaries, and faster decision support.",
      solution: "Create an AI-assisted reporting workflow that turns source updates into executive-ready summaries and alerts.",
    },
    {
      name: "Knowledge Access and Answering Layer",
      problem: "People repeatedly search for, recreate, or request information from others.",
      solution: "Pilot a grounded internal knowledge assistant using approved company documents and process context.",
    },
    {
      name: "Customer and Employee Experience Improvement Sprint",
      problem: "Delays, duplicated work, or inconsistent service are affecting stakeholders.",
      solution: "Select one customer or employee journey and automate low-risk status updates, handoffs, or first drafts.",
    },
    {
      name: "AI Pilot Governance and Ownership Setup",
      problem: "Priority ideas need clearer ownership, data readiness, and guardrails before scaling.",
      solution: "Define pilot owner, data source, success metric, review cadence, and human approval checkpoints.",
    },
  ];

  const topPriorityProjects = projectSeeds.map((seed, index) => {
    const businessImpactScore = clampScore(76 - index * 4);
    const urgencyScore = clampScore(74 - index * 3);
    const riskScore = clampScore(34 + index * 6);
    const aiSuitabilityScore = clampScore(index === 4 ? 62 : 78 - index * 4);
    const automationSuitabilityScore = clampScore(index === 4 ? 48 : 70 - index * 3);
    const priorityScore = calculatePriorityScore({
      businessImpactScore,
      urgencyScore,
      aiSuitabilityScore,
      automationSuitabilityScore,
      synergyScore,
      dataReadinessScore: 60,
      riskScore,
    });

    return {
      rank: index + 1,
      projectName: seed.name,
      problemStatement: seed.problem,
      recommendedSolution: seed.solution,
      whyThisMatters: "Participant responses point to practical improvements that can create near-term operating leverage.",
      evidenceFromResponses: primaryEvidence,
      affectedDepartments,
      shortTermImpact: "Creates a concrete pilot target and reduces the highest-friction work in the first cycle.",
      longTermImpact: "Builds reusable AI and automation practices that can be expanded across related workflows.",
      implementationRisk: riskScore >= 60 ? "high" : riskScore >= 40 ? "medium" : "low",
      riskExplanation: "Validate process stability, ownership, and data quality before automating production decisions.",
      readinessDependency: input.readinessResults
        ? "Review readiness pillar constraints before expanding beyond a controlled pilot."
        : "Readiness assessment not provided. Confirm data quality, ownership, and change capacity before launch.",
      firstStep: "Run a 60-minute prioritization workshop to confirm owner, workflow boundary, evidence, and success metric.",
      estimatedEffort: index < 2 ? "medium" : index === 4 ? "low" : "high",
      estimatedTimeHorizon: index < 2 ? "30-90 days" : index === 4 ? "0-30 days" : "90-180 days",
      aiSuitabilityScore,
      automationSuitabilityScore,
      businessImpactScore,
      urgencyScore,
      synergyScore,
      riskScore,
      priorityScore,
      confidenceLevel: evidence.length >= 8 ? "medium" : "low",
    } satisfies PriorityProjectOutput;
  });

  return {
    executiveSummary:
      [
        "Executive Takeaway",
        "",
        "The Priority Discovery responses indicate several decision-support and automation opportunities, but the best path is selective rather than broad. The strongest opportunities appear to sit where manual coordination, information access, reporting, and workflow ownership are slowing execution.",
        "",
        "Recommended posture:",
        "- Treat these recommendations as decision support, not final business decisions.",
        "- Validate ownership, data readiness, and workflow stability before committing build resources.",
        "- Start with one controlled pilot that can prove value in 30-90 days.",
      ].join("\n"),
    executiveReadout: {
      headline: "The strongest opportunities are practical workflow and decision-support improvements, not broad AI transformation bets.",
      executiveNarrative:
        [
          "What The Responses Are Saying",
          "",
          "Participant input points to a familiar operating pattern: important work is slowed by manual coordination, inconsistent access to information, and unclear ownership around decisions. That does not mean the company should launch a broad AI program. It means leadership has a practical opportunity to remove friction from work that is already painful, visible, and repeatable enough to justify focused attention.",
          "",
          "Where AI Can Help",
          "",
          "The strongest use of AI in this environment is likely assistance before autonomy. AI should help summarize context, route requests, draft first-pass outputs, surface exceptions, and prepare decision-ready information. Automation should only follow when the underlying workflow is stable, owned, and measurable.",
          "",
          "Executive Guidance",
          "",
          "- Pick one workflow where the pain is repeated and the owner is clear.",
          "- Define the business outcome before selecting tools or models.",
          "- Keep a human approval point anywhere the recommendation affects customers, revenue, compliance, employees, or systems of record.",
          "- Use the first pilot to learn what can scale, not to prove that every process should be automated.",
          "",
          "The leadership decision is straightforward: choose a first pilot that is narrow enough to govern, valuable enough to matter, and visible enough to build momentum.",
        ].join("\n"),
      coreProblem:
        "The organization has opportunities for leverage, but the work must be sequenced around real friction, clear ownership, and process stability.",
      strategicImplication:
        "If leadership treats AI as a focused operating improvement rather than a technology experiment, the first pilot can reduce wasted effort and clarify where future investment belongs.",
      decisionPoint:
        "Choose one first pilot, name the owner, define the workflow boundary, and confirm the success metric before funding build work.",
    },
    impactAssessment: {
      valueCreation:
        "The near-term value is cycle-time reduction, lower administrative drag, clearer decision support, and better use of employee capacity.",
      shortTermImpact:
        "A focused pilot can produce evidence within 30-90 days by removing manual steps, improving handoffs, or producing faster summaries and reports.",
      longTermImpact:
        "The longer-term value is a repeatable operating model for AI-enabled workflows: governed data sources, clear owners, reusable patterns, and scalable confidence.",
      costOfInaction:
        "Without action, the same manual work and decision delays will continue to absorb capacity while less disciplined AI experiments compete for attention.",
    },
    topPainPoints: sections.slice(0, 5).map((section, index) => ({
      painPoint: section,
      description: `Responses surfaced friction related to ${section.toLowerCase()}.`,
      evidence: evidence.filter((e) => e.section === section).slice(0, 3).map((e) => e.text),
      mentionedByCount: new Set(evidence.filter((e) => e.section === section).map((e) => e.participantId)).size,
      affectedFunctions: affectedDepartments,
      urgencyScore: clampScore(70 - index * 4),
      impactScore: clampScore(72 - index * 3),
    })),
    topPriorityProjects,
    alignmentAnalysis: {
      overallSynergyScore: synergyScore,
      areasOfStrongAgreement: synergyScore >= 60 ? ["Respondents show shared concern around recurring workflow and decision friction."] : [],
      areasOfDisagreement: synergyScore < 60 ? ["Responses appear fragmented; facilitate alignment before selecting a major pilot."] : [],
      leadershipVsTeamGaps: [],
      blindSpots: input.readinessResults ? [] : ["No readiness assessment was included, so feasibility constraints need human review."],
    },
    shortTermOpportunities: topPriorityProjects.slice(0, 2).map((p) => p.projectName),
    longTermOpportunities: topPriorityProjects.slice(2, 5).map((p) => p.projectName),
    aiRecommendations: [
      {
        title: "Start with an assisted workflow, not autonomous automation",
        recommendation:
          "Use AI to summarize, route, draft, recommend, or alert inside a bounded workflow before allowing it to trigger downstream actions.",
        executiveRationale:
          "This creates useful leverage while protecting the business from premature automation of unstable processes.",
        expectedImpact:
          "Faster execution, less manual coordination, and clearer evidence about where automation is safe to expand.",
        requiredGuardrail:
          "Keep a human owner accountable for approvals, exceptions, and final decisions.",
        confidenceLevel: evidence.length >= 8 ? "medium" : "low",
      },
      {
        title: "Tie each AI pilot to one measurable business outcome",
        recommendation:
          "Require every pilot to name the executive owner, workflow boundary, baseline metric, target improvement, and review date.",
        executiveRationale:
          "This prevents AI work from becoming a novelty project and keeps investment connected to business value.",
        expectedImpact:
          "Cleaner prioritization, faster executive decisions, and easier stop/scale calls.",
        requiredGuardrail:
          "Do not fund pilots without a business metric and an accountable operating owner.",
        confidenceLevel: "medium",
      },
    ],
    risksAndDependencies: [
      "Do not automate unstable workflows without process cleanup.",
      "Keep human review in place for recommendations that affect customers, employees, compliance, or finances.",
    ],
    riskRegister: [
      {
        risk: "Automating an unclear workflow",
        impact: "Could accelerate rework, exceptions, or customer-facing inconsistency.",
        severity: "high",
        mitigation: "Map the workflow, decision points, handoffs, and escalation paths before automation.",
      },
      {
        risk: "Weak ownership",
        impact: "The pilot may stall after initial interest because no leader owns adoption, measurement, and tradeoffs.",
        severity: "medium",
        mitigation: "Assign a single business owner and set a 30/60/90-day review cadence.",
      },
      {
        risk: "Insufficient readiness evidence",
        impact: "Data quality or change-management constraints may limit automation confidence.",
        severity: input.readinessResults ? "medium" : "high",
        mitigation: input.readinessResults
          ? "Use readiness pillar constraints to set guardrails."
          : "Complete or reference readiness findings before scaling beyond a controlled pilot.",
      },
    ],
    managerReviewChecklist: [
      "Confirm each project name is plain-language and executive-ready.",
      "Verify evidence excerpts do not expose sensitive participant details.",
      "Confirm the recommended first pilot has an accountable owner.",
      "Validate impact claims against known business priorities.",
      "Decide whether each project is ready now, pilot with guardrails, or requires foundation work.",
    ],
    recommendedNextStep: "Confirm the first pilot in a facilitated review, then validate data sources and ownership.",
    missingInputs: input.readinessResults ? [] : ["AI Readiness Assessment results"],
  };
}

function normalizeAnalysis(raw: any, input: PriorityDiscoveryAnalysisInput): PriorityDiscoveryAnalysisOutput {
  const fallback = fallbackAnalysis(input);
  const synergy = clampScore(raw?.alignmentAnalysis?.overallSynergyScore, fallback.alignmentAnalysis.overallSynergyScore);

  const projects = Array.isArray(raw?.topPriorityProjects) ? raw.topPriorityProjects : [];
  const normalizedProjects = projects.slice(0, 5).map((p: any, index: number) => {
    const businessImpactScore = clampScore(p.businessImpactScore, 70);
    const urgencyScore = clampScore(p.urgencyScore, 70);
    const aiSuitabilityScore = clampScore(p.aiSuitabilityScore, 70);
    const automationSuitabilityScore = clampScore(p.automationSuitabilityScore, 65);
    const riskScore = clampScore(p.riskScore, 40);
    const priorityScore = clampScore(
      p.priorityScore,
      calculatePriorityScore({
        businessImpactScore,
        urgencyScore,
        aiSuitabilityScore,
        automationSuitabilityScore,
        synergyScore: clampScore(p.synergyScore, synergy),
        dataReadinessScore: clampScore(p.dataReadinessScore, 60),
        riskScore,
      })
    );
    return {
      rank: Number(p.rank ?? index + 1),
      projectName: String(p.projectName ?? fallback.topPriorityProjects[index]?.projectName ?? `Priority Project ${index + 1}`),
      problemStatement: String(p.problemStatement ?? ""),
      recommendedSolution: String(p.recommendedSolution ?? ""),
      whyThisMatters: String(p.whyThisMatters ?? ""),
      evidenceFromResponses: Array.isArray(p.evidenceFromResponses) ? p.evidenceFromResponses.map(String) : [],
      affectedDepartments: Array.isArray(p.affectedDepartments) ? p.affectedDepartments.map(String) : [],
      shortTermImpact: String(p.shortTermImpact ?? ""),
      longTermImpact: String(p.longTermImpact ?? ""),
      implementationRisk: String(p.implementationRisk ?? "medium"),
      riskExplanation: String(p.riskExplanation ?? ""),
      readinessDependency: String(p.readinessDependency ?? ""),
      firstStep: String(p.firstStep ?? ""),
      estimatedEffort: ["low", "medium", "high"].includes(p.estimatedEffort) ? p.estimatedEffort : "medium",
      estimatedTimeHorizon: ["0-30 days", "30-90 days", "90-180 days", "6-12 months"].includes(p.estimatedTimeHorizon)
        ? p.estimatedTimeHorizon
        : "30-90 days",
      aiSuitabilityScore,
      automationSuitabilityScore,
      businessImpactScore,
      urgencyScore,
      synergyScore: clampScore(p.synergyScore, synergy),
      riskScore,
      priorityScore,
      confidenceLevel: ["low", "medium", "high"].includes(p.confidenceLevel) ? p.confidenceLevel : "medium",
    } satisfies PriorityProjectOutput;
  });
  const paddedProjects = [...normalizedProjects];
  for (let i = paddedProjects.length; i < 5; i++) {
    paddedProjects.push({
      ...fallback.topPriorityProjects[i],
      rank: i + 1,
      evidenceFromResponses:
        fallback.topPriorityProjects[i]?.evidenceFromResponses?.length
          ? fallback.topPriorityProjects[i].evidenceFromResponses
          : topEvidence(input, 5).map((e) => e.text),
    });
  }

  return {
    executiveSummary: String(raw?.executiveSummary ?? fallback.executiveSummary),
    executiveReadout: {
      headline: String(raw?.executiveReadout?.headline ?? fallback.executiveReadout.headline),
      executiveNarrative: String(raw?.executiveReadout?.executiveNarrative ?? fallback.executiveReadout.executiveNarrative),
      coreProblem: String(raw?.executiveReadout?.coreProblem ?? fallback.executiveReadout.coreProblem),
      strategicImplication: String(raw?.executiveReadout?.strategicImplication ?? fallback.executiveReadout.strategicImplication),
      decisionPoint: String(raw?.executiveReadout?.decisionPoint ?? fallback.executiveReadout.decisionPoint),
    },
    impactAssessment: {
      valueCreation: String(raw?.impactAssessment?.valueCreation ?? fallback.impactAssessment.valueCreation),
      shortTermImpact: String(raw?.impactAssessment?.shortTermImpact ?? fallback.impactAssessment.shortTermImpact),
      longTermImpact: String(raw?.impactAssessment?.longTermImpact ?? fallback.impactAssessment.longTermImpact),
      costOfInaction: String(raw?.impactAssessment?.costOfInaction ?? fallback.impactAssessment.costOfInaction),
    },
    aiRecommendations: Array.isArray(raw?.aiRecommendations)
      ? raw.aiRecommendations.slice(0, 5).map((r: any) => ({
          title: String(r.title ?? "AI recommendation"),
          recommendation: String(r.recommendation ?? ""),
          executiveRationale: String(r.executiveRationale ?? ""),
          expectedImpact: String(r.expectedImpact ?? ""),
          requiredGuardrail: String(r.requiredGuardrail ?? ""),
          confidenceLevel: ["low", "medium", "high"].includes(r.confidenceLevel) ? r.confidenceLevel : "medium",
        }))
      : fallback.aiRecommendations,
    topPainPoints: Array.isArray(raw?.topPainPoints) ? raw.topPainPoints : fallback.topPainPoints,
    topPriorityProjects: paddedProjects.slice(0, 5),
    alignmentAnalysis: {
      overallSynergyScore: synergy,
      areasOfStrongAgreement: Array.isArray(raw?.alignmentAnalysis?.areasOfStrongAgreement)
        ? raw.alignmentAnalysis.areasOfStrongAgreement.map(String)
        : fallback.alignmentAnalysis.areasOfStrongAgreement,
      areasOfDisagreement: Array.isArray(raw?.alignmentAnalysis?.areasOfDisagreement)
        ? raw.alignmentAnalysis.areasOfDisagreement.map(String)
        : fallback.alignmentAnalysis.areasOfDisagreement,
      leadershipVsTeamGaps: Array.isArray(raw?.alignmentAnalysis?.leadershipVsTeamGaps)
        ? raw.alignmentAnalysis.leadershipVsTeamGaps.map(String)
        : [],
      blindSpots: Array.isArray(raw?.alignmentAnalysis?.blindSpots) ? raw.alignmentAnalysis.blindSpots.map(String) : [],
    },
    shortTermOpportunities: Array.isArray(raw?.shortTermOpportunities)
      ? raw.shortTermOpportunities.map(String)
      : fallback.shortTermOpportunities,
    longTermOpportunities: Array.isArray(raw?.longTermOpportunities)
      ? raw.longTermOpportunities.map(String)
      : fallback.longTermOpportunities,
    risksAndDependencies: Array.isArray(raw?.risksAndDependencies)
      ? raw.risksAndDependencies.map(String)
      : fallback.risksAndDependencies,
    riskRegister: Array.isArray(raw?.riskRegister)
      ? raw.riskRegister.slice(0, 8).map((r: any) => ({
          risk: String(r.risk ?? ""),
          impact: String(r.impact ?? ""),
          severity: ["low", "medium", "high"].includes(r.severity) ? r.severity : "medium",
          mitigation: String(r.mitigation ?? ""),
        }))
      : fallback.riskRegister,
    managerReviewChecklist: Array.isArray(raw?.managerReviewChecklist)
      ? raw.managerReviewChecklist.map(String).slice(0, 8)
      : fallback.managerReviewChecklist,
    recommendedNextStep: String(raw?.recommendedNextStep ?? fallback.recommendedNextStep),
    missingInputs: Array.isArray(raw?.missingInputs) ? raw.missingInputs.map(String) : fallback.missingInputs,
  };
}

export async function analyzePriorityDiscoveryAssessment(input: PriorityDiscoveryAnalysisInput) {
  const isClientSpecific = input.readoutProfile === "client_specific";
  const prompt = `Analyze this AI Priority Discovery Assessment and return JSON only.

Required JSON shape:
{
  "executiveSummary": "",
  "executiveReadout": {"headline":"","executiveNarrative":"","coreProblem":"","strategicImplication":"","decisionPoint":""},
  "impactAssessment": {"valueCreation":"","shortTermImpact":"","longTermImpact":"","costOfInaction":""},
  "aiRecommendations": [{"title":"","recommendation":"","executiveRationale":"","expectedImpact":"","requiredGuardrail":"","confidenceLevel":"low | medium | high"}],
  "topPainPoints": [{"painPoint":"","description":"","evidence":[],"mentionedByCount":0,"affectedFunctions":[],"urgencyScore":0,"impactScore":0}],
  "topPriorityProjects": [{"rank":1,"projectName":"","problemStatement":"","recommendedSolution":"","whyThisMatters":"","evidenceFromResponses":[],"affectedDepartments":[],"shortTermImpact":"","longTermImpact":"","implementationRisk":"","riskExplanation":"","readinessDependency":"","firstStep":"","estimatedEffort":"low | medium | high","estimatedTimeHorizon":"0-30 days | 30-90 days | 90-180 days | 6-12 months","aiSuitabilityScore":0,"automationSuitabilityScore":0,"businessImpactScore":0,"urgencyScore":0,"synergyScore":0,"riskScore":0,"priorityScore":0,"confidenceLevel":"low | medium | high"}],
  "alignmentAnalysis": {"overallSynergyScore":0,"areasOfStrongAgreement":[],"areasOfDisagreement":[],"leadershipVsTeamGaps":[],"blindSpots":[]},
  "shortTermOpportunities": [],
  "longTermOpportunities": [],
  "risksAndDependencies": [],
  "riskRegister": [{"risk":"","impact":"","severity":"low | medium | high","mitigation":""}],
  "managerReviewChecklist": [],
  "recommendedNextStep": "",
  "missingInputs": []
}

Non-negotiable output counts:
- topPriorityProjects MUST contain exactly 5 project objects, ranked 1 through 5.
- aiRecommendations MUST contain at least 3 and no more than 5 recommendation objects.
- topPainPoints should contain 3-7 pain points when evidence allows.
- riskRegister should contain 3-8 risks.
- If evidence is thin, still produce five differentiated project recommendations using the available input and clearly lower confidence where appropriate.

Executive readout requirements:
- executiveSummary: up to 800 words. Make it a scannable executive readout, not a short abstract. Use short headings and bullet lines where useful. It should explain the primary finding, why it matters, what leadership should do, and what should be avoided.
- executiveReadout.executiveNarrative: up to 800 words. Use a premium consulting tone: helpful but firm. Explain what is happening, why it matters, what leadership should do next, what not to do, and how the Top 5 recommendations should be interpreted.
- Both executiveSummary and executiveReadout.executiveNarrative should be formatted for quick executive consumption: clear headings, short paragraphs, and optional bullet lines beginning with "- ". Do not use markdown tables.
- coreProblem must name the business problem, not the technology opportunity.
- impactAssessment must connect problems to money, time, risk, customer experience, employee capacity, or speed to execution.
- aiRecommendations must be practical AI recommendations, not generic transformation advice. Each recommendation needs the business rationale, expected impact, and guardrail.
- riskRegister must tie risks to business impact and mitigation. Avoid vague risks like "change management" without explaining business consequence.
- The Top 5 project cards must each read like something a manager could approve and an executive could defend.
- Prefer plain language over jargon. No hype. No filler. No invented facts.
${isClientSpecific ? `
Client-specific readout requirements:
- This readout must be unmistakably tailored to the client in the input. Generic strategy language is unacceptable.
- Name the organization, workflows, systems, teams, and constraints from the provided notes and documents.
- Ground every Top 5 project, pain point, and recommendation in participant answers and/or uploaded document excerpts.
- Use participant language in evidenceFromResponses. Do not fabricate quotes.
- If a document title or CRM note mentions a system, process, KPI, or initiative, reference it explicitly where relevant.
- Call out contradictions between leadership and team responses when present in the evidence digest.
` : ""}

Priority score formula:
businessImpactScore * 0.25 + urgencyScore * 0.20 + AIApplicabilityScore * 0.15 + automationApplicabilityScore * 0.15 + synergyScore * 0.15 + dataReadinessScore * 0.05 - riskScore * 0.05, normalized 0-100.

${isClientSpecific ? buildClientSpecificPromptInstructions(input) : `Input:\n${JSON.stringify(input, null, 2)}`}`;

  const result = await callModelRouter({
    prompt,
    taskType: "assessment_analysis",
    requestedMode: input.aiProcessingMode ?? "executive",
    clientId: input.organization.id,
    systemPrompt: isClientSpecific
      ? PRIORITY_DISCOVERY_CLIENT_SPECIFIC_SYSTEM_PROMPT
      : PRIORITY_DISCOVERY_SYSTEM_PROMPT,
    temperature: isClientSpecific ? 0.2 : 0.15,
    maxTokens: isClientSpecific ? 9000 : 6000,
  });

  let raw: any;
  try {
    raw = extractJsonObject(result.response);
  } catch {
    raw = fallbackAnalysis(input);
  }

  const output = normalizeAnalysis(raw, input);
  return {
    output,
    modelUsed: result.modelUsed,
    providerUsed: result.providerUsed,
    modeUsed: result.modeUsed,
    warnings: result.warnings,
    inputHash: stableHash(input),
  };
}
