import { z } from "zod";

const LineItemSchema = z.object({
  sku: z.string().min(1).max(120),
  description: z.string().max(2000),
  unit: z.string().max(80).default("unit"),
  unit_price_cents: z.number().int().min(0),
});

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
  const arr = Array.isArray(data) ? data : (data as any)?.line_items ?? (data as any)?.items;
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
} {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { line_items: [], warnings: ["CSV needs a header row and at least one data row"] };
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
  const iDesc = idx("description");
  const iUnit = idx("unit");
  const iCents = idx("unit_price_cents");
  const iPrice = idx("unit_price");
  const iDollars = idx("price");

  if (iSku < 0) {
    return { line_items: [], warnings: ["CSV header must include a sku column"] };
  }

  const line_items: z.infer<typeof LineItemSchema>[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = splitRow(lines[r]!);
    const sku = (cols[iSku] ?? "").replace(/^"|"$/g, "").trim();
    if (!sku) continue;
    const description = iDesc >= 0 ? (cols[iDesc] ?? "").replace(/^"|"$/g, "").trim() || sku : sku;
    const unit = iUnit >= 0 ? (cols[iUnit] ?? "").replace(/^"|"$/g, "").trim() || "unit" : "unit";

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

    const parsed = LineItemSchema.safeParse({
      sku,
      description,
      unit,
      unit_price_cents,
    });
    if (parsed.success) line_items.push(parsed.data);
  }

  if (line_items.length === 0) warnings.push("No data rows parsed from CSV");
  return { line_items, warnings };
}

export function parsePriceBookFile(
  buf: Buffer,
  filename: string,
  mimeType: string
): { line_items: z.infer<typeof LineItemSchema>[]; warnings: string[] } {
  const lower = filename.toLowerCase();
  const mime = (mimeType || "").toLowerCase();

  if (lower.endsWith(".json") || mime.includes("json")) {
    return parsePriceBookJson(buf.toString("utf8"));
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
  };
}

export function safeStorageFileName(name: string): string {
  const base = (name ?? "price-book").split(/[/\\]/).pop() || "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 160);
  return cleaned || "file";
}
