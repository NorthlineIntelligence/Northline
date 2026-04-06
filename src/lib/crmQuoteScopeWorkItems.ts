/** Actionable line items derived from project scope, mapped to price book SKUs for quoting. */
export type ScopeWorkItemKind = "PILOT" | "ASSESSMENT_ONLY" | "ALACARTE" | "CUSTOM";

export type ScopeWorkItem = {
  id: string;
  /** Index into scopeSummary.projects when auto-generated; null for manual rows */
  sourceProjectIndex: number | null;
  title: string;
  detail: string;
  kind: ScopeWorkItemKind;
  /** For hourly price lines, feeds quantity when applying to quote */
  estimatedHours: number | null;
  /** For non-hourly SKUs, quantity to bill */
  billQuantity: number;
  linkedSku: string | null;
  notes: string;
};

const KINDS: ScopeWorkItemKind[] = ["PILOT", "ASSESSMENT_ONLY", "ALACARTE", "CUSTOM"];

function newId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `sw-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function normalizeScopeWorkItem(raw: unknown, fallbackIndex: number): ScopeWorkItem {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const kindRaw = String(r.kind ?? "CUSTOM").toUpperCase();
  const kind = (KINDS.includes(kindRaw as ScopeWorkItemKind) ? kindRaw : "CUSTOM") as ScopeWorkItemKind;
  const hoursRaw = r.estimatedHours;
  const hours =
    typeof hoursRaw === "number" && Number.isFinite(hoursRaw) && hoursRaw >= 0 ? hoursRaw : null;
  const billQ = r.billQuantity;
  const billQuantity =
    typeof billQ === "number" && Number.isFinite(billQ) && billQ > 0 ? Math.round(billQ) : 1;
  const spi = r.sourceProjectIndex;
  const sourceProjectIndex =
    typeof spi === "number" && Number.isInteger(spi) && spi >= 0 ? spi : null;
  const id = typeof r.id === "string" && r.id.length > 0 ? r.id : newId();
  return {
    id,
    sourceProjectIndex,
    title: String(r.title ?? `Work item ${fallbackIndex + 1}`).slice(0, 500),
    detail: String(r.detail ?? "").slice(0, 4000),
    kind,
    estimatedHours: hours,
    billQuantity,
    linkedSku: r.linkedSku === null || r.linkedSku === undefined || r.linkedSku === "" ? null : String(r.linkedSku),
    notes: String(r.notes ?? "").slice(0, 2000),
  };
}

export type ScopeSummaryForWorkItems = {
  projects?: Array<{ name?: string; summary?: string }>;
};

export function buildScopeWorkItemsFromScopeSummary(summary: ScopeSummaryForWorkItems): ScopeWorkItem[] {
  const projects = Array.isArray(summary.projects) ? summary.projects : [];
  const items: ScopeWorkItem[] = [];

  projects.forEach((p, i) => {
    const name =
      typeof p?.name === "string" && p.name.trim() ? p.name.trim() : `Initiative ${i + 1}`;
    const detail = typeof p?.summary === "string" ? p.summary.trim() : "";
    items.push({
      id: newId(),
      sourceProjectIndex: i,
      title: name,
      detail: detail.slice(0, 4000),
      kind: "PILOT",
      estimatedHours: null,
      billQuantity: 1,
      linkedSku: null,
      notes: "",
    });
  });

  items.push({
    id: newId(),
    sourceProjectIndex: null,
    title: "Assessment-only package",
    detail:
      "Readiness assessment and reporting without an implementation statement of work. Adjust linked SKU to match your catalog (e.g. assessment sprint).",
    kind: "ASSESSMENT_ONLY",
    estimatedHours: null,
    billQuantity: 1,
    linkedSku: null,
    notes: "",
  });

  items.push({
    id: newId(),
    sourceProjectIndex: null,
    title: "À la carte / add-on",
    detail:
      "Optional scopes or change requests outside the main pilots. Duplicate this row as needed or add more in the table.",
    kind: "ALACARTE",
    estimatedHours: null,
    billQuantity: 1,
    linkedSku: null,
    notes: "",
  });

  return items;
}

export function parseScopeWorkItemsFromPayload(payload: Record<string, unknown>): ScopeWorkItem[] {
  const raw = payload.scopeWorkItems;
  if (!Array.isArray(raw)) return [];
  return raw.map((row, i) => normalizeScopeWorkItem(row, i));
}

/** Merge scope work items into payload (replace list). */
export function withScopeWorkItems(
  payload: Record<string, unknown>,
  items: ScopeWorkItem[]
): Record<string, unknown> {
  return { ...payload, scopeWorkItems: items };
}

/**
 * For each work item with a linked SKU: mark that price book line selected and set quantity from
 * estimated hours (hourly units) or billQuantity.
 */
export function applyScopeWorkItemsToPriceLines(payload: Record<string, unknown>): Record<string, unknown> {
  const lines = [
    ...(Array.isArray(payload.priceBookLines) ? payload.priceBookLines : []),
  ] as Record<string, unknown>[];
  const items = parseScopeWorkItemsFromPayload(payload);

  for (const item of items) {
    if (!item.linkedSku) continue;
    const idx = lines.findIndex((row) => String(row?.sku ?? "") === item.linkedSku);
    if (idx < 0) continue;
    const row = lines[idx];
    const unit = String(row?.unit ?? "").toLowerCase();
    const isHourly = unit.includes("hour") || unit === "hr" || unit === "hrs";
    const qty =
      isHourly && item.estimatedHours != null && item.estimatedHours > 0
        ? Math.max(1, Math.round(item.estimatedHours))
        : Math.max(1, item.billQuantity ?? 1);
    lines[idx] = { ...row, selected: true, quantity: qty };
  }

  return { ...payload, priceBookLines: lines };
}
