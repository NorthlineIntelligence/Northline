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

export default async function ClientQuotePage(context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return <div className="p-8 text-sm font-semibold text-red-700">Invalid quote id.</div>;
  }

  const quote = await prisma.crmQuote.findUnique({
    where: { id: parsed.data.id },
    include: { organization: true },
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

  return (
    <div className="min-h-screen px-6 py-10" style={{ background: shellBg, color: BRAND.text }}>
      <div className="mx-auto max-w-4xl space-y-6 rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BRAND.border }}>
        <header className="border-b pb-4" style={{ borderColor: BRAND.border }}>
          {branding?.logo_data_url ? (
            <img src={branding.logo_data_url} alt="Company logo" className="mb-3 h-10 w-auto object-contain" />
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-2xl font-black" style={{ color: BRAND.dark }}>
              Client Quote
            </h1>
            <Link
              href={`/admin/crm/quotes/${quote.id}/preview`}
              className="rounded-lg border bg-white px-3 py-1.5 text-xs font-black uppercase"
              style={{ borderColor: BRAND.border, color: BRAND.dark }}
            >
              Back to internal preview
            </Link>
          </div>
          <p className="mt-2 text-sm font-semibold" style={{ color: BRAND.muted }}>
            {quote.organization.name} • {quote.status}
          </p>
        </header>

        <section>
          <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
            Client legal + contact
          </div>
          <div className="mt-2 grid gap-2 text-sm font-semibold sm:grid-cols-2">
            <div>Legal business name: {quote.organization.legal_name || "—"}</div>
            <div>Business address: {quote.organization.legal_address || "—"}</div>
            <div>Primary contact: {quote.organization.primary_contact_name || "—"}</div>
            <div>Primary contact title: {quote.organization.primary_contact_title || "—"}</div>
          </div>
        </section>

        <section>
          <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
            Locked scope of work
          </div>
          {!projectsLocked ? (
            <p className="mt-2 text-sm font-semibold text-amber-700">
              Projects are not locked yet. Lock projects in the quote workspace before sharing this client quote.
            </p>
          ) : projects.length === 0 ? (
            <p className="mt-2 text-sm font-semibold" style={{ color: BRAND.muted }}>
              No locked projects found.
            </p>
          ) : (
            <div className="mt-3 grid gap-3">
              {projects.map((p, idx) => (
                <div key={`${p.name ?? "project"}-${idx}`} className="rounded-lg border p-3" style={{ borderColor: BRAND.border }}>
                  <div className="text-sm font-black" style={{ color: BRAND.dark }}>
                    {p.name?.trim() || `Project ${idx + 1}`}
                  </div>
                  <div className="mt-1 text-xs font-semibold" style={{ color: BRAND.muted }}>
                    Timeline: {p.timelineLabel?.trim() || "TBD"} • Cost band: {p.costBand?.trim() || "TBD"}
                  </div>
                  {p.summary?.trim() ? <p className="mt-2 whitespace-pre-wrap text-sm font-semibold">{p.summary}</p> : null}
                  {Array.isArray(p.deliverables) && p.deliverables.length > 0 ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-semibold">
                      {p.deliverables.map((d, i) => (
                        <li key={`${idx}-${i}`}>{d}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="text-right text-base font-black" style={{ color: BRAND.dark }}>
            Total: {fmtMoney(quote.total_cents)}
          </div>
        </section>

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
              Payment terms
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-relaxed">{paymentTerms}</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
