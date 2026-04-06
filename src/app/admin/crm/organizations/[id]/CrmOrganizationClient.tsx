"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  NORTHLINE_BRAND as BRAND,
  NORTHLINE_SHELL_BG as shellBg,
} from "@/lib/northlineBrand";
import {
  CRM_PIPELINE_ORDER,
  CRM_STAGE_LABEL,
} from "@/lib/crmPipeline";
import type {
  CrmPipelineStage,
  CrmQuoteStatus,
  Organization,
  OrgContact,
  CrmQuote,
  CrmContract,
  CrmInvoice,
} from "@prisma/client";

type OrgResponse = {
  organization: Organization & {
    org_contacts: OrgContact[];
    assessments: Array<{ id: string; name: string; status: string; created_at: Date; locked_at: Date | null }>;
    crm_quotes: Array<Pick<CrmQuote, "id" | "status" | "total_cents" | "updated_at" | "assessment_id">>;
    crm_contracts: CrmContract[];
    crm_invoices: CrmInvoice[];
    _count: { assessments: number; org_contacts: number };
  };
  links: {
    executiveInsightsAssessmentId: string | null;
    projectScope: { assessmentId: string; version: number } | null;
  };
  alerts: { followUpOverdue: boolean; overdueInvoices: number };
};

function fmtMoney(cents: number | null | undefined) {
  if (cents == null || Number.isNaN(cents)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export default function CrmOrganizationClient({ organizationId }: { organizationId: string }) {
  const [data, setData] = useState<OrgResponse | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [followUp, setFollowUp] = useState("");
  const [internalNotes, setInternalNotes] = useState("");

  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactTitle, setContactTitle] = useState("");

  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [quote, setQuote] = useState<CrmQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [coverDraft, setCoverDraft] = useState("");
  const [termsDraft, setTermsDraft] = useState("");

  const [contractTitle, setContractTitle] = useState("");
  const [invoiceTitle, setInvoiceTitle] = useState("");
  const [invoiceCents, setInvoiceCents] = useState("");
  const [invoiceDue, setInvoiceDue] = useState("");

    const loadOrg = useCallback(async () => {
    setLoadErr(null);
    try {
      const res = await fetch(`/api/admin/crm/organizations/${organizationId}`, { credentials: "include" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to load account");
      setData(json as OrgResponse);
      const o = (json as OrgResponse).organization;
      setFollowUp(
        o.crm_next_follow_up_at ? new Date(o.crm_next_follow_up_at).toISOString().slice(0, 16) : ""
      );
      setInternalNotes(o.crm_internal_notes ?? "");
    } catch (e: unknown) {
      setLoadErr(e instanceof Error ? e.message : "Load failed");
    }
  }, [organizationId]);

  useEffect(() => {
    loadOrg();
  }, [loadOrg]);

  useEffect(() => {
    if (!data?.organization.crm_quotes?.length) {
      setSelectedQuoteId(null);
      setQuote(null);
      return;
    }
    const first = data.organization.crm_quotes[0].id;
    if (!selectedQuoteId || !data.organization.crm_quotes.some((q) => q.id === selectedQuoteId)) {
      setSelectedQuoteId(first);
    }
  }, [data, selectedQuoteId]);

  useEffect(() => {
    if (!selectedQuoteId) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setQuoteErr(null);
      try {
        const res = await fetch(`/api/admin/crm/quotes/${selectedQuoteId}`, { credentials: "include" });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error || "Quote load failed");
        if (!cancelled) setQuote(json.quote as CrmQuote);
      } catch (e: unknown) {
        if (!cancelled) setQuoteErr(e instanceof Error ? e.message : "Quote load failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedQuoteId]);

  const latestAssessmentId = data?.organization.assessments[0]?.id ?? null;

  const payload = useMemo(() => {
    const raw = quote?.quote_payload;
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  }, [quote]);

  useEffect(() => {
    setCoverDraft(String(payload.coverNarrative ?? ""));
    setTermsDraft(String(payload.terms ?? ""));
  }, [quote?.id, payload.coverNarrative, payload.terms]);

  async function patchOrg(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/crm/organizations/${organizationId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Save failed");
      await loadOrg();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function setStage(stage: CrmPipelineStage) {
    await patchOrg({ crm_pipeline_stage: stage });
  }

  async function saveCrmNotes() {
    await patchOrg({
      crm_internal_notes: internalNotes.trim() || null,
      crm_next_follow_up_at: followUp.trim() ? new Date(followUp).toISOString() : null,
    });
  }

  async function addContact() {
    if (!contactName.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/crm/organizations/${organizationId}/contacts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: contactName.trim(),
          email: contactEmail.trim() || undefined,
          title: contactTitle.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to add contact");
      setContactName("");
      setContactEmail("");
      setContactTitle("");
      await loadOrg();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function createQuote() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/crm/organizations/${organizationId}/quotes`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Quote create failed");
      await loadOrg();
      if (json.quote?.id) setSelectedQuoteId(json.quote.id);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Quote create failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveQuote(nextPayload: Record<string, unknown>, extra?: Record<string, unknown>) {
    if (!selectedQuoteId) return;
    setBusy(true);
    setQuoteErr(null);
    try {
      const res = await fetch(`/api/admin/crm/quotes/${selectedQuoteId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_payload: nextPayload, ...extra }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Quote save failed");
      setQuote(json.quote as CrmQuote);
      await loadOrg();
    } catch (e: unknown) {
      setQuoteErr(e instanceof Error ? e.message : "Quote save failed");
    } finally {
      setBusy(false);
    }
  }

  async function resyncQuoteFromScope() {
    if (!selectedQuoteId) return;
    setBusy(true);
    setQuoteErr(null);
    try {
      const res = await fetch(`/api/admin/crm/quotes/${selectedQuoteId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resync_from_scope: true }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Resync failed");
      setQuote(json.quote as CrmQuote);
      await loadOrg();
    } catch (e: unknown) {
      setQuoteErr(e instanceof Error ? e.message : "Resync failed");
    } finally {
      setBusy(false);
    }
  }

  function updateLine(idx: number, patchRow: Record<string, unknown>) {
    const lines = [...(Array.isArray(payload.priceBookLines) ? payload.priceBookLines : [])] as Record<
      string,
      unknown
    >[];
    lines[idx] = { ...lines[idx], ...patchRow };
    void saveQuote({ ...payload, priceBookLines: lines });
  }

  if (loadErr) {
    return (
      <div className="p-8 font-bold" style={{ color: BRAND.danger }}>
        {loadErr}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 font-semibold" style={{ color: BRAND.muted }}>
        Loading account…
      </div>
    );
  }

  const org = data.organization;
  const execId = data.links.executiveInsightsAssessmentId;
  const scope = data.links.projectScope;
  const overdueFollow = data.alerts.followUpOverdue;
  const stage = org.crm_pipeline_stage;
  const stepIdx = CRM_PIPELINE_ORDER.indexOf(stage);

  const contacts = org.org_contacts.filter((c) => !c.is_archived);

  return (
    <div className="min-h-screen px-4 py-8 sm:px-6" style={{ background: shellBg, color: BRAND.text }}>
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-3 border-b pb-6 sm:flex-row sm:items-start sm:justify-between" style={{ borderColor: BRAND.border }}>
          <div>
            <Link href="/admin/crm" className="text-xs font-black uppercase tracking-wider hover:underline" style={{ color: BRAND.cyan }}>
              ← CRM hub
            </Link>
            <h1 className="mt-2 text-3xl font-black tracking-tight" style={{ color: BRAND.dark }}>
              {org.name}
            </h1>
            <p className="mt-1 text-sm font-semibold" style={{ color: BRAND.muted }}>
              Client profile • {org._count.assessments} assessment(s) • {contacts.length} contact(s)
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/admin/organizations/${org.id}`}
              className="rounded-xl border bg-white px-4 py-2 text-sm font-bold shadow-sm"
              style={{ borderColor: BRAND.border, color: BRAND.dark }}
            >
              Edit organization
            </Link>
            {latestAssessmentId ? (
              <Link
                href={`/admin/assessments/${latestAssessmentId}`}
                className="rounded-xl border bg-white px-4 py-2 text-sm font-bold shadow-sm"
                style={{ borderColor: BRAND.border, color: BRAND.dark }}
              >
                Participants & invites
              </Link>
            ) : null}
          </div>
        </header>

        {(overdueFollow || data.alerts.overdueInvoices > 0) && (
          <div
            className="rounded-2xl border px-4 py-3 text-sm font-bold"
            style={{
              borderColor: BRAND.danger,
              background: "rgba(180, 35, 24, 0.08)",
              color: BRAND.dark,
            }}
          >
            {overdueFollow ? <div>Follow-up date is past due—update the pipeline or set a new date.</div> : null}
            {data.alerts.overdueInvoices > 0 ? (
              <div className="mt-1">This account has {data.alerts.overdueInvoices} overdue invoice(s) in CRM.</div>
            ) : null}
          </div>
        )}

        <section className="rounded-2xl border bg-white/95 p-4 shadow-sm backdrop-blur-sm sm:p-6" style={{ borderColor: BRAND.border }}>
          <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
            Pipeline status
          </div>
          <div className="mt-3 flex gap-1 overflow-x-auto pb-1">
            {CRM_PIPELINE_ORDER.map((s, i) => {
              const active = i <= stepIdx;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  onClick={() => setStage(s)}
                  className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-wide transition disabled:opacity-50"
                  style={{
                    background: active ? BRAND.dark : BRAND.surfaceMuted,
                    color: active ? "#fff" : BRAND.muted,
                    border: `1px solid ${active ? BRAND.dark : BRAND.border}`,
                  }}
                >
                  {CRM_STAGE_LABEL[s]}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-sm font-semibold" style={{ color: BRAND.muted }}>
            Click a stage to update status. Workshops, quotes, and signatures map to the last three steps.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border bg-white/95 p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
              Deliverables
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {execId ? (
                <a
                  href={`/assessments/${execId}/narrative`}
                  className="rounded-xl px-4 py-3 text-sm font-bold text-white"
                  style={{ background: BRAND.cyan }}
                >
                  Open Executive Insights report →
                </a>
              ) : (
                <div className="text-sm font-semibold" style={{ color: BRAND.muted }}>
                  No narrative yet—complete assessment and generate Executive Insights.
                </div>
              )}
              {scope ? (
                <a
                  href={`/assessments/${scope.assessmentId}/project-scope`}
                  className="rounded-xl border px-4 py-3 text-sm font-bold"
                  style={{ borderColor: BRAND.border, color: BRAND.dark, background: BRAND.surfaceMuted }}
                >
                  Open project scope readout (v{scope.version}) →
                </a>
              ) : (
                <div className="text-sm font-semibold" style={{ color: BRAND.muted }}>
                  Project scope not generated for the latest assessment.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border bg-white/95 p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
              Tracking & internal notes
            </div>
            <label className="mt-3 block text-xs font-black uppercase tracking-wider" style={{ color: BRAND.muted }}>
              Next follow-up
            </label>
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
              style={{ borderColor: BRAND.border }}
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
            />
            <label className="mt-3 block text-xs font-black uppercase tracking-wider" style={{ color: BRAND.muted }}>
              Internal notes
            </label>
            <textarea
              className="mt-1 min-h-[100px] w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
              style={{ borderColor: BRAND.border }}
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
            />
            <button
              type="button"
              disabled={busy}
              className="mt-3 rounded-xl px-4 py-2 text-sm font-black uppercase tracking-wide text-white disabled:opacity-50"
              style={{ background: BRAND.dark }}
              onClick={saveCrmNotes}
            >
              Save tracking
            </button>
          </div>
        </section>

        <section className="rounded-2xl border bg-white/95 p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
          <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
            Contacts
          </div>
          <p className="mt-1 text-sm font-semibold" style={{ color: BRAND.muted }}>
            Used for quote signatory and point-of-contact dropdowns. Add new entries anytime.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                  <th className="pb-2 pr-3">Name</th>
                  <th className="pb-2 pr-3">Title</th>
                  <th className="pb-2">Email</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} className="border-t font-semibold" style={{ borderColor: BRAND.border }}>
                    <td className="py-2 pr-3">{c.name}</td>
                    <td className="py-2 pr-3">{c.title ?? "—"}</td>
                    <td className="py-2">{c.email ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <input
              className="rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
              style={{ borderColor: BRAND.border }}
              placeholder="Name *"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
            <input
              className="rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
              style={{ borderColor: BRAND.border }}
              placeholder="Title"
              value={contactTitle}
              onChange={(e) => setContactTitle(e.target.value)}
            />
            <input
              className="rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
              style={{ borderColor: BRAND.border }}
              placeholder="Email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
          </div>
          <button
            type="button"
            disabled={busy}
            className="mt-3 rounded-xl px-4 py-2 text-sm font-black uppercase text-white disabled:opacity-50"
            style={{ background: BRAND.cyan }}
            onClick={addContact}
          >
            Add contact
          </button>
        </section>

        <section className="rounded-2xl border bg-white/95 p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                Project scope & quote
              </div>
              <p className="mt-1 text-sm font-semibold" style={{ color: BRAND.muted }}>
                Auto-filled from project scope and price book; edit line items and narrative before sending.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                className="rounded-xl border px-4 py-2 text-sm font-bold disabled:opacity-50"
                style={{ borderColor: BRAND.border, color: BRAND.dark }}
                onClick={createQuote}
              >
                New quote
              </button>
              <select
                className="rounded-xl border px-3 py-2 text-sm font-bold outline-none"
                style={{ borderColor: BRAND.border, color: BRAND.dark }}
                value={selectedQuoteId ?? ""}
                onChange={(e) => setSelectedQuoteId(e.target.value || null)}
              >
                {org.crm_quotes.length === 0 ? <option value="">No quotes yet</option> : null}
                {org.crm_quotes.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.status} · {fmtMoney(q.total_cents)} · {new Date(q.updated_at).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {quoteErr ? (
            <div className="mt-3 rounded-lg px-3 py-2 text-sm font-bold" style={{ background: "#fef2f2", color: BRAND.danger }}>
              {quoteErr}
            </div>
          ) : null}

          {quote ? (
            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || !quote.assessment_id}
                  className="rounded-xl px-4 py-2 text-sm font-black uppercase text-white disabled:opacity-50"
                  style={{ background: BRAND.dark }}
                  onClick={resyncQuoteFromScope}
                >
                  Re-sync from latest scope
                </button>
                <span className="self-center text-sm font-bold" style={{ color: BRAND.muted }}>
                  Total {fmtMoney(quote.total_cents)} • {quote.status}
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.muted }}>
                    Signatory
                  </label>
                  <select
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
                    style={{ borderColor: BRAND.border }}
                    value={quote.signee_contact_id ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "__add") return;
                      void saveQuote(payload as Record<string, unknown>, {
                        signee_contact_id: v || null,
                      });
                    }}
                  >
                    <option value="">Select…</option>
                    <option value="__add">+ Add new contact (use form above)</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.title ? ` — ${c.title}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.muted }}>
                    Point of contact / billing
                  </label>
                  <select
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
                    style={{ borderColor: BRAND.border }}
                    value={quote.billing_contact_id ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "__add") return;
                      void saveQuote(payload as Record<string, unknown>, {
                        billing_contact_id: v || null,
                      });
                    }}
                  >
                    <option value="">Select…</option>
                    <option value="__add">+ Add new contact (use form above)</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.title ? ` — ${c.title}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.muted }}>
                  Cover narrative
                </label>
                <textarea
                  className="mt-1 min-h-[90px] w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
                  style={{ borderColor: BRAND.border }}
                  value={coverDraft}
                  onChange={(e) => setCoverDraft(e.target.value)}
                />
                <button
                  type="button"
                  disabled={busy}
                  className="mt-2 rounded-lg px-3 py-1.5 text-xs font-black uppercase text-white disabled:opacity-50"
                  style={{ background: BRAND.dark }}
                  onClick={() => void saveQuote({ ...payload, coverNarrative: coverDraft })}
                >
                  Save narrative
                </button>
              </div>
              <div>
                <label className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.muted }}>
                  Terms
                </label>
                <textarea
                  className="mt-1 min-h-[70px] w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
                  style={{ borderColor: BRAND.border }}
                  value={termsDraft}
                  onChange={(e) => setTermsDraft(e.target.value)}
                />
                <button
                  type="button"
                  disabled={busy}
                  className="mt-2 rounded-lg px-3 py-1.5 text-xs font-black uppercase text-white disabled:opacity-50"
                  style={{ background: BRAND.dark }}
                  onClick={() => void saveQuote({ ...payload, terms: termsDraft })}
                >
                  Save terms
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                      <th className="pb-2 pr-2">Use</th>
                      <th className="pb-2 pr-2">SKU</th>
                      <th className="pb-2 pr-2">Description</th>
                      <th className="pb-2 pr-2">Qty</th>
                      <th className="pb-2">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Array.isArray(payload.priceBookLines) ? payload.priceBookLines : []).map((row, idx) => {
                      const r = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
                      return (
                        <tr key={idx} className="border-t font-semibold" style={{ borderColor: BRAND.border }}>
                          <td className="py-2 pr-2">
                            <input
                              type="checkbox"
                              checked={r.selected === true}
                              onChange={(e) => updateLine(idx, { selected: e.target.checked })}
                            />
                          </td>
                          <td className="py-2 pr-2">{String(r.sku ?? "")}</td>
                          <td className="py-2 pr-2 max-w-[220px]">{String(r.description ?? "")}</td>
                          <td className="py-2 pr-2">
                            <input
                              type="number"
                              min={1}
                              className="w-16 rounded border px-1 py-1 outline-none"
                              style={{ borderColor: BRAND.border }}
                              value={typeof r.quantity === "number" ? r.quantity : 1}
                              onChange={(e) =>
                                updateLine(idx, { quantity: Math.max(1, Number(e.target.value) || 1) })
                              }
                            />
                          </td>
                          <td className="py-2">{fmtMoney(typeof r.unit_price_cents === "number" ? r.unit_price_cents : 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div>
                <label className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.muted }}>
                  Quote status
                </label>
                <select
                  className="mt-1 rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
                  style={{ borderColor: BRAND.border }}
                  value={quote.status}
                  onChange={(e) =>
                    saveQuote(payload as Record<string, unknown>, { status: e.target.value as CrmQuoteStatus })
                  }
                >
                  {(["DRAFT", "SENT", "ACCEPTED", "DECLINED"] as const).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="mt-4 text-sm font-semibold" style={{ color: BRAND.muted }}>
              Select or create a quote to edit pricing and contacts.
            </div>
          )}
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border bg-white/95 p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
              Contracts (records)
            </div>
            <ul className="mt-3 space-y-2 text-sm font-semibold">
              {org.crm_contracts.map((c) => (
                <li key={c.id} className="rounded-lg border px-3 py-2" style={{ borderColor: BRAND.border }}>
                  <span style={{ color: BRAND.dark }}>{c.title}</span>
                  <span className="ml-2 text-xs font-black uppercase" style={{ color: BRAND.muted }}>
                    {c.status}
                  </span>
                </li>
              ))}
              {org.crm_contracts.length === 0 ? (
                <li style={{ color: BRAND.muted }}>No contract records yet.</li>
              ) : null}
            </ul>
            <input
              className="mt-3 w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
              style={{ borderColor: BRAND.border }}
              placeholder="Contract title"
              value={contractTitle}
              onChange={(e) => setContractTitle(e.target.value)}
            />
            <button
              type="button"
              disabled={busy}
              className="mt-2 rounded-xl px-4 py-2 text-sm font-black uppercase text-white disabled:opacity-50"
              style={{ background: BRAND.dark }}
              onClick={async () => {
                if (!contractTitle.trim()) return;
                setBusy(true);
                try {
                  const res = await fetch(`/api/admin/crm/organizations/${organizationId}/contracts`, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ title: contractTitle.trim() }),
                  });
                  const json = await res.json().catch(() => null);
                  if (!res.ok) throw new Error(json?.error || "Failed");
                  setContractTitle("");
                  await loadOrg();
                } catch (e: unknown) {
                  alert(e instanceof Error ? e.message : "Failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Add contract record
            </button>
          </div>

          <div className="rounded-2xl border bg-white/95 p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
              Invoices
            </div>
            <ul className="mt-3 space-y-2 text-sm font-semibold">
              {org.crm_invoices.map((inv) => (
                <li key={inv.id} className="rounded-lg border px-3 py-2" style={{ borderColor: BRAND.border }}>
                  <span style={{ color: BRAND.dark }}>{inv.title}</span> · {fmtMoney(inv.amount_cents)} · {inv.status}
                  {inv.due_date ? ` · due ${new Date(inv.due_date).toLocaleDateString()}` : ""}
                </li>
              ))}
              {org.crm_invoices.length === 0 ? (
                <li style={{ color: BRAND.muted }}>No invoices yet.</li>
              ) : null}
            </ul>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <input
                className="rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
                style={{ borderColor: BRAND.border }}
                placeholder="Title"
                value={invoiceTitle}
                onChange={(e) => setInvoiceTitle(e.target.value)}
              />
              <input
                className="rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
                style={{ borderColor: BRAND.border }}
                placeholder="Amount (USD)"
                value={invoiceCents}
                onChange={(e) => setInvoiceCents(e.target.value)}
              />
              <input
                type="date"
                className="rounded-xl border px-3 py-2 text-sm font-semibold outline-none sm:col-span-2"
                style={{ borderColor: BRAND.border }}
                value={invoiceDue}
                onChange={(e) => setInvoiceDue(e.target.value)}
              />
            </div>
            <button
              type="button"
              disabled={busy}
              className="mt-2 rounded-xl px-4 py-2 text-sm font-black uppercase text-white disabled:opacity-50"
              style={{ background: BRAND.cyan }}
              onClick={async () => {
                if (!invoiceTitle.trim()) return;
                const dollars = Number.parseFloat(invoiceCents.replace(/[^0-9.]/g, ""));
                if (!Number.isFinite(dollars)) {
                  alert("Enter a valid amount");
                  return;
                }
                const amount_cents = Math.round(dollars * 100);
                setBusy(true);
                try {
                  const res = await fetch(`/api/admin/crm/organizations/${organizationId}/invoices`, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      title: invoiceTitle.trim(),
                      amount_cents,
                      due_date: invoiceDue ? new Date(`${invoiceDue}T12:00:00`).toISOString() : null,
                      status: "SENT",
                    }),
                  });
                  const json = await res.json().catch(() => null);
                  if (!res.ok) throw new Error(json?.error || "Failed");
                  setInvoiceTitle("");
                  setInvoiceCents("");
                  setInvoiceDue("");
                  await loadOrg();
                } catch (e: unknown) {
                  alert(e instanceof Error ? e.message : "Failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Add invoice
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
