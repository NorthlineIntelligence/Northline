import { PriorityTimeHorizon } from "@prisma/client";
import { callModelRouter } from "@/lib/ai/modelRouter";
import { buildPriorityAnalysisInput } from "@/lib/priorityDiscovery/analysisPersistence";

export type PriorityDiscoveryRoadmapPhase = {
  phaseNumber: number;
  title: string;
  durationLabel: string;
  durationDays: number;
  goals: string[];
  deliverables: string[];
  milestones: string[];
  tools: string[];
  dependencies: string[];
  risks: string[];
};

export type PriorityDiscoveryRoadmap = {
  rank: number;
  priorityProjectId: string;
  projectName: string;
  executiveSummary: string;
  objectives: string[];
  successCriteria: string[];
  phases: PriorityDiscoveryRoadmapPhase[];
  recommendedTools: string[];
  staffingNotes: string;
  readinessPrerequisites: string[];
  firstThirtyDays: string[];
};

export type PriorityDiscoveryRoadmapBundleOutput = {
  roadmaps: PriorityDiscoveryRoadmap[];
  bundleNotes: string;
};

function extractJsonObject(raw: string) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return JSON.parse(trimmed);
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
  throw new Error("AI response did not include a JSON object.");
}

function asStringList(value: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split("\n")
      .map((line) => line.replace(/^[-*•]\s*/, "").trim())
      .filter(Boolean);
  }
  return fallback;
}

function horizonToDays(horizon: PriorityTimeHorizon | null | undefined): number {
  if (horizon === PriorityTimeHorizon.DAYS_0_30) return 30;
  if (horizon === PriorityTimeHorizon.DAYS_90_180) return 120;
  if (horizon === PriorityTimeHorizon.MONTHS_6_12) return 180;
  return 60;
}

function fallbackRoadmap(project: {
  id: string;
  rank: number;
  project_name: string;
  problem_statement: string | null;
  recommended_solution: string | null;
  first_step: string | null;
  readiness_dependency: string | null;
  implementation_risk: string | null;
  estimated_time_horizon: PriorityTimeHorizon | null;
}): PriorityDiscoveryRoadmap {
  const totalDays = horizonToDays(project.estimated_time_horizon);
  const phaseDays = Math.max(14, Math.round(totalDays / 3));
  return {
    rank: project.rank,
    priorityProjectId: project.id,
    projectName: project.project_name,
    executiveSummary: [
      project.problem_statement,
      project.recommended_solution,
    ]
      .filter(Boolean)
      .join(" ")
      .trim(),
    objectives: [
      `Address: ${project.problem_statement ?? project.project_name}`,
      `Deliver: ${project.recommended_solution ?? "Target outcome from Priority Discovery"}`,
    ],
    successCriteria: [
      "Pilot outcome documented with baseline vs. post metrics",
      "Stakeholder sign-off on phase completion criteria",
      "Operational handoff with runbook and owner assigned",
    ],
    phases: [
      {
        phaseNumber: 1,
        title: "Discovery & design",
        durationLabel: `${phaseDays} days`,
        durationDays: phaseDays,
        goals: ["Validate scope", "Confirm data and workflow dependencies"],
        deliverables: ["Discovery brief", "Implementation plan", "Success metrics"],
        milestones: ["Kickoff complete", "Design approved"],
        tools: [],
        dependencies: asStringList(project.readiness_dependency),
        risks: asStringList(project.implementation_risk),
      },
      {
        phaseNumber: 2,
        title: "Build & pilot",
        durationLabel: `${phaseDays} days`,
        durationDays: phaseDays,
        goals: ["Implement core workflow", "Run controlled pilot"],
        deliverables: ["Working pilot", "Training materials", "Pilot results"],
        milestones: ["Pilot live", "Feedback incorporated"],
        tools: [],
        dependencies: [],
        risks: [],
      },
      {
        phaseNumber: 3,
        title: "Scale & handoff",
        durationLabel: `${Math.max(14, totalDays - phaseDays * 2)} days`,
        durationDays: Math.max(14, totalDays - phaseDays * 2),
        goals: ["Expand to production scope", "Establish ownership"],
        deliverables: ["Production rollout", "Runbook", "Monitoring plan"],
        milestones: ["Go-live", "30-day review"],
        tools: [],
        dependencies: [],
        risks: [],
      },
    ],
    recommendedTools: [],
    staffingNotes: "Assign a business owner plus delivery lead for each phase.",
    readinessPrerequisites: asStringList(project.readiness_dependency),
    firstThirtyDays: asStringList(project.first_step, ["Confirm sponsor", "Schedule kickoff", "Validate data access"]),
  };
}

function normalizePhase(raw: unknown, index: number): PriorityDiscoveryRoadmapPhase {
  const phase = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const durationDaysRaw = Number(phase.durationDays);
  const durationDays =
    Number.isFinite(durationDaysRaw) && durationDaysRaw > 0 ? Math.round(durationDaysRaw) : 21;
  return {
    phaseNumber: Number(phase.phaseNumber) || index + 1,
    title: String(phase.title ?? `Phase ${index + 1}`).slice(0, 200),
    durationLabel: String(phase.durationLabel ?? `${durationDays} days`).slice(0, 80),
    durationDays,
    goals: asStringList(phase.goals),
    deliverables: asStringList(phase.deliverables),
    milestones: asStringList(phase.milestones),
    tools: asStringList(phase.tools),
    dependencies: asStringList(phase.dependencies),
    risks: asStringList(phase.risks),
  };
}

function normalizeRoadmap(
  raw: unknown,
  project: {
    id: string;
    rank: number;
    project_name: string;
    problem_statement: string | null;
    recommended_solution: string | null;
    first_step: string | null;
    readiness_dependency: string | null;
    implementation_risk: string | null;
    estimated_time_horizon: PriorityTimeHorizon | null;
  }
): PriorityDiscoveryRoadmap {
  const fallback = fallbackRoadmap(project);
  const entry = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const phasesRaw = Array.isArray(entry.phases) ? entry.phases : [];
  const phases =
    phasesRaw.length > 0
      ? phasesRaw.slice(0, 6).map((phase, index) => normalizePhase(phase, index))
      : fallback.phases;

  return {
    rank: Number(entry.rank) || project.rank,
    priorityProjectId: project.id,
    projectName: String(entry.projectName ?? project.project_name).slice(0, 200),
    executiveSummary: String(entry.executiveSummary ?? fallback.executiveSummary).slice(0, 4000),
    objectives: asStringList(entry.objectives, fallback.objectives),
    successCriteria: asStringList(entry.successCriteria, fallback.successCriteria),
    phases,
    recommendedTools: asStringList(entry.recommendedTools),
    staffingNotes: String(entry.staffingNotes ?? fallback.staffingNotes).slice(0, 2000),
    readinessPrerequisites: asStringList(entry.readinessPrerequisites, fallback.readinessPrerequisites),
    firstThirtyDays: asStringList(entry.firstThirtyDays, fallback.firstThirtyDays),
  };
}

const ROADMAP_SYSTEM_PROMPT = `You are a senior Northline delivery consultant. Produce admin-only implementation roadmaps grounded in evidence. Be practical, sequenced, and specific. Do not invent facts not supported by the input. Use plain language. Output valid JSON only.`;

export async function generatePriorityDiscoveryRoadmaps(args: {
  assessmentId: string;
  analysis: {
    id: string;
    executive_summary: string | null;
    output_json: unknown;
    projects: Array<{
      id: string;
      rank: number;
      project_name: string;
      problem_statement: string | null;
      recommended_solution: string | null;
      short_term_impact: string | null;
      long_term_impact: string | null;
      implementation_risk: string | null;
      readiness_dependency: string | null;
      first_step: string | null;
      estimated_time_horizon: PriorityTimeHorizon | null;
      priority_score: number | null;
    }>;
  };
}) {
  const input = await buildPriorityAnalysisInput(args.assessmentId);
  if (!input) throw new Error("Priority Discovery assessment not found");

  const projects = args.analysis.projects.slice(0, 5);
  if (projects.length === 0) {
    throw new Error("No Top 5 projects found in the Priority Discovery analysis.");
  }

  const prompt = `Create admin-only PM roadmaps for each of the Top ${projects.length} Priority Discovery projects.

Return JSON:
{
  "bundleNotes": "string — cross-project sequencing notes for the delivery team",
  "roadmaps": [
    {
      "rank": 1,
      "projectName": "string",
      "executiveSummary": "string — 120-250 words for internal delivery planning",
      "objectives": ["string"],
      "successCriteria": ["string"],
      "phases": [
        {
          "phaseNumber": 1,
          "title": "string",
          "durationLabel": "e.g. 3 weeks",
          "durationDays": 21,
          "goals": ["string"],
          "deliverables": ["string"],
          "milestones": ["string"],
          "tools": ["string"],
          "dependencies": ["string"],
          "risks": ["string"]
        }
      ],
      "recommendedTools": ["string"],
      "staffingNotes": "string",
      "readinessPrerequisites": ["string"],
      "firstThirtyDays": ["string — concrete weekly actions"]
    }
  ]
}

Requirements:
- Exactly one roadmap per Top 5 project, same rank order.
- Each roadmap should have 3-5 phases that fit the estimated time horizon.
- Phases must include deliverables, milestones, tools, dependencies, and risks.
- Use organization documents, readiness results, and discovery responses when available.
- Tie readiness prerequisites to stated readiness dependencies.
- firstThirtyDays must be actionable for the delivery team.
- This is admin-only — include internal staffing and dependency detail.

Priority Discovery executive summary:
${args.analysis.executive_summary ?? ""}

Full analysis JSON:
${JSON.stringify(args.analysis.output_json, null, 2)}

Top projects:
${JSON.stringify(
    projects.map((project) => ({
      id: project.id,
      rank: project.rank,
      projectName: project.project_name,
      problemStatement: project.problem_statement,
      recommendedSolution: project.recommended_solution,
      shortTermImpact: project.short_term_impact,
      longTermImpact: project.long_term_impact,
      implementationRisk: project.implementation_risk,
      readinessDependency: project.readiness_dependency,
      firstStep: project.first_step,
      estimatedTimeHorizon: project.estimated_time_horizon,
      priorityScore: project.priority_score,
    })),
    null,
    2
  )}

Organization context and documents:
${JSON.stringify(
    {
      organization: input.organization,
      readinessResults: input.readinessResults,
      notes: input.notes,
      participantCount: input.participants.length,
      responseCount: input.responses.length,
    },
    null,
    2
  )}`;

  const result = await callModelRouter({
    prompt,
    taskType: "implementation_plan",
    requestedMode: input.aiProcessingMode ?? "executive",
    clientId: input.organization.id,
    systemPrompt: ROADMAP_SYSTEM_PROMPT,
    temperature: 0.2,
    maxTokens: 8000,
  });

  let raw: Record<string, unknown>;
  try {
    raw = extractJsonObject(result.response);
  } catch {
    return {
      output: {
        bundleNotes: "Generated from Priority Discovery Top 5 using fallback templates (AI parse failed).",
        roadmaps: projects.map((project) => fallbackRoadmap(project)),
      } satisfies PriorityDiscoveryRoadmapBundleOutput,
      modelUsed: result.modelUsed,
      warnings: [...result.warnings, "AI response could not be parsed; fallback roadmaps used."],
    };
  }

  const roadmapsRaw = Array.isArray(raw.roadmaps) ? raw.roadmaps : [];
  const roadmaps = projects.map((project, index) =>
    normalizeRoadmap(roadmapsRaw.find((entry) => Number((entry as { rank?: number }).rank) === project.rank) ?? roadmapsRaw[index], project)
  );

  return {
    output: {
      bundleNotes: String(raw.bundleNotes ?? "Roadmaps generated from Priority Discovery Top 5.").slice(0, 4000),
      roadmaps,
    } satisfies PriorityDiscoveryRoadmapBundleOutput,
    modelUsed: result.modelUsed,
    warnings: result.warnings,
  };
}
