import Link from "next/link";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { NORTHLINE_BRAND as BRAND, NORTHLINE_SHELL_BG as shellBg } from "@/lib/northlineBrand";
import { parseScopeWorkItemsFromPayload } from "@/lib/crmQuoteScopeWorkItems";

const ParamsSchema = z.object({ id: z.string().uuid() });

function fmtMoney(cents: number | null | undefined) {
  if (cents == null || Number.isNaN(cents)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function normalizeLookupText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export default async function QuotePreviewPage(context: { params: Promise<{ id: string }> }) {
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

  const payload = quote.quote_payload && typeof quote.quote_payload === "object"
    ? (quote.quote_payload as Record<string, unknown>)
    : {};
  const terms = String(payload.terms ?? "").trim();
  const paymentTerms = String(payload.paymentTerms ?? "").trim();
  const scopeSummary =
    payload.scopeSummary && typeof payload.scopeSummary === "object"
      ? (payload.scopeSummary as {
          projects?: Array<{
            name?: string;
            timelineLabel?: string;
            costBand?: string | null;
            priority?: number | null;
          }>;
        })
      : null;
  const entryPoints = Array.isArray(scopeSummary?.projects)
    ? [...scopeSummary.projects].sort((a, b) => {
        const pa = typeof a.priority === "number" ? a.priority : Number.MAX_SAFE_INTEGER;
        const pb = typeof b.priority === "number" ? b.priority : Number.MAX_SAFE_INTEGER;
        return pa - pb;
      })
    : [];
  const workItems = parseScopeWorkItemsFromPayload(payload);
  const customLines = Array.isArray(payload.customLines) ? payload.customLines : [];
  const pricedItems = workItems.filter((w) => Boolean(w.engagementName));
  const hasAssessmentInScope = pricedItems.some((w) => {
    const t = normalizeLookupText(w.title);
    const e = normalizeLookupText(w.engagementName);
    return t.includes("assessment") || e.includes("assessment") || t.includes("readiness diagnostic");
  });
  const hasWorkshopInScope = pricedItems.some((w) => {
    const t = normalizeLookupText(w.title);
    const e = normalizeLookupText(w.engagementName);
    return t.includes("workshop") || e.includes("workshop");
  });
  const proposedProjects = pricedItems.map((w) => w.engagementName || w.title || "Project line");
  const overallDiscountPct =
    typeof payload.quoteDiscountPct === "number" && Number.isFinite(payload.quoteDiscountPct)
      ? Math.max(0, Math.min(100, payload.quoteDiscountPct))
      : 0;
  const hasLineDiscounts = workItems.some((w) => (w.discountPct ?? 0) > 0);
  const preOverallTotalCents = customLines.reduce((sum, row) => {
    if (!row || typeof row !== "object") return sum;
    const r = row as Record<string, unknown>;
    const qty = typeof r.quantity === "number" && Number.isFinite(r.quantity) ? r.quantity : 0;
    const unit =
      typeof r.unit_price_cents === "number" && Number.isFinite(r.unit_price_cents)
        ? r.unit_price_cents
        : 0;
    return sum + Math.max(0, Math.round(qty * unit));
  }, 0);
  const overallDiscountAmountCents =
    overallDiscountPct > 0 ? Math.max(0, preOverallTotalCents - (quote.total_cents ?? 0)) : 0;

  return (
    <div className="min-h-screen px-6 py-10" style={{ background: shellBg, color: BRAND.text }}>
      <div className="mx-auto max-w-4xl space-y-6 rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BRAND.border }}>
        <header className="border-b pb-4" style={{ borderColor: BRAND.border }}>
          {branding?.logo_data_url ? (
            <img
              src={branding.logo_data_url}
              alt="Company logo"
              className="mb-3 h-10 w-auto object-contain"
            />
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-2xl font-black" style={{ color: BRAND.dark }}>
              Quote Preview
            </h1>
            <Link
              href={`/admin/crm/organizations/${quote.organization_id}/quotes`}
              className="rounded-lg border bg-white px-3 py-1.5 text-xs font-black uppercase"
              style={{ borderColor: BRAND.border, color: BRAND.dark }}
            >
              Back to quote workspace
            </Link>
            <a
              href={`/api/admin/crm/quotes/${quote.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border bg-white px-3 py-1.5 text-xs font-black uppercase"
              style={{ borderColor: BRAND.border, color: BRAND.dark }}
            >
              Client Side Quote
            </a>
          </div>
          <p className="mt-2 text-sm font-semibold" style={{ color: BRAND.muted }}>
            {quote.organization.name} • {quote.status} • Updated {new Date(quote.updated_at).toLocaleString()}
          </p>
        </header>

        <section>
          <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
            Scope inclusion
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {hasAssessmentInScope ? (
              <span
                className="rounded-full px-2 py-1 text-xs font-black uppercase"
                style={{ background: "rgba(23,52,100,0.08)", color: BRAND.dark }}
              >
                Assessment included
              </span>
            ) : null}
            {hasWorkshopInScope ? (
              <span
                className="rounded-full px-2 py-1 text-xs font-black uppercase"
                style={{ background: "rgba(52,176,180,0.18)", color: BRAND.dark }}
              >
                Workshop included
              </span>
            ) : null}
            {!hasAssessmentInScope && !hasWorkshopInScope ? (
              <span className="text-sm font-semibold" style={{ color: BRAND.muted }}>
                No assessment/workshop scope tags found.
              </span>
            ) : null}
          </div>
        </section>

        {entryPoints.length > 0 || proposedProjects.length > 0 ? (
          <section>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
              Proposed projects
            </div>
            {entryPoints.length > 0 ? (
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {entryPoints.map((p, idx) => (
                  <div
                    key={`${p.name ?? "entry"}-${idx}`}
                    className="rounded-lg border p-3"
                    style={{ borderColor: BRAND.border, background: "#f8fbfd" }}
                  >
                    <div className="text-sm font-black" style={{ color: BRAND.dark }}>
                      {p.name?.trim() || `Entry point ${idx + 1}`}
                    </div>
                    <div className="mt-1 text-xs font-semibold" style={{ color: BRAND.muted }}>
                      Timeline: {p.timelineLabel?.trim() || "TBD"}
                    </div>
                    <div className="text-xs font-semibold" style={{ color: BRAND.muted }}>
                      Cost band: {p.costBand?.trim() || "TBD"}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-semibold">
                {proposedProjects.map((p, i) => (
                  <li key={`${p}-${i}`}>{p}</li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <section>
          <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
            Pricing
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                  <th className="pb-2 pr-3">Description</th>
                  <th className="pb-2 pr-3">Qty</th>
                  <th className="pb-2 pr-3">Discount</th>
                  <th className="pb-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {pricedItems.map((w, i) => {
                  const line = customLines[i];
                  const lineObj = line && typeof line === "object" ? (line as Record<string, unknown>) : {};
                  const amountCents =
                    typeof lineObj.unit_price_cents === "number" && Number.isFinite(lineObj.unit_price_cents)
                      ? lineObj.unit_price_cents
                      : 0;
                  return (
                    <tr key={w.id} className="border-t font-semibold" style={{ borderColor: BRAND.border }}>
                      <td className="py-2 pr-3">{w.engagementName || w.title}</td>
                      <td className="py-2 pr-3">{w.quantity}</td>
                      <td className="py-2 pr-3">
                        {w.discountPct > 0 ? `${w.discountPct.toFixed(1).replace(/\.0$/, "")}%` : ""}
                      </td>
                      <td className="py-2">{fmtMoney(amountCents)}</td>
                    </tr>
                  );
                })}
                {pricedItems.length === 0 ? (
                  <tr>
                    <td className="py-2" colSpan={4} style={{ color: BRAND.muted }}>
                      No pricing lines yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {hasLineDiscounts ? (
            <div className="mt-2 text-sm font-semibold" style={{ color: BRAND.muted }}>
              Line-item discounts are included above.
            </div>
          ) : null}
          {overallDiscountPct > 0 ? (
            <div className="mt-1 text-sm font-semibold" style={{ color: BRAND.muted }}>
              Overall quote discount: {overallDiscountPct.toFixed(1).replace(/\.0$/, "")}%
            </div>
          ) : null}
          {overallDiscountAmountCents > 0 ? (
            <div className="mt-1 text-right text-sm font-semibold" style={{ color: BRAND.muted }}>
              Overall discount amount: -{fmtMoney(overallDiscountAmountCents)}
            </div>
          ) : null}
          <div className="mt-3 text-right text-base font-black" style={{ color: BRAND.dark }}>
            Total: {fmtMoney(quote.total_cents)}
          </div>
        </section>

        {(quote.signee || quote.billing) && (
          <section>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
              Contacts
            </div>
            {quote.signee ? (
              <p className="mt-2 text-sm font-semibold">Signatory: {quote.signee.name}</p>
            ) : null}
            {quote.billing ? (
              <p className="text-sm font-semibold">Billing/POC: {quote.billing.name}</p>
            ) : null}
          </section>
        )}

        {terms ? (
          <section>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
              Terms
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-relaxed">{terms}</p>
          </section>
        ) : null}
        {paymentTerms ? (
          <section>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
              Payment Terms
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-relaxed">{paymentTerms}</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}

