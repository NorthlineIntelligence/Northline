import PDFDocument from "pdfkit";
import type { CrmQuote, Organization, OrgContact } from "@prisma/client";
import { quoteTotalCentsFromPayload } from "@/lib/crmQuoteTotals";
import { parseScopeWorkItemsFromPayload } from "@/lib/crmQuoteScopeWorkItems";

function fmtMoney(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
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

export async function renderQuotePdfBuffer(args: {
  quote: CrmQuote;
  organization: Organization;
  signee: OrgContact | null;
  billing: OrgContact | null;
}): Promise<Buffer> {
  const { quote, organization, signee, billing } = args;
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

    doc.fontSize(18).fillColor("#173464").text("Northline — client quote", left, 56, {
      width: pageWidth,
    });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor("#333333").text(`Prepared for: ${clientName}`, {
      width: pageWidth,
    });
    doc.text(`Quote ID: ${quote.id}`, { width: pageWidth });
    doc.text(`Generated: ${new Date().toLocaleString()}`, { width: pageWidth });
    if (quote.valid_until) {
      doc.text(`Valid until: ${new Date(quote.valid_until).toLocaleDateString()}`, { width: pageWidth });
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
