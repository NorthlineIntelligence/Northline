import type { Organization, AssessmentProjectScope } from "@prisma/client";
import { buildScopeWorkItemsFromScopeSummary } from "@/lib/crmQuoteScopeWorkItems";

type ScopeJson = {
  projects?: Array<{
    name?: string;
    scopeOfWork?: string;
    objectives?: string;
    costEstimate?: string;
    readiness?: { executiveMemo?: string };
  }>;
  readiness?: { executiveMemo?: string };
};

export function summarizeScopeForQuote(scopeJson: unknown): {
  executiveMemo: string;
  projects: Array<{ name: string; summary: string }>;
} {
  const doc = (scopeJson && typeof scopeJson === "object" ? scopeJson : {}) as ScopeJson;
  const projects = Array.isArray(doc.projects) ? doc.projects : [];
  const executiveMemo =
    typeof doc.readiness?.executiveMemo === "string" ? doc.readiness.executiveMemo.trim() : "";

  return {
    executiveMemo: executiveMemo.slice(0, 8000),
    projects: projects.map((p, i) => ({
      name: typeof p?.name === "string" && p.name.trim() ? p.name.trim() : `Initiative ${i + 1}`,
      summary: [
        typeof p?.scopeOfWork === "string" ? p.scopeOfWork : "",
        typeof p?.objectives === "string" ? p.objectives : "",
        typeof p?.costEstimate === "string" ? `Estimate band: ${p.costEstimate}` : "",
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 4000),
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
    coverNarrative: "",
  };
}
