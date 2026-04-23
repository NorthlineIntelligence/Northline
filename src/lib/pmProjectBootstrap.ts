import type { CrmQuote } from "@prisma/client";

type ScopeSummaryProject = {
  name?: string;
  timelineLabel?: string;
  summary?: string;
  objectivesBrief?: string;
  quoteBasisText?: string;
  scopeSummary?: string;
  scope_summary?: string;
  objectives_brief?: string;
  costBand?: string | null;
  deliverables?: string[];
  deliverablesText?: string;
  whatWeWillDeliver?: string[] | string;
  what_we_will_deliver?: string[] | string;
  projectedTools?: string[];
  projectedToolsText?: string;
  recommendedTools?: string[] | string;
  recommended_tools?: string[] | string;
  projected_tools?: string[] | string;
  toolsText?: string;
  tools?: string[];
  phaseHighlights?: string[];
  priority?: number | null;
};

function composeStructuredScopeSummary(args: {
  summary?: string;
  deliverables?: string[] | string;
  projectedTools?: string[] | string;
}) {
  const summary = (args.summary ?? "").trim();
  const toList = (value: string[] | string | undefined) => {
    if (Array.isArray(value)) return value.map((d) => d.trim()).filter(Boolean);
    if (typeof value === "string") {
      return value
        .split("\n")
        .map((d) => d.trim())
        .filter(Boolean);
    }
    return [];
  };
  const deliverables = toList(args.deliverables);
  const projectedTools = toList(args.projectedTools);
  const sections: string[] = [];
  if (summary) sections.push(`Scope Summary:\n${summary}`);
  if (deliverables.length) sections.push(`What we will deliver:\n${deliverables.map((d) => `- ${d}`).join("\n")}`);
  if (projectedTools.length) sections.push(`Projected Tools:\n${projectedTools.map((d) => `- ${d}`).join("\n")}`);
  return sections.join("\n\n").trim() || null;
}

function sortProjectsForPm(projects: ScopeSummaryProject[]) {
  return [...projects]
    .map((p, index) => ({ p, index }))
    .sort((a, b) => {
      const aPriority = Number.isFinite(Number(a.p.priority)) ? Number(a.p.priority) : Number.POSITIVE_INFINITY;
      const bPriority = Number.isFinite(Number(b.p.priority)) ? Number(b.p.priority) : Number.POSITIVE_INFINITY;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return a.index - b.index;
    })
    .map((x) => x.p);
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((d) => String(d ?? "").trim()).filter(Boolean);
  if (typeof value === "string") return value.split("\n").map((d) => d.trim()).filter(Boolean);
  return [];
}

function normalizeScopeProject(raw: unknown): ScopeSummaryProject {
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    name: typeof p.name === "string" ? p.name : undefined,
    timelineLabel: typeof p.timelineLabel === "string" ? p.timelineLabel : undefined,
    summary: typeof p.summary === "string" ? p.summary : undefined,
    objectivesBrief: typeof p.objectivesBrief === "string" ? p.objectivesBrief : undefined,
    quoteBasisText: typeof p.quoteBasisText === "string" ? p.quoteBasisText : undefined,
    scopeSummary: typeof p.scopeSummary === "string" ? p.scopeSummary : undefined,
    scope_summary: typeof p.scope_summary === "string" ? p.scope_summary : undefined,
    objectives_brief: typeof p.objectives_brief === "string" ? p.objectives_brief : undefined,
    costBand: typeof p.costBand === "string" ? p.costBand : p.costBand == null ? null : undefined,
    deliverables: toStringList(p.deliverables),
    deliverablesText: typeof p.deliverablesText === "string" ? p.deliverablesText : undefined,
    whatWeWillDeliver: toStringList(p.whatWeWillDeliver),
    what_we_will_deliver: toStringList(p.what_we_will_deliver),
    projectedTools: toStringList(p.projectedTools),
    projectedToolsText: typeof p.projectedToolsText === "string" ? p.projectedToolsText : undefined,
    recommendedTools: toStringList(p.recommendedTools),
    recommended_tools: toStringList(p.recommended_tools),
    projected_tools: toStringList(p.projected_tools),
    toolsText: typeof p.toolsText === "string" ? p.toolsText : undefined,
    tools: toStringList(p.tools),
    phaseHighlights: toStringList(p.phaseHighlights),
    priority: typeof p.priority === "number" ? p.priority : null,
  };
}

function clampPct(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function addDays(base: Date, days: number) {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function estimateDaysFromTimelineLabel(label: string | null | undefined): number {
  const s = (label ?? "").toLowerCase();
  if (!s) return 14;
  const m = s.match(/(\d+)\s*(day|days|week|weeks|month|months)/i);
  if (!m) return 14;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (!Number.isFinite(n) || n <= 0) return 14;
  if (unit.startsWith("day")) return n;
  if (unit.startsWith("week")) return n * 7;
  return n * 30;
}

function parseTimelineLabel(label: string | null | undefined): { value: number; unit: string } {
  const s = (label ?? "").toLowerCase();
  const m = s.match(/(\d+(?:\.\d+)?)\s*(hour|hours|day|days|week|weeks|month|months)/i);
  if (!m) return { value: 2, unit: "weeks" };
  const value = Number(m[1]);
  const unit = m[2].toLowerCase();
  return { value: Number.isFinite(value) && value > 0 ? value : 2, unit };
}

export function buildProjectFromQuote(args: {
  quote: CrmQuote;
  fallbackTitle: string;
}): {
  title: string;
  targetStartAt: Date;
  targetEndAt: Date;
  sprints: Array<{
    sprint_number: number;
    title: string;
    stage_label: string;
    cost_band: string | null;
    scope_summary: string | null;
    estimated_duration_value: number;
    estimated_duration_unit: string;
    estimated_completion_date: Date;
    target_start_at: Date;
    target_end_at: Date;
    completion_pct: number;
  }>;
} {
  const payload =
    args.quote.quote_payload && typeof args.quote.quote_payload === "object"
      ? (args.quote.quote_payload as Record<string, unknown>)
      : {};

  const scopeSummary =
    payload.scopeSummary && typeof payload.scopeSummary === "object"
      ? (payload.scopeSummary as Record<string, unknown>)
      : {};
  const projectsLocked = payload.scopeProjectsLocked === true;
  const projects = Array.isArray(scopeSummary.projects)
    ? scopeSummary.projects.map((p) => normalizeScopeProject(p))
    : [];

  const now = new Date();
  const title =
    (typeof payload.coverNarrative === "string" && payload.coverNarrative.trim()
      ? payload.coverNarrative.trim().slice(0, 80)
      : null) ??
    args.fallbackTitle;

  let cursor = now;
  const sourceProjects =
    projectsLocked && projects.length
      ? sortProjectsForPm(projects)
      : [{ name: "Discovery & delivery", timelineLabel: "2 weeks" }];

  const sprints = sourceProjects.map(
    (p, idx) => {
      const days = estimateDaysFromTimelineLabel(p.timelineLabel);
      const timeline = parseTimelineLabel(p.timelineLabel);
      const start = cursor;
      const end = addDays(start, days);
      cursor = end;
      const checklist = [
        ...toStringList(p.deliverables),
        ...toStringList(p.deliverablesText),
        ...toStringList(p.whatWeWillDeliver),
        ...toStringList(p.what_we_will_deliver),
      ];
      const projectedTools = Array.isArray(p.projectedTools)
        ? p.projectedTools
        : typeof p.projectedToolsText === "string"
          ? p.projectedToolsText
              .split("\n")
              .map((d) => d.trim())
              .filter(Boolean)
          : Array.isArray(p.recommendedTools)
            ? p.recommendedTools
            : Array.isArray(p.recommended_tools)
              ? p.recommended_tools
          : Array.isArray(p.projected_tools)
            ? p.projected_tools
            : typeof p.toolsText === "string"
              ? p.toolsText
                  .split("\n")
                  .map((d) => d.trim())
                  .filter(Boolean)
          : Array.isArray(p.tools)
            ? p.tools
            : [];
      const summaryText =
        p.summary ||
        p.scopeSummary ||
        p.scope_summary ||
        p.objectivesBrief ||
        p.objectives_brief ||
        p.quoteBasisText ||
        (Array.isArray(p.phaseHighlights) ? p.phaseHighlights.join("\n") : "");
      const mergedSummary = composeStructuredScopeSummary({
        summary: summaryText,
        deliverables: checklist,
        projectedTools,
      });
      return {
        sprint_number: idx + 1,
        title: (p.name?.trim() || `Project scope ${idx + 1}`).slice(0, 200),
        stage_label: checklist.length ? checklist[0].slice(0, 120) : `Project scope ${idx + 1}`,
        cost_band: p.costBand?.trim() || null,
        scope_summary: mergedSummary || null,
        estimated_duration_value: timeline.value,
        estimated_duration_unit: timeline.unit,
        estimated_completion_date: end,
        target_start_at: start,
        target_end_at: end,
        completion_pct: clampPct(0),
      };
    }
  );

  const targetStartAt = sprints[0]?.target_start_at ?? now;
  const targetEndAt = sprints[sprints.length - 1]?.target_end_at ?? addDays(now, 14);

  return {
    title: title || args.fallbackTitle,
    targetStartAt,
    targetEndAt,
    sprints,
  };
}

