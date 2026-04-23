import { z } from "zod";

const LineItemSchema = z.object({
  sku: z.string().min(1).max(120),
  description: z.string().max(2000),
  unit: z.string().max(80).default("unit"),
  unit_price_cents: z.number().int().min(0),
  engagement_name: z.string().max(200).optional(),
  category: z.string().max(200).optional(),
  company_tier: z.string().max(120).optional(),
  base_price_cents: z.number().int().min(0).optional(),
  min_price_cents: z.number().int().min(0).optional(),
  max_price_cents: z.number().int().min(0).optional(),
  hourly_rate_base_cents: z.number().int().min(0).optional(),
  hourly_rate_min_cents: z.number().int().min(0).optional(),
  hourly_rate_max_cents: z.number().int().min(0).optional(),
  adhoc_hourly_rate_cents: z.number().int().min(0).optional(),
  estimated_hours: z.number().min(0).optional(),
  timeline: z.string().max(120).optional(),
  project_cost_estimated_cents: z.number().int().min(0).optional(),
});

export const PRICE_BOOK_REQUIRED_HEADERS = [
  "engagement_name",
  "company_tier",
  "base_price",
  "min_price",
  "max_price",
  "hourly_rate_base",
  "hourly_rate_min",
  "hourly_rate_max",
] as const;

function normalizeLineItem(raw: unknown): z.infer<typeof LineItemSchema> | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const sku = String(o.sku ?? o.SKU ?? "").trim();
  if (!sku) return null;
  const description = String(o.description ?? o.Description ?? o.desc ?? "").trim() || sku;
  const unit = String(o.unit ?? o.Unit ?? "unit").trim() || "unit";

  let unit_price_cents: number | null = null;
  if (typeof o.unit_price_cents === "number" && Number.isFinite(o.unit_price_cents)) {
    unit_price_cents = Math.round(o.unit_price_cents);
  } else if (typeof o.unit_price === "number" && Number.isFinite(o.unit_price)) {
    unit_price_cents = Math.round(o.unit_price * 100);
  } else {
    const dollars = String(o.unit_price_dollars ?? o.price ?? o.Price ?? "").replace(/[$,]/g, "");
    const n = Number.parseFloat(dollars);
    if (Number.isFinite(n)) unit_price_cents = Math.round(n * 100);
  }
  if (unit_price_cents === null || unit_price_cents < 0) unit_price_cents = 0;

  const parsed = LineItemSchema.safeParse({
    sku,
    description,
    unit,
    unit_price_cents,
      adhoc_hourly_rate_cents:
        typeof o.adhoc_hourly_rate_cents === "number" && Number.isFinite(o.adhoc_hourly_rate_cents)
          ? Math.max(0, Math.round(o.adhoc_hourly_rate_cents))
          : typeof o.hourly_rate_adhoc_cents === "number" && Number.isFinite(o.hourly_rate_adhoc_cents)
            ? Math.max(0, Math.round(o.hourly_rate_adhoc_cents))
            : undefined,
      estimated_hours:
        typeof o.estimated_hours === "number" && Number.isFinite(o.estimated_hours)
          ? Math.max(0, o.estimated_hours)
          : undefined,
      timeline: typeof o.timeline === "string" ? o.timeline.slice(0, 120) : undefined,
  });
  return parsed.success ? parsed.data : null;
}

export function parsePriceBookJson(text: string): {
  line_items: z.infer<typeof LineItemSchema>[];
  warnings: string[];
} {
  const warnings: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { line_items: [], warnings: ["Invalid JSON"] };
  }
  const dataObj = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const arr = Array.isArray(data) ? data : dataObj?.line_items ?? dataObj?.items;
  if (!Array.isArray(arr)) {
    return { line_items: [], warnings: ["JSON must be an array of line items, or an object with line_items"] };
  }
  const line_items: z.infer<typeof LineItemSchema>[] = [];
  for (const row of arr) {
    const n = normalizeLineItem(row);
    if (n) line_items.push(n);
  }
  if (line_items.length === 0 && arr.length > 0) {
    warnings.push("No valid rows parsed from JSON (expected sku + price fields)");
  }
  return { line_items, warnings };
}

/** Minimal CSV: header row with sku, description, unit, unit_price_cents or unit_price */
export function parsePriceBookCsv(text: string): {
  line_items: z.infer<typeof LineItemSchema>[];
  warnings: string[];
  summary: {
    total_rows: number;
    parsed_rows: number;
    skipped_rows: number;
    missing_required_headers: string[];
  };
} {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return {
      line_items: [],
      warnings: ["CSV needs a header row and at least one data row"],
      summary: {
        total_rows: 0,
        parsed_rows: 0,
        skipped_rows: 0,
        missing_required_headers: [...PRICE_BOOK_REQUIRED_HEADERS],
      },
    };
  }

  const splitRow = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (c === '"') {
        q = !q;
      } else if ((c === "," && !q) || c === "\t") {
        out.push(cur.trim());
        cur = "";
      } else cur += c;
    }
    out.push(cur.trim());
    return out;
  };

  const header = splitRow(lines[0]!).map((h) => h.toLowerCase().replace(/^"|"$/g, "").trim());
  const idx = (name: string) => header.findIndex((h) => h === name || h.replace(/\s+/g, "_") === name);

  const iSku = idx("sku");
  const iEngagement = idx("engagement_name");
  const iCategory = idx("category");
  const iDesc = idx("description");
  const iTier = idx("company_tier");
  const iUnit = idx("unit");
  const iCents = idx("unit_price_cents");
  const iPrice = idx("unit_price");
  const iDollars = idx("price");
  const iBasePrice = idx("base_price");
  const iMinPrice = idx("min_price");
  const iMaxPrice = idx("max_price");
  const iHourlyBase = idx("hourly_rate_base");
  const iHourlyMin = idx("hourly_rate_min");
  const iHourlyMax = idx("hourly_rate_max");
  const iAdhocHourly = idx("adhoc_hourly_rate");
  const iEstimatedHours = idx("estimated_hours");
  const iTimeline = idx("timeline");
  const iProjectEstimated = idx("project_cost_estimated");

  if (iSku < 0 && iEngagement < 0) {
    return {
      line_items: [],
      warnings: ["CSV header must include `sku` or `engagement name` column"],
      summary: {
        total_rows: Math.max(0, lines.length - 1),
        parsed_rows: 0,
        skipped_rows: Math.max(0, lines.length - 1),
        missing_required_headers: [...PRICE_BOOK_REQUIRED_HEADERS],
      },
    };
  }

  const hasHeader = (name: string) =>
    header.some((h) => h === name || h.replace(/\s+/g, "_") === name);
  const missingRequiredHeaders = PRICE_BOOK_REQUIRED_HEADERS.filter((h) => !hasHeader(h));
  if (missingRequiredHeaders.length > 0) {
    warnings.push(
      `Missing required headers: ${missingRequiredHeaders
        .map((h) => h.replace(/_/g, " "))
        .join(", ")}`
    );
  }

  const parseMoneyToCents = (raw: string) => {
    const n = Number.parseFloat((raw ?? "").replace(/[$,]/g, ""));
    return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0;
  };

  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);

  const line_items: z.infer<typeof LineItemSchema>[] = [];
  let skipped_rows = 0;
  for (let r = 1; r < lines.length; r++) {
    const cols = splitRow(lines[r]!);
    const engagementName = iEngagement >= 0 ? (cols[iEngagement] ?? "").replace(/^"|"$/g, "").trim() : "";
    const companyTier = iTier >= 0 ? (cols[iTier] ?? "").replace(/^"|"$/g, "").trim() : "";
    const skuRaw = iSku >= 0 ? (cols[iSku] ?? "").replace(/^"|"$/g, "").trim() : "";
    const sku = skuRaw || (engagementName ? `${slug(engagementName)}${companyTier ? `-${slug(companyTier)}` : ""}` : "");
    if (!sku) {
      skipped_rows += 1;
      continue;
    }
    const description =
      iDesc >= 0
        ? (cols[iDesc] ?? "").replace(/^"|"$/g, "").trim() || engagementName || sku
        : engagementName || sku;
    const unit = iUnit >= 0 ? (cols[iUnit] ?? "").replace(/^"|"$/g, "").trim() || "project" : "project";

    let unit_price_cents = 0;
    if (iCents >= 0) {
      const n = Number.parseInt((cols[iCents] ?? "").replace(/,/g, ""), 10);
      if (Number.isFinite(n)) unit_price_cents = Math.max(0, n);
    } else if (iPrice >= 0) {
      const n = Number.parseFloat((cols[iPrice] ?? "").replace(/[$,]/g, ""));
      if (Number.isFinite(n)) unit_price_cents = Math.round(n * 100);
    } else if (iDollars >= 0) {
      const n = Number.parseFloat((cols[iDollars] ?? "").replace(/[$,]/g, ""));
      if (Number.isFinite(n)) unit_price_cents = Math.round(n * 100);
    }

    const basePriceCents = iBasePrice >= 0 ? parseMoneyToCents(cols[iBasePrice] ?? "") : undefined;
    const minPriceCents = iMinPrice >= 0 ? parseMoneyToCents(cols[iMinPrice] ?? "") : undefined;
    const maxPriceCents = iMaxPrice >= 0 ? parseMoneyToCents(cols[iMaxPrice] ?? "") : undefined;
    const hourlyRateBaseCents = iHourlyBase >= 0 ? parseMoneyToCents(cols[iHourlyBase] ?? "") : undefined;
    const hourlyRateMinCents = iHourlyMin >= 0 ? parseMoneyToCents(cols[iHourlyMin] ?? "") : undefined;
    const hourlyRateMaxCents = iHourlyMax >= 0 ? parseMoneyToCents(cols[iHourlyMax] ?? "") : undefined;
    const adhocHourlyRateCents = iAdhocHourly >= 0 ? parseMoneyToCents(cols[iAdhocHourly] ?? "") : undefined;
    const estimatedHoursRaw = iEstimatedHours >= 0 ? Number.parseFloat((cols[iEstimatedHours] ?? "").replace(/,/g, "")) : NaN;
    const estimatedHours = Number.isFinite(estimatedHoursRaw) ? Math.max(0, estimatedHoursRaw) : undefined;
    const timeline = iTimeline >= 0 ? (cols[iTimeline] ?? "").replace(/^"|"$/g, "").trim() : undefined;
    const projectEstimatedCents = iProjectEstimated >= 0 ? parseMoneyToCents(cols[iProjectEstimated] ?? "") : undefined;

    const parsed = LineItemSchema.safeParse({
      sku,
      description,
      unit,
      unit_price_cents:
        unit_price_cents ||
        basePriceCents ||
        hourlyRateBaseCents ||
        projectEstimatedCents ||
        0,
      engagement_name: engagementName || undefined,
      category: iCategory >= 0 ? (cols[iCategory] ?? "").replace(/^"|"$/g, "").trim() || undefined : undefined,
      company_tier: companyTier || undefined,
      base_price_cents: basePriceCents,
      min_price_cents: minPriceCents,
      max_price_cents: maxPriceCents,
      hourly_rate_base_cents: hourlyRateBaseCents,
      hourly_rate_min_cents: hourlyRateMinCents,
      hourly_rate_max_cents: hourlyRateMaxCents,
      adhoc_hourly_rate_cents: adhocHourlyRateCents,
      estimated_hours: estimatedHours,
      timeline: timeline || undefined,
      project_cost_estimated_cents: projectEstimatedCents,
    });
    if (parsed.success) line_items.push(parsed.data);
    else skipped_rows += 1;
  }

  if (line_items.length === 0) warnings.push("No data rows parsed from CSV");
  return {
    line_items,
    warnings,
    summary: {
      total_rows: Math.max(0, lines.length - 1),
      parsed_rows: line_items.length,
      skipped_rows,
      missing_required_headers: missingRequiredHeaders,
    },
  };
}

export function parsePriceBookFile(
  buf: Buffer,
  filename: string,
  mimeType: string
): {
  line_items: z.infer<typeof LineItemSchema>[];
  warnings: string[];
  summary?: {
    total_rows: number;
    parsed_rows: number;
    skipped_rows: number;
    missing_required_headers: string[];
  };
} {
  const lower = filename.toLowerCase();
  const mime = (mimeType || "").toLowerCase();

  if (lower.endsWith(".json") || mime.includes("json")) {
    const parsed = parsePriceBookJson(buf.toString("utf8"));
    return {
      ...parsed,
      summary: {
        total_rows: parsed.line_items.length,
        parsed_rows: parsed.line_items.length,
        skipped_rows: 0,
        missing_required_headers: [],
      },
    };
  }

  if (lower.endsWith(".csv") || mime === "text/csv" || mime === "application/csv") {
    return parsePriceBookCsv(buf.toString("utf8"));
  }

  if (
    mime === "text/plain" &&
    (lower.endsWith(".csv") || buf.toString("utf8", 0, Math.min(4096, buf.length)).includes(","))
  ) {
    return parsePriceBookCsv(buf.toString("utf8"));
  }

  return {
    line_items: [],
    warnings: [
      "File stored in Supabase; line items not auto-imported for this type. Use .json or .csv for import, or paste JSON below.",
    ],
      summary: {
        total_rows: 0,
        parsed_rows: 0,
        skipped_rows: 0,
        missing_required_headers: [...PRICE_BOOK_REQUIRED_HEADERS],
      },
  };
}

export function safeStorageFileName(name: string): string {
  const base = (name ?? "price-book").split(/[/\\]/).pop() || "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 160);
  return cleaned || "file";
}
