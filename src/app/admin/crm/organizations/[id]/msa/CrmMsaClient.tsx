"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CrmQuote } from "@prisma/client";
import { NORTHLINE_BRAND as BRAND, NORTHLINE_SHELL_BG as shellBg } from "@/lib/northlineBrand";
import { ADMIN_PREMIUM_BUTTON_STYLE } from "@/lib/adminButtonStyles";
import { QUOTE_STANDARD_TERMS_TEXT, QUOTE_STANDARD_TERMS_VERSION } from "@/lib/quoteStandardTerms";

type OrgResponse = {
  organization: {
    id: string;
    name: string;
    legal_name: string | null;
    legal_entity_type: string | null;
    ein: string | null;
    legal_address: string | null;
    billing_email: string | null;
    crm_quotes: Array<Pick<CrmQuote, "id" | "status" | "total_cents"> & { updated_at: string }>;
    crm_msas: Array<{
      id: string;
      title: string;
      status: string;
      version_number: number;
      terms_version: string | null;
      source_quote_id: string | null;
      accepted_by_name: string | null;
      accepted_by_email: string | null;
      accepted_at: string | null;
      updated_at: string;
      created_at: string;
    }>;
  };
};

export default function CrmMsaClient({ organizationId }: { organizationId: string }) {
  const [data, setData] = useState<OrgResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [msaNotes, setMsaNotes] = useState(
    `Master Services Agreement draft (template ${QUOTE_STANDARD_TERMS_VERSION}).\n\n${QUOTE_STANDARD_TERMS_TEXT}`
  );
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [docsResult, setDocsResult] = useState<string | null>(null);
  const [lifecycleResult, setLifecycleResult] = useState<string | null>(null);

  async function load() {
    setErr(null);
    const res = await fetch(`/api/admin/crm/organizations/${organizationId}/msa`, { credentials: "include" });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(json?.error || "Failed to load organization");
      return;
    }
    setData(json as OrgResponse);
  }

  useEffect(() => {
    void load();
  }, [organizationId]);

  const closedWonQuotes = useMemo(
    () => (data?.organization.crm_quotes ?? []).filter((q) => q.status === "CLOSED_WON"),
    [data]
  );

  async function createMsaDraft() {
    if (!data) return;
    setBusy(true);
    setErr(null);
    try {
      const title = `MSA - ${data.organization.legal_name || data.organization.name}`;
      const legalBlock = [
        `Client legal name: ${data.organization.legal_name || data.organization.name}`,
        `Entity type: ${data.organization.legal_entity_type || "—"}`,
        `EIN: ${data.organization.ein || "—"}`,
        `Legal address: ${data.organization.legal_address || "—"}`,
        `Billing email: ${data.organization.billing_email || "—"}`,
      ].join("\n");

      const bodyNotes = `${legalBlock}\n\nExhibit seed quote ID: ${selectedQuoteId || "Not selected"}\n\n${msaNotes}`;
      const res = await fetch(`/api/admin/crm/organizations/${organizationId}/msas`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          source_quote_id: selectedQuoteId || undefined,
          terms_version: QUOTE_STANDARD_TERMS_VERSION,
          body_markdown: bodyNotes,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Could not create MSA draft");
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to create MSA");
    } finally {
      setBusy(false);
    }
  }

  async function uploadMsaTemplate(file: File) {
    setUploadingDocs(true);
    setDocsResult(null);
    try {
      const fd = new FormData();
      fd.append("files", file);
      const res = await fetch(`/api/admin/organizations/${organizationId}/documents`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Upload failed");
      setDocsResult("MSA template uploaded to customer document library.");
    } catch (e: unknown) {
      setDocsResult(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingDocs(false);
    }
  }

  if (!data) {
    return <div className="p-8 text-sm font-semibold">{err || "Loading MSA workspace..."}</div>;
  }

  return (
    <div className="min-h-screen px-6 py-10" style={{ background: shellBg, color: BRAND.text }}>
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
              MSA Workspace
            </div>
            <h1 className="mt-1 text-2xl font-black" style={{ color: BRAND.dark }}>
              {data.organization.name}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/admin/crm/organizations/${organizationId}`}
              className="rounded-2xl px-4 py-2 text-sm font-black tracking-tight transition hover:-translate-y-[1px]"
              style={ADMIN_PREMIUM_BUTTON_STYLE}
            >
              ← Back to Organization Account
            </Link>
            <Link
              href="/admin/crm"
              className="rounded-2xl px-4 py-2 text-sm font-black tracking-tight transition hover:-translate-y-[1px]"
              style={ADMIN_PREMIUM_BUTTON_STYLE}
            >
              CRM Hub
            </Link>
          </div>
        </header>

        <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
          <div className="text-sm font-black" style={{ color: BRAND.dark }}>
            Build MSA draft from closed won quote
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.muted }}>
                Closed won quote (for Exhibit A/B seed)
              </label>
              <select
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-semibold"
                style={{ borderColor: BRAND.border }}
                value={selectedQuoteId}
                onChange={(e) => setSelectedQuoteId(e.target.value)}
              >
                <option value="">Select closed won quote</option>
                {closedWonQuotes.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.id.slice(0, 8)} • ${((q.total_cents ?? 0) / 100).toFixed(2)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <textarea
            className="mt-3 min-h-[220px] w-full rounded-xl border px-3 py-2 text-sm font-semibold"
            style={{ borderColor: BRAND.border }}
            value={msaNotes}
            onChange={(e) => setMsaNotes(e.target.value)}
          />
          <button
            type="button"
            disabled={busy}
            className="mt-3 rounded-xl px-4 py-2 text-sm font-black uppercase text-white disabled:opacity-50"
            style={{ background: BRAND.dark }}
            onClick={() => void createMsaDraft()}
          >
            {busy ? "Creating..." : "Create MSA Draft"}
          </button>
          {err ? <div className="mt-2 text-sm font-semibold text-red-700">{err}</div> : null}
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
          <div className="text-sm font-black" style={{ color: BRAND.dark }}>
            MSA lifecycle
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                  <th className="pb-2 pr-3">Title</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3">Version</th>
                  <th className="pb-2 pr-3">Accepted by</th>
                  <th className="pb-2 pr-3">Updated</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.organization.crm_msas.map((m) => (
                  <tr key={m.id} className="border-t font-semibold" style={{ borderColor: BRAND.border }}>
                    <td className="py-2 pr-3">{m.title}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{m.status}</span>
                        {m.status === "SIGNED" ? (
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-black uppercase"
                            style={{ background: "rgba(23,52,100,0.08)", color: BRAND.dark }}
                          >
                            Immutable
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-2 pr-3">v{m.version_number}</td>
                    <td className="py-2 pr-3">
                      {m.accepted_by_name || m.accepted_by_email ? `${m.accepted_by_name ?? ""} ${m.accepted_by_email ?? ""}`.trim() : "—"}
                    </td>
                    <td className="py-2 pr-3">{new Date(m.updated_at).toLocaleString()}</td>
                    <td className="py-2">
                      <select
                        className="rounded border px-2 py-1 text-xs"
                        value={m.status}
                        onChange={async (e) => {
                          setLifecycleResult(null);
                          const res = await fetch(`/api/admin/crm/msas/${m.id}`, {
                            method: "PATCH",
                            credentials: "include",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ status: e.target.value }),
                          });
                          const json = await res.json().catch(() => null);
                          if (!res.ok) {
                            setLifecycleResult(json?.error || "Failed to update MSA status.");
                          } else if (json?.version_bumped) {
                            setLifecycleResult(
                              json?.message || "Signed MSA is immutable; created a new versioned draft instead."
                            );
                          } else {
                            setLifecycleResult("MSA status updated.");
                          }
                          await load();
                        }}
                      >
                        <option value="DRAFT">DRAFT</option>
                        <option value="INTERNAL_REVIEW">INTERNAL REVIEW</option>
                        <option value="SENT_TO_CLIENT">SENT TO CLIENT</option>
                        <option value="CLIENT_REVIEW">CLIENT REVIEW</option>
                        <option value="SIGNED">SIGNED</option>
                        <option value="SUPERSEDED">SUPERSEDED</option>
                        <option value="ARCHIVED">ARCHIVED</option>
                      </select>
                    </td>
                  </tr>
                ))}
                {data.organization.crm_msas.length === 0 ? (
                  <tr>
                    <td className="py-2" colSpan={6} style={{ color: BRAND.muted }}>
                      No MSAs yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {lifecycleResult ? (
            <div className="mt-2 text-sm font-semibold" style={{ color: BRAND.muted }}>
              {lifecycleResult}
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
          <div className="text-sm font-black" style={{ color: BRAND.dark }}>
            Upload new MSA template
          </div>
          <div className="mt-1 text-sm font-semibold" style={{ color: BRAND.muted }}>
            Uploads into this customer's document library (for NDA, MSA templates, or legal docs).
          </div>
          <input
            type="file"
            className="mt-3"
            disabled={uploadingDocs}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadMsaTemplate(f);
              e.currentTarget.value = "";
            }}
          />
          {docsResult ? <div className="mt-2 text-sm font-semibold">{docsResult}</div> : null}
        </section>
      </div>
    </div>
  );
}

