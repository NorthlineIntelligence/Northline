"use client";

import { useEffect, useState } from "react";
import {
  NORTHLINE_BRAND as BRAND,
  NORTHLINE_GLASS_CARD as glass,
} from "@/lib/northlineBrand";

type PriceBookRow = {
  id: string;
  label: string;
  is_current: boolean;
  created_at: string;
  source_filename: string | null;
  storage_path: string | null;
  mime_type: string | null;
};

const SAMPLE_JSON = `[
  { "sku": "WS-DISCOVERY", "description": "AI readiness workshop (1 day)", "unit": "day", "unit_price_cents": 1500000 },
  { "sku": "IMPL-PILOT", "description": "Pilot implementation support", "unit": "sprint", "unit_price_cents": 3500000 }
]`;

export function CrmPriceBookPanel() {
  const [books, setBooks] = useState<PriceBookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [jsonText, setJsonText] = useState(SAMPLE_JSON);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  async function load() {
    setErr(null);
    try {
      const res = await fetch("/api/admin/crm/price-book", { credentials: "include" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Load failed");
      setBooks(Array.isArray(data.price_books) ? data.price_books : []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function publish() {
    setSaving(true);
    setErr(null);
    try {
      let line_items: unknown;
      try {
        line_items = JSON.parse(jsonText || "[]");
      } catch {
        throw new Error("Line items must be valid JSON array");
      }
      if (!Array.isArray(line_items)) throw new Error("line_items must be an array");

      const res = await fetch("/api/admin/crm/price-book", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim() || `Price book ${new Date().toLocaleDateString()}`,
          line_items,
          notes: notes.trim() || undefined,
          set_as_current: true,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Save failed");
      setLabel("");
      setNotes("");
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function uploadToStorage() {
    if (!uploadFile) {
      setErr("Choose a file to upload");
      return;
    }
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.set("file", uploadFile);
      fd.set("label", label.trim() || `Price book ${new Date().toLocaleDateString()}`);
      if (notes.trim()) fd.set("notes", notes.trim());
      fd.set("set_as_current", "true");

      const res = await fetch("/api/admin/crm/price-book/upload", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || data?.message || "Upload failed");
      }
      const warns = Array.isArray(data.parse_warnings) ? data.parse_warnings : [];
      if (warns.length > 0) {
        setErr(`Saved with notes: ${warns.join(" ")}`);
      }
      setUploadFile(null);
      setLabel("");
      setNotes("");
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function setCurrent(id: string) {
    setErr(null);
    try {
      const res = await fetch(`/api/admin/crm/price-book/${id}`, {
        method: "PATCH",
        credentials: "include",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Update failed");
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Update failed");
    }
  }

  return (
    <div className="rounded-2xl p-5" style={{ ...glass, borderColor: BRAND.border }}>
      <h2 className="text-lg font-black" style={{ color: BRAND.dark }}>
        Price book
      </h2>
      <p className="mt-1 text-sm font-semibold leading-relaxed" style={{ color: BRAND.muted }}>
        Upload a file to <strong>Supabase Storage</strong> (.json / .csv auto-import line items) or paste JSON below.
        Requires <code className="rounded bg-black/[0.06] px-1">SUPABASE_SERVICE_ROLE_KEY</code> on the server; optional
        bucket override <code className="rounded bg-black/[0.06] px-1">SUPABASE_PRICE_BOOK_BUCKET{" "}</code>
        (default <code className="rounded bg-black/[0.06] px-1">price-books</code>).
      </p>

      {err ? (
        <div className="mt-3 rounded-lg px-3 py-2 text-sm font-bold" style={{ background: "#fef2f2", color: BRAND.danger }}>
          {err}
        </div>
      ) : null}

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div>
          <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
            Versions
          </div>
          {loading ? (
            <div className="mt-2 text-sm font-semibold" style={{ color: BRAND.muted }}>
              Loading…
            </div>
          ) : books.length === 0 ? (
            <div className="mt-2 text-sm font-semibold" style={{ color: BRAND.muted }}>
              No price books yet—publish one on the right.
            </div>
          ) : (
            <ul className="mt-2 space-y-2">
              {books.map((b) => (
                <li
                  key={b.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm font-semibold"
                  style={{ borderColor: BRAND.border, background: BRAND.surfaceMuted }}
                >
                  <span style={{ color: BRAND.dark }}>
                    {b.label}
                    {b.is_current ? (
                      <span
                        className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-black uppercase"
                        style={{ background: "rgba(52, 176, 180, 0.25)", color: BRAND.dark }}
                      >
                        Current
                      </span>
                    ) : null}
                    {b.storage_path ? (
                      <a
                        href={`/api/admin/crm/price-book/${b.id}/file`}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 text-xs font-black uppercase tracking-wide underline"
                        style={{ color: BRAND.cyan }}
                      >
                        Download file
                      </a>
                    ) : null}
                  </span>
                  {!b.is_current ? (
                    <button
                      type="button"
                      className="rounded-lg px-2 py-1 text-xs font-black uppercase text-white"
                      style={{ background: BRAND.cyan }}
                      onClick={() => setCurrent(b.id)}
                    >
                      Set current
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
            Publish new version (becomes current)
          </div>
          <input
            className="mt-2 w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none focus:ring-2"
            style={{ borderColor: BRAND.border, color: BRAND.dark }}
            placeholder="Label e.g. FY2026 v3"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <label
            className="mt-3 block cursor-pointer rounded-xl border border-dashed px-4 py-8 text-center text-sm font-bold"
            style={{ borderColor: BRAND.lightAzure, background: BRAND.surfaceMuted, color: BRAND.dark }}
          >
            <input
              type="file"
              className="hidden"
              accept=".json,.csv,.txt,application/json,text/csv,text/plain"
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            />
            {uploadFile ? uploadFile.name : "Drop or click to choose file (JSON / CSV)"}
          </label>
          <button
            type="button"
            disabled={uploading || !uploadFile}
            className="mt-2 w-full rounded-xl py-2.5 text-sm font-black uppercase tracking-wide text-white disabled:opacity-50"
            style={{ background: BRAND.cyan }}
            onClick={uploadToStorage}
          >
            {uploading ? "Uploading…" : "Upload to Supabase & set as current"}
          </button>
          <div className="mt-3 text-center text-xs font-bold uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
            or paste JSON
          </div>
          <textarea
            className="mt-2 min-h-[180px] w-full rounded-xl border px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:ring-2"
            style={{ borderColor: BRAND.border, color: BRAND.dark }}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            spellCheck={false}
          />
          <textarea
            className="mt-2 w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none focus:ring-2"
            style={{ borderColor: BRAND.border, color: BRAND.dark }}
            placeholder="Internal notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
          <button
            type="button"
            disabled={saving}
            className="mt-3 w-full rounded-xl py-2.5 text-sm font-black uppercase tracking-wide text-white disabled:opacity-50"
            style={{ background: BRAND.dark }}
            onClick={publish}
          >
            {saving ? "Saving…" : "Save price book"}
          </button>
        </div>
      </div>
    </div>
  );
}
