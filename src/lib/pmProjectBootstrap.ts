import type { CrmQuote } from "@prisma/client";

type ScopeSummaryProject = {
  name?: string;
  timelineLabel?: string;
  summary?: string;
};

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
  const projects = Array.isArray(scopeSummary.projects)
    ? (scopeSummary.projects as ScopeSummaryProject[])
    : [];

  const now = new Date();
  const title =
    (typeof payload.coverNarrative === "string" && payload.coverNarrative.trim()
      ? payload.coverNarrative.trim().slice(0, 80)
      : null) ??
    args.fallbackTitle;

  let cursor = now;
  const sprints = (projects.length ? projects : [{ name: "Discovery & delivery", timelineLabel: "2 weeks" }]).map(
    (p, idx) => {
      const days = estimateDaysFromTimelineLabel(p.timelineLabel);
      const start = cursor;
      const end = addDays(start, days);
      cursor = end;
      return {
        sprint_number: idx + 1,
        title: (p.name?.trim() || `Sprint ${idx + 1}`).slice(0, 200),
        stage_label: `Sprint ${idx + 1}`,
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

