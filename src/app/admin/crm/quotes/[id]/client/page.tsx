import { z } from "zod";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { NORTHLINE_BRAND as BRAND, NORTHLINE_SHELL_BG as shellBg } from "@/lib/northlineBrand";
import QuoteClientActions from "./QuoteClientActions";
import { parseScopeWorkItemsFromPayload } from "@/lib/crmQuoteScopeWorkItems";

const ParamsSchema = z.object({ id: z.string().uuid() });

function fmtMoney(cents: number | null | undefined) {
  if (cents == null || Number.isNaN(cents)) return "—";
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

function renderInlineFormatting(text: string): Array<string | ReactNode> {
  const out: Array<string | ReactNode> = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > cursor) out.push(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      out.push(<strong key={`b-${key++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      out.push(<em key={`i-${key++}`}>{token.slice(1, -1)}</em>);
    } else {
      out.push(token);
    }
    cursor = regex.lastIndex;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

function renderRichText(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i].trimEnd();
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const bullet = /^[-*]\s+/.test(line);
    const numbered = /^\d+\.\s+/.test(line);
    if (bullet || numbered) {
      const listItems: ReactNode[] = [];
      const isOrdered = numbered;
      while (i < lines.length) {
        const current = lines[i].trimEnd();
        if (isOrdered ? /^\d+\.\s+/.test(current) : /^[-*]\s+/.test(current)) {
          const content = current.replace(isOrdered ? /^\d+\.\s+/ : /^[-*]\s+/, "");
          listItems.push(<li key={`li-${key++}`}>{renderInlineFormatting(content)}</li>);
          i += 1;
        } else if (!current.trim()) {
          i += 1;
          break;
        } else {
          break;
        }
      }
      nodes.push(
        isOrdered ? (
          <ol key={`ol-${key++}`} className="list-decimal pl-5 space-y-1">
            {listItems}
          </ol>
        ) : (
          <ul key={`ul-${key++}`} className="list-disc pl-5 space-y-1">
            {listItems}
          </ul>
        )
      );
      continue;
    }
    const paragraphLines = [line];
    i += 1;
    while (i < lines.length && lines[i].trim()) {
      if (/^[-*]\s+/.test(lines[i]) || /^\d+\.\s+/.test(lines[i])) break;
      paragraphLines.push(lines[i].trimEnd());
      i += 1;
    }
    nodes.push(
      <p key={`p-${key++}`} className="whitespace-pre-wrap">
        {renderInlineFormatting(paragraphLines.join("\n"))}
      </p>
    );
  }
  return <div className="space-y-2">{nodes}</div>;
}

export default async function ClientQuotePage(context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return <div className="p-8 text-sm font-semibold text-red-700">Invalid quote id.</div>;
  }

  const quote = await prisma.crmQuote.findUnique({
    where: { id: parsed.data.id },
    include: {
      organization: true,
      signee: true,
      billing: true,
    },
  });
  if (!quote) {
    return <div className="p-8 text-sm font-semibold text-red-700">Quote not found.</div>;
  }

  const branding = await prisma.appBranding.findUnique({ where: { id: "default" } });
  const payload =
    quote.quote_payload && typeof quote.quote_payload === "object"
      ? (quote.quote_payload as Record<string, unknown>)
      : {};
  const projectsLocked = payload.scopeProjectsLocked === true;
  const scopeSummary =
    payload.scopeSummary && typeof payload.scopeSummary === "object"
      ? (payload.scopeSummary as {
          projects?: Array<{
            name?: string;
            summary?: string;
            deliverables?: string[];
            timelineLabel?: string;
            costBand?: string | null;
            priority?: number | null;
          }>;
        })
      : null;
  const projects = Array.isArray(scopeSummary?.projects)
    ? [...scopeSummary.projects].sort((a, b) => (a.priority ?? 9999) - (b.priority ?? 9999))
    : [];
  const terms = String(payload.terms ?? "").trim();
  const paymentTerms = String(payload.paymentTerms ?? "").trim();
  const customLines = Array.isArray(payload.customLines) ? payload.customLines : [];
  const workItems = parseScopeWorkItemsFromPayload(payload);
  const pricedWorkItems = workItems.filter((w) => Boolean(w.engagementName) && (w.quantity ?? 0) > 0);
  const lineItems = customLines
    .map((row, i) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const src = pricedWorkItems[i];
      const descriptionRaw = src?.engagementName || String(r.description ?? "").trim() || `Line ${i + 1}`;
      const modelRaw = src?.pricingModel === "HOURLY" ? "Hourly" : src?.pricingModel === "PROJECT" ? "Project" : "";
      const description = modelRaw ? `${descriptionRaw} — ${modelRaw}` : descriptionRaw;
      const quantity = typeof r.quantity === "number" && Number.isFinite(r.quantity) ? Math.max(0, r.quantity) : 0;
      const unit = typeof r.unit_price_cents === "number" && Number.isFinite(r.unit_price_cents) ? Math.max(0, r.unit_price_cents) : 0;
      const total = Math.round(quantity * unit);
      const lineDiscountPct = src?.discountPct && src.discountPct > 0 ? src.discountPct : 0;
      return { description, quantity, unit, total, lineDiscountPct };
    })
    .filter((v): v is { description: string; quantity: number; unit: number; total: number; lineDiscountPct: number } => v !== null);
  const overallDiscountPct =
    typeof payload.quoteDiscountPct === "number" && Number.isFinite(payload.quoteDiscountPct)
      ? Math.max(0, Math.min(100, payload.quoteDiscountPct))
      : 0;
  const preOverallTotalCents = customLines.reduce((sum, row) => {
    if (!row || typeof row !== "object") return sum;
    const r = row as Record<string, unknown>;
    const qty = typeof r.quantity === "number" && Number.isFinite(r.quantity) ? r.quantity : 0;
    const unit = typeof r.unit_price_cents === "number" && Number.isFinite(r.unit_price_cents) ? r.unit_price_cents : 0;
    return sum + Math.max(0, Math.round(qty * unit));
  }, 0);
  const discountAmount = Math.max(0, preOverallTotalCents - (quote.total_cents ?? 0));
  const hasLineItemDiscount = lineItems.some((l) => l.lineDiscountPct > 0);
  const fromName = branding?.quote_from_name?.trim() || "Northline Intelligence";
  const fromAddress = branding?.quote_from_address?.trim() || "—";
  const fromPhone = branding?.quote_from_phone?.trim() || "—";
  const fromEmail = branding?.quote_from_email?.trim() || "—";
  const preparedByName =
    branding?.quote_prepared_by_name?.trim() ||
    branding?.quote_from_name?.trim() ||
    "Northline Representative";
  const approvedByName =
    quote.signee?.name?.trim() ||
    quote.billing?.name?.trim() ||
    quote.organization.primary_contact_name?.trim() ||
    quote.organization.legal_name?.trim() ||
    quote.organization.name;

  return (
    <div className="min-h-screen px-6 py-10 client-quote-bg" style={{ background: shellBg, color: BRAND.text }}>
      <div className="mx-auto max-w-4xl rounded-2xl border bg-white p-8 shadow-sm client-quote-sheet" style={{ borderColor: BRAND.border }}>
        <div className="no-print mb-4">
          <QuoteClientActions quoteId={quote.id} backHref={`/admin/crm/quotes/${quote.id}/preview`} />
        </div>

        <header className="border-b pb-4 client-quote-header" style={{ borderColor: BRAND.border }}>
          <div className="flex items-center justify-between gap-4">
            <div className="client-quote-title-wrap">
              <h1 className="client-quote-title">SALES QUOTATION</h1>
              <div className="mt-3 text-xs font-semibold leading-5">
                <div>Quotation Number: {quote.id.slice(0, 8)}</div>
                <div>Date: {fmtDateUS(quote.created_at)}</div>
                <div>Valid Until: {quote.valid_until ? fmtDateUS(quote.valid_until) : "—"}</div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              {branding?.logo_data_url ? (
                <img src={branding.logo_data_url} alt="Company logo" className="h-12 w-auto object-contain" />
              ) : null}
            </div>
          </div>
        </header>

        <section className="mt-6 grid gap-4 text-sm font-semibold sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
              From
            </div>
            <div>{fromName}</div>
            <div>{fromAddress}</div>
            <div>{fromPhone}</div>
            <div>{fromEmail}</div>
          </div>
          <div className="sm:text-right">
            <div className="mb-1 text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
              To
            </div>
            <div>{quote.organization.legal_name || quote.organization.name}</div>
            <div>{quote.organization.legal_address || "—"}</div>
            <div>{quote.organization.primary_contact_name || "—"}</div>
            <div>{quote.organization.primary_contact_title || "—"}</div>
          </div>
        </section>

        <section className="mt-6">
          <div className="text-center text-sm font-black uppercase tracking-wider" style={{ color: BRAND.dark }}>
            Itemized Quotation Details
          </div>
          <div className="mt-3 overflow-hidden rounded border client-quote-table-wrap" style={{ borderColor: BRAND.border }}>
            <table className="min-w-full text-left text-sm client-quote-table">
              <thead style={{ background: "rgba(23,52,100,0.12)" }}>
                <tr className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.dark }}>
                  <th className="px-3 py-2">Item Description</th>
                  <th className="px-3 py-2 text-center">Quantity</th>
                  {hasLineItemDiscount ? <th className="px-3 py-2 text-center">Discount</th> : null}
                  <th className="px-3 py-2 text-center">Unit Price</th>
                  <th className="px-3 py-2 text-right">Total Price</th>
                </tr>
              </thead>
              <tbody>
                {(lineItems.length
                  ? lineItems
                  : [{ description: "Project package", quantity: 1, unit: quote.total_cents ?? 0, total: quote.total_cents ?? 0, lineDiscountPct: 0 }]).map((row, i) => (
                  <tr key={`${row.description}-${i}`} className="border-t" style={{ borderColor: BRAND.border }}>
                    <td className="px-3 py-2 font-semibold">{row.description}</td>
                    <td className="px-3 py-2 text-center font-semibold">{row.quantity}</td>
                    {hasLineItemDiscount ? (
                      <td className="px-3 py-2 text-center font-semibold">
                        {row.lineDiscountPct > 0 ? `${row.lineDiscountPct.toFixed(1).replace(/\.0$/, "")}%` : ""}
                      </td>
                    ) : null}
                    <td className="px-3 py-2 text-center font-semibold">{fmtMoney(row.unit)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{fmtMoney(row.total)}</td>
                  </tr>
                ))}
                <tr className="border-t" style={{ borderColor: BRAND.border }}>
                  <td colSpan={hasLineItemDiscount ? 4 : 3} className="px-3 py-2 text-right font-semibold">Subtotal</td>
                  <td className="px-3 py-2 text-right font-semibold">{fmtMoney(preOverallTotalCents)}</td>
                </tr>
                {discountAmount > 0 ? (
                  <tr className="border-t" style={{ borderColor: BRAND.border }}>
                    <td colSpan={hasLineItemDiscount ? 4 : 3} className="px-3 py-2 text-right font-semibold">
                      Discount {overallDiscountPct > 0 ? `(${overallDiscountPct.toFixed(1).replace(/\.0$/, "")}%)` : ""}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">-{fmtMoney(discountAmount)}</td>
                  </tr>
                ) : null}
                <tr className="border-t" style={{ borderColor: BRAND.border, background: "rgba(23,52,100,0.08)" }}>
                  <td colSpan={hasLineItemDiscount ? 4 : 3} className="px-3 py-2 text-right font-black" style={{ color: BRAND.dark }}>Total Amount</td>
                  <td className="px-3 py-2 text-right font-black" style={{ color: BRAND.dark }}>{fmtMoney(quote.total_cents)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-6">
          <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>Terms and conditions</div>
          <div className="mt-2 rounded border p-3 text-sm font-semibold leading-relaxed" style={{ borderColor: BRAND.border, background: "rgba(23,52,100,0.03)" }}>
            {terms ? renderRichText(terms) : "—"}
          </div>
          <div className="mt-3 text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>Payment terms</div>
          <div className="mt-2 rounded border p-3 text-sm font-semibold leading-relaxed" style={{ borderColor: BRAND.border, background: "rgba(23,52,100,0.03)" }}>
            {paymentTerms ? renderRichText(paymentTerms) : "—"}
          </div>
        </section>

        <section className="mt-8 grid gap-6 sm:grid-cols-2 client-quote-signatures">
          <div>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>Prepared by</div>
            <div className="mt-8 border-b" style={{ borderColor: BRAND.border }} />
            <div className="mt-2 text-sm font-semibold">{preparedByName}</div>
          </div>
          <div>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>Approved by</div>
            <div className="mt-8 border-b" style={{ borderColor: BRAND.border }} />
            <div className="mt-2 text-sm font-semibold">{approvedByName}</div>
          </div>
        </section>

        <section className="mt-10 scope-attachment">
          <div className="text-sm font-black uppercase tracking-wider" style={{ color: BRAND.dark }}>
            Project Scope Attachment
          </div>
          {!projectsLocked ? (
            <p className="mt-2 text-sm font-semibold text-amber-700">Projects must be locked before sharing this quote.</p>
          ) : projects.length === 0 ? (
            <p className="mt-2 text-sm font-semibold" style={{ color: BRAND.muted }}>No locked projects found.</p>
          ) : (
            <div className="mt-3 grid gap-4">
              {projects.map((p, idx) => (
                <div key={`${p.name ?? "project"}-${idx}`} className="rounded border p-3" style={{ borderColor: BRAND.border }}>
                  <div className="text-base font-black" style={{ color: BRAND.dark }}>{idx + 1}. {p.name?.trim() || `Project ${idx + 1}`}</div>
                  <div className="mt-1 text-xs font-semibold" style={{ color: BRAND.muted }}>
                    Estimated timeline: {p.timelineLabel?.trim() || "TBD"}{p.costBand?.trim() ? ` • Cost band: ${p.costBand.trim()}` : ""}
                  </div>
                  {p.summary?.trim() ? <p className="mt-2 whitespace-pre-wrap text-sm font-semibold">Scope: {p.summary}</p> : null}
                  {Array.isArray(p.deliverables) && p.deliverables.length > 0 ? (
                    <div className="mt-2">
                      <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                        Measurable outcomes
                      </div>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm font-semibold">
                        {p.deliverables.map((d, i) => (
                          <li key={`${idx}-${i}`}>{d}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <style>{`
        .client-quote-title {
          font-weight: 900;
          letter-spacing: 0.06em;
          color: #173464;
          font-size: 2.1rem;
          line-height: 1;
        }
        .client-quote-title-wrap {
          position: relative;
          padding-right: 1rem;
          padding-left: 0.25rem;
        }
        .client-quote-table-wrap {
          box-shadow: inset 0 0 0 1px rgba(23, 52, 100, 0.05);
        }
        .client-quote-table td,
        .client-quote-table th {
          border-color: #c2d0e4;
        }
        .client-quote-signatures {
          padding-top: 0.25rem;
        }
        .client-quote-signatures > div {
          position: relative;
        }
        .client-quote-signatures > div::after {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          bottom: 1.6rem;
          border-bottom: 1px solid #8da3bf;
        }
        @media print {
          @page {
            size: letter;
            margin: 14mm;
          }
          .no-print {
            display: none !important;
          }
          .client-quote-bg {
            background: #fff !important;
            padding: 0 !important;
          }
          .client-quote-sheet {
            border: 0 !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            max-width: none !important;
            padding: 0 !important;
          }
          .scope-attachment {
            break-before: page;
          }
          .client-quote-title {
            font-size: 2rem;
          }
        }
      `}</style>
    </div>
  );
}
