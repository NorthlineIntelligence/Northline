import PDFDocument from "pdfkit/js/pdfkit.standalone.js";
import type { CrmQuote, Organization, OrgContact } from "@prisma/client";
import { quoteTotalCentsFromPayload } from "@/lib/crmQuoteTotals";
import { parseScopeWorkItemsFromPayload } from "@/lib/crmQuoteScopeWorkItems";

function fmtMoney(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function fmtDateUS(value: Date | string | null | undefined) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(d);
}

function fmtDateTimeUS(value: Date | string | null | undefined) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function kindLabel(k: string): string {
  const m: Record<string, string> = {
    PILOT: "Pilot / implementation",
    ASSESSMENT_ONLY: "Assessment only",
    ALACARTE: "À la carte",
    CUSTOM: "Custom",
  };
  return m[k] ?? k;
}

type ClientQuoteProject = {
  name: string;
  timelineLabel: string;
  summary: string;
  outcomes: string[];
  priority: number;
};

function parseClientQuoteProjects(payload: Record<string, unknown>): ClientQuoteProject[] {
  const scopeSummary =
    payload.scopeSummary && typeof payload.scopeSummary === "object"
      ? (payload.scopeSummary as {
          projects?: Array<{
            name?: string;
            summary?: string;
            deliverables?: string[];
            objectivesBrief?: string;
            timelineLabel?: string;
            priority?: number | null;
          }>;
        })
      : null;
  const projects = Array.isArray(scopeSummary?.projects) ? scopeSummary.projects : [];
  return projects
    .map((p, idx) => {
      const outcomes: string[] = [];
      if (Array.isArray(p.deliverables)) {
        outcomes.push(...p.deliverables.map((v) => String(v ?? "").trim()).filter(Boolean));
      }
      if (typeof p.objectivesBrief === "string" && p.objectivesBrief.trim()) {
        outcomes.push(p.objectivesBrief.trim());
      }
      return {
        name: String(p.name ?? "").trim() || `Project ${idx + 1}`,
        timelineLabel: String(p.timelineLabel ?? "").trim() || "TBD",
        summary: String(p.summary ?? "").trim(),
        outcomes,
        priority: typeof p.priority === "number" && Number.isFinite(p.priority) ? p.priority : idx + 1,
      };
    })
    .sort((a, b) => a.priority - b.priority);
}

export async function renderQuotePdfBuffer(args: {
  quote: CrmQuote;
  organization: Organization;
  signee: OrgContact | null;
  billing: OrgContact | null;
  logoDataUrl?: string | null;
}): Promise<Buffer> {
  const { quote, organization, signee, billing, logoDataUrl } = args;
  const payload = (quote.quote_payload ?? {}) as Record<string, unknown>;
  const orgSnap = payload.orgSnapshot && typeof payload.orgSnapshot === "object" ? payload.orgSnapshot : {};
  const snap = orgSnap as Record<string, unknown>;
  const clientName =
    (typeof snap.name === "string" && snap.name.trim() ? snap.name : null) ?? organization.name;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56, size: "LETTER" });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;

    let headerY = 56;
    if (logoDataUrl && /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(logoDataUrl)) {
      try {
        const base64 = logoDataUrl.split(",", 2)[1] ?? "";
        const imageBuffer = Buffer.from(base64, "base64");
        doc.image(imageBuffer, left, headerY, { fit: [180, 48] });
        headerY += 54;
      } catch {
        // Fall through to text header if image parsing fails.
      }
    }
    doc.fontSize(18).fillColor("#173464").text("Northline — client quote", left, headerY, {
      width: pageWidth,
    });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor("#333333").text(`Prepared for: ${clientName}`, {
      width: pageWidth,
    });
    doc.text(`Quote ID: ${quote.id}`, { width: pageWidth });
    doc.text(`Generated: ${fmtDateTimeUS(new Date())}`, { width: pageWidth });
    if (quote.valid_until) {
      doc.text(`Valid until: ${fmtDateUS(quote.valid_until)}`, { width: pageWidth });
    }
    doc.moveDown();

    if (signee || billing) {
      doc.fontSize(10).fillColor("#173464").text("Contacts", { underline: true });
      doc.fillColor("#333333");
      if (signee) {
        doc.fontSize(10).text(`Signatory: ${signee.name}${signee.title ? `, ${signee.title}` : ""}${signee.email ? ` · ${signee.email}` : ""}`);
      }
      if (billing) {
        doc.text(`Billing / POC: ${billing.name}${billing.title ? `, ${billing.title}` : ""}${billing.email ? ` · ${billing.email}` : ""}`);
      }
      doc.moveDown();
    }

    const cover = String(payload.coverNarrative ?? "").trim();
    if (cover) {
      doc.fontSize(11).fillColor("#173464").text("Summary", { underline: true });
      doc.fillColor("#333333").fontSize(10).text(cover, { width: pageWidth, align: "left" });
      doc.moveDown();
    }

    const workItems = parseScopeWorkItemsFromPayload(payload);
    if (workItems.length > 0) {
      doc.fontSize(11).fillColor("#173464").text("Scope → actionable items", { underline: true });
      doc.fillColor("#333333").fontSize(9);
      workItems.forEach((w, i) => {
        if (doc.y > doc.page.height - 120) doc.addPage();
        doc.fontSize(9).text(`${i + 1}. ${w.title}`, { continued: false });
        doc.fontSize(8).fillColor("#555555").text(`   Type: ${kindLabel(w.kind)}`, { width: pageWidth });
        if (w.estimatedHours != null) doc.text(`   Est. hours: ${w.estimatedHours}`, { width: pageWidth });
        if (w.linkedSku) doc.text(`   Mapped SKU: ${w.linkedSku}`, { width: pageWidth });
        if (w.detail) {
          doc.text(`   ${w.detail.slice(0, 400)}${w.detail.length > 400 ? "…" : ""}`, {
            width: pageWidth - 12,
          });
        }
        doc.fillColor("#333333").moveDown(0.3);
      });
      doc.moveDown();
    }

    doc.fontSize(11).fillColor("#173464").text("Pricing", { underline: true });
    doc.fillColor("#333333").fontSize(9);

    const lines = Array.isArray(payload.priceBookLines) ? payload.priceBookLines : [];
    for (const row of lines) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      if (r.selected !== true) continue;
      if (doc.y > doc.page.height - 72) doc.addPage();
      const qty = typeof r.quantity === "number" && r.quantity > 0 ? r.quantity : 1;
      const unit =
        typeof r.unit_price_cents === "number" && Number.isFinite(r.unit_price_cents)
          ? r.unit_price_cents
          : 0;
      const ext = Math.round(qty * unit);
      const desc = String(r.description ?? "").slice(0, 140);
      doc.fontSize(9).text(
        `${String(r.sku ?? "")} — ${desc}\n   Qty ${qty} × ${fmtMoney(unit)} = ${fmtMoney(ext)}`,
        { width: pageWidth }
      );
      doc.moveDown(0.3);
    }

    const customs = Array.isArray(payload.customLines) ? payload.customLines : [];
    for (const row of customs) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      if (doc.y > doc.page.height - 72) doc.addPage();
      const qty = typeof r.quantity === "number" && r.quantity > 0 ? r.quantity : 0;
      const unit =
        typeof r.unit_price_cents === "number" && Number.isFinite(r.unit_price_cents)
          ? r.unit_price_cents
          : 0;
      const ext = Math.round(qty * unit);
      const desc = String(r.description ?? "").slice(0, 140);
      doc.fontSize(9).text(`Custom — ${desc}\n   Qty ${qty} × ${fmtMoney(unit)} = ${fmtMoney(ext)}`, {
        width: pageWidth,
      });
      doc.moveDown(0.3);
    }

    doc.moveDown(0.5);
    const total = quote.total_cents ?? quoteTotalCentsFromPayload(payload);
    doc.fontSize(11).fillColor("#173464").text(`Total: ${fmtMoney(total)}`, left, doc.y, { width: pageWidth });

    const terms = String(payload.terms ?? "").trim();
    const paymentTerms = String(payload.paymentTerms ?? "").trim();
    if (paymentTerms) {
      doc.moveDown(0.9);
      if (doc.y > doc.page.height - 90) doc.addPage();
      doc.fontSize(10).fillColor("#173464").text("Payment terms", { underline: true });
      doc.fillColor("#333333").fontSize(9).text(paymentTerms, { width: pageWidth });
    }
    if (terms) {
      doc.moveDown(1.2);
      if (doc.y > doc.page.height - 100) doc.addPage();
      doc.fontSize(10).fillColor("#173464").text("Terms & conditions", { underline: true });
      doc.fillColor("#333333").fontSize(9).text(terms, { width: pageWidth });
    }

    doc.moveDown(1.5);
    if (doc.y > doc.page.height - 72) doc.addPage();
    doc.fontSize(8).fillColor("#66819e").text(
      "E-signature: DocuSign integration is not configured yet. This PDF is for review; executed agreements will use a separate workflow.",
      { width: pageWidth, align: "left" }
    );

    doc.end();
  });
}

export async function renderClientQuotePdfBuffer(args: {
  quote: CrmQuote;
  organization: Organization;
  logoDataUrl?: string | null;
}): Promise<Buffer> {
  const { quote, organization, logoDataUrl } = args;
  const payload = (quote.quote_payload ?? {}) as Record<string, unknown>;
  const projects = parseClientQuoteProjects(payload);
  const paymentTerms = String(payload.paymentTerms ?? "").trim();
  const terms = String(payload.terms ?? "").trim();
  const total = quote.total_cents ?? quoteTotalCentsFromPayload(payload);
  const overallDiscountPct =
    typeof payload.quoteDiscountPct === "number" && Number.isFinite(payload.quoteDiscountPct)
      ? Math.max(0, Math.min(100, payload.quoteDiscountPct))
      : 0;
  const customLines = Array.isArray(payload.customLines) ? payload.customLines : [];
  const preOverallTotalCents = customLines.reduce((sum, row) => {
    if (!row || typeof row !== "object") return sum;
    const r = row as Record<string, unknown>;
    const qty = typeof r.quantity === "number" && Number.isFinite(r.quantity) ? r.quantity : 0;
    const unit = typeof r.unit_price_cents === "number" && Number.isFinite(r.unit_price_cents) ? r.unit_price_cents : 0;
    return sum + Math.max(0, Math.round(qty * unit));
  }, 0);
  const discountAmount = Math.max(0, preOverallTotalCents - total);
  const lineRows = customLines
    .map((row, i) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const description = String(r.description ?? "").trim() || `Line ${i + 1}`;
      const quantity = typeof r.quantity === "number" && Number.isFinite(r.quantity) ? Math.max(0, r.quantity) : 0;
      const unit = typeof r.unit_price_cents === "number" && Number.isFinite(r.unit_price_cents) ? Math.max(0, r.unit_price_cents) : 0;
      const ext = Math.round(quantity * unit);
      return { description, quantity, unit, ext };
    })
    .filter((v): v is { description: string; quantity: number; unit: number; ext: number } => v !== null);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56, size: "LETTER" });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;
    const right = left + pageWidth;

    let headerY = 56;
    if (logoDataUrl && /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(logoDataUrl)) {
      try {
        const imageBuffer = Buffer.from(logoDataUrl.split(",", 2)[1] ?? "", "base64");
        doc.image(imageBuffer, left, headerY, { fit: [180, 48] });
        headerY += 54;
      } catch {}
    }

    doc.fillColor("#173464");
    doc.fontSize(20).text("SALES QUOTATION", left, headerY, { width: pageWidth });
    doc.fillColor("#333333");
    const headerMetaY = headerY + 28;
    doc.fontSize(9).text(`Quotation Number: ${quote.id.slice(0, 8)}`, left, headerMetaY);
    doc.text(`Date: ${fmtDateUS(quote.created_at)}`, left, headerMetaY + 12);
    doc.text(
      `Valid Until: ${quote.valid_until ? fmtDateUS(quote.valid_until) : "—"}`,
      left,
      headerMetaY + 24
    );

    const blockTop = headerMetaY + 52;
    const colWidth = (pageWidth - 16) / 2;
    doc.fontSize(9).fillColor("#173464").text("From:", left, blockTop);
    doc.fillColor("#333333").text(organization.name, left, blockTop + 12, { width: colWidth });
    doc.text(organization.legal_address || "—", left, blockTop + 24, { width: colWidth });
    doc.text(
      `Email: ${organization.primary_contact_email || organization.billing_email || "—"}`,
      left,
      blockTop + 48,
      { width: colWidth }
    );
    doc.text(`Phone: ${organization.primary_contact_phone || "—"}`, left, blockTop + 60, { width: colWidth });

    doc.fontSize(9).fillColor("#173464").text("To:", left + colWidth + 16, blockTop);
    doc.fillColor("#333333").text(organization.legal_name || organization.name, left + colWidth + 16, blockTop + 12, {
      width: colWidth,
    });
    doc.text(organization.legal_address || "—", left + colWidth + 16, blockTop + 24, { width: colWidth });
    doc.text(
      `Primary Contact: ${organization.primary_contact_name || "—"}`,
      left + colWidth + 16,
      blockTop + 48,
      { width: colWidth }
    );
    doc.text(
      `Title: ${organization.primary_contact_title || "—"}`,
      left + colWidth + 16,
      blockTop + 60,
      { width: colWidth }
    );

    doc.y = blockTop + 90;
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#173464").text("ITEMIZED QUOTATION DETAILS", { align: "center" });
    doc.moveDown(0.4);

    const tableLeft = left;
    const tableTop = doc.y;
    const widths = [pageWidth * 0.46, pageWidth * 0.14, pageWidth * 0.18, pageWidth * 0.22];
    const headers = ["Item Description", "Quantity", "Unit Price", "Total Price"];
    const rowH = 22;
    let x = tableLeft;
    doc.fontSize(8).fillColor("#ffffff");
    for (let i = 0; i < headers.length; i += 1) {
      doc.rect(x, tableTop, widths[i], rowH).fillAndStroke("#173464", "#173464");
      doc.fillColor("#ffffff").text(headers[i], x + 4, tableTop + 7, { width: widths[i] - 8, align: "center" });
      x += widths[i];
    }

    let y = tableTop + rowH;
    doc.fillColor("#333333");
    const rowsToRender = lineRows.length
      ? lineRows
      : [{ description: "Project package", quantity: 1, unit: total, ext: total }];
    for (const row of rowsToRender) {
      x = tableLeft;
      const cells = [row.description, String(row.quantity), fmtMoney(row.unit), fmtMoney(row.ext)];
      for (let i = 0; i < widths.length; i += 1) {
        doc.rect(x, y, widths[i], rowH).stroke("#b6c4d6");
        doc.fontSize(8).fillColor("#333333").text(cells[i], x + 4, y + 7, {
          width: widths[i] - 8,
          align: i === 0 ? "left" : "center",
        });
        x += widths[i];
      }
      y += rowH;
      if (y > doc.page.height - 220) {
        doc.addPage();
        y = doc.page.margins.top;
      }
    }

    const summaryRows: Array<[string, string]> = [];
    summaryRows.push(["Subtotal", fmtMoney(preOverallTotalCents)]);
    if (discountAmount > 0) {
      const label = overallDiscountPct > 0 ? `Discount (${overallDiscountPct.toFixed(1).replace(/\.0$/, "")}%)` : "Discount";
      summaryRows.push([label, `-${fmtMoney(discountAmount)}`]);
    }
    summaryRows.push(["Total Amount", fmtMoney(total)]);
    for (const [label, value] of summaryRows) {
      x = tableLeft;
      doc.rect(x, y, widths[0] + widths[1] + widths[2], rowH).stroke("#b6c4d6");
      doc.rect(x + widths[0] + widths[1] + widths[2], y, widths[3], rowH).stroke("#b6c4d6");
      doc.fontSize(8).fillColor(label === "Total Amount" ? "#173464" : "#333333").text(label, x + 8, y + 7, {
        width: widths[0] + widths[1] + widths[2] - 16,
        align: "right",
      });
      doc.text(value, x + widths[0] + widths[1] + widths[2] + 4, y + 7, { width: widths[3] - 8, align: "center" });
      y += rowH;
    }
    doc.y = y + 12;

    if (paymentTerms) {
      doc.fontSize(9).fillColor("#173464").text("PAYMENT TERMS", { underline: true });
      doc.fillColor("#333333").fontSize(8.5).text(paymentTerms, { width: pageWidth });
      doc.moveDown(0.5);
    }
    if (terms) {
      if (doc.y > doc.page.height - 180) doc.addPage();
      doc.fontSize(9).fillColor("#173464").text("TERMS AND CONDITIONS", { underline: true });
      doc.fillColor("#333333").fontSize(8.5).text(terms, { width: pageWidth });
    }

    if (doc.y > doc.page.height - 130) doc.addPage();
    doc.moveDown(1.2);
    const signY = doc.y;
    const sigColWidth = (pageWidth - 32) / 2;
    doc.fontSize(9).fillColor("#173464").text("Prepared By:", left, signY, { width: sigColWidth });
    doc.text("Approved By:", left + sigColWidth + 32, signY, { width: sigColWidth });
    doc.moveTo(left, signY + 38).lineTo(left + sigColWidth - 20, signY + 38).stroke("#6b7d94");
    doc.moveTo(left + sigColWidth + 32, signY + 38).lineTo(right - 20, signY + 38).stroke("#6b7d94");
    doc.fontSize(8).fillColor("#333333").text(organization.primary_contact_name || "Northline Representative", left, signY + 42, {
      width: sigColWidth,
    });
    doc.text(organization.legal_name || organization.name, left + sigColWidth + 32, signY + 42, { width: sigColWidth });

    doc.addPage();
    doc.fontSize(14).fillColor("#173464").text("Project Scope Attachment", { width: pageWidth });
    doc.fontSize(9).fillColor("#333333").text("Automatically generated from the locked scope in the quote workspace.");
    doc.moveDown(0.6);
    if (projects.length === 0) {
      doc.fontSize(9).text("No project scopes are currently attached.");
    } else {
      for (const [idx, p] of projects.entries()) {
        if (doc.y > doc.page.height - 180) doc.addPage();
        doc.fontSize(11).fillColor("#173464").text(`${idx + 1}. ${p.name}`);
        doc.fontSize(9).fillColor("#333333").text(`Estimated timeline: ${p.timelineLabel}`);
        if (p.summary) doc.text(`Scope: ${p.summary}`, { width: pageWidth });
        if (p.outcomes.length > 0) {
          doc.text("Measurable outcomes:");
          for (const outcome of p.outcomes) {
            doc.text(`- ${outcome}`, { width: pageWidth - 12, indent: 10 });
          }
        }
        doc.moveDown(0.7);
      }
    }

    doc.end();
  });
}
