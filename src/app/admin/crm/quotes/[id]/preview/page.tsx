import Link from "next/link";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { NORTHLINE_BRAND as BRAND, NORTHLINE_SHELL_BG as shellBg } from "@/lib/northlineBrand";

const ParamsSchema = z.object({ id: z.string().uuid() });

function fmtMoney(cents: number | null | undefined) {
  if (cents == null || Number.isNaN(cents)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
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
  const cover = String(payload.coverNarrative ?? "").trim();
  const terms = String(payload.terms ?? "").trim();
  const customLines = Array.isArray(payload.customLines) ? payload.customLines : [];

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
          </div>
          <p className="mt-2 text-sm font-semibold" style={{ color: BRAND.muted }}>
            {quote.organization.name} • {quote.status} • Updated {new Date(quote.updated_at).toLocaleString()}
          </p>
        </header>

        {cover ? (
          <section>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
              Executive summary
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-relaxed">{cover}</p>
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
                  <th className="pb-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {customLines.map((row, i) => {
                  const r = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
                  return (
                    <tr key={i} className="border-t font-semibold" style={{ borderColor: BRAND.border }}>
                      <td className="py-2 pr-3">{String(r.description ?? "Line item")}</td>
                      <td className="py-2 pr-3">{typeof r.quantity === "number" ? r.quantity : 1}</td>
                      <td className="py-2">{fmtMoney(typeof r.unit_price_cents === "number" ? r.unit_price_cents : 0)}</td>
                    </tr>
                  );
                })}
                {customLines.length === 0 ? (
                  <tr>
                    <td className="py-2" colSpan={3} style={{ color: BRAND.muted }}>
                      No pricing lines yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
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
      </div>
    </div>
  );
}

