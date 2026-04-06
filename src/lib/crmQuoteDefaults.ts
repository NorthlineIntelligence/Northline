import type { Organization, AssessmentProjectScope } from "@prisma/client";
import { buildScopeWorkItemsFromScopeSummary } from "@/lib/crmQuoteScopeWorkItems";
import { simplifyScopeJsonForQuote } from "@/lib/scopeReadoutSimplifier";

/** Stored on `quote_payload.scopeSummary` — compact readout + structured fields for CRM. */
export type ScopeSummaryProject = {
  name: string;
  /** Single block: deliverables, brief scope, timeline — feeds quote work items */
  summary: string;
  deliverables: string[];
  timelineLabel: string;
  costBand: string | null;
  objectivesBrief: string;
  phaseHighlights: string[];
};

export function summarizeScopeForQuote(scopeJson: unknown): {
  executiveMemo: string;
  projects: ScopeSummaryProject[];
} {
  const s = simplifyScopeJsonForQuote(scopeJson);
  return {
    executiveMemo: s.executiveBrief.slice(0, 2000),
    projects: s.projects.map((p) => ({
      name: p.name,
      summary: p.quoteBasisText,
      deliverables: p.deliverables,
      timelineLabel: p.timelineLabel,
      costBand: p.costBand,
      objectivesBrief: p.objectivesBrief,
      phaseHighlights: p.phaseHighlights,
    })),
  };
}

export function buildInitialQuotePayload(args: {
  organization: Pick<
    Organization,
    "name" | "industry" | "size" | "website" | "growth_stage" | "primary_pressures" | "context_notes"
  >;
  projectScope: Pick<AssessmentProjectScope, "scope_json" | "version"> | null;
  priceLineItems: unknown[];
}): Record<string, unknown> {
  const scopeSummary = args.projectScope
    ? summarizeScopeForQuote(args.projectScope.scope_json)
    : { executiveMemo: "", projects: [] };

  const lines = Array.isArray(args.priceLineItems) ? args.priceLineItems : [];

  const scopeWorkItems = buildScopeWorkItemsFromScopeSummary(scopeSummary);

  return {
    schemaVersion: 1,
    orgSnapshot: {
      name: args.organization.name,
      industry: args.organization.industry ?? null,
      size: args.organization.size ?? null,
      website: args.organization.website ?? null,
      growth_stage: args.organization.growth_stage ?? null,
      primary_pressures: args.organization.primary_pressures ?? null,
      context_notes: args.organization.context_notes ?? null,
    },
    projectScopeVersion: args.projectScope?.version ?? null,
    scopeSummary,
    scopeWorkItems,
    priceBookLines: lines.map((row: unknown, idx: number) => {
      const r = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      return {
        sku: String(r.sku ?? `line-${idx + 1}`),
        description: String(r.description ?? ""),
        unit: String(r.unit ?? "unit"),
        unit_price_cents:
          typeof r.unit_price_cents === "number" && Number.isFinite(r.unit_price_cents)
            ? r.unit_price_cents
            : 0,
        selected: idx < 2,
        quantity: 1,
      };
    }),
    customLines: [] as Array<{
      description: string;
      quantity: number;
      unit_price_cents: number;
    }>,
    terms:
      "Payment net 30 unless otherwise agreed. Final scope, deliverables, and fees to be confirmed in a Statement of Work following written acceptance of this quote.",
    coverNarrative: scopeSummary.executiveMemo
      ? `${scopeSummary.executiveMemo}\n\nThis quote is built from the simplified scope readout (deliverables, timelines, and investment bands are indicative until SOW).`
      : "",
  };
}
