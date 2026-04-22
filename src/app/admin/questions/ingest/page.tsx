"use client";

import { useEffect, useMemo, useState } from "react";
import { NORTHLINE_BRAND as BRAND, NORTHLINE_SHELL_BG as shellBackground } from "@/lib/northlineBrand";

type IngestResult =
  | {
      ok: true;
      version: string;
      normalizedQuestionCount: number;
      upsertedCount: number;
      deactivatedCount?: number;
    }
  | {
      ok: false;
      error?: string;
      message?: string;
      issues?: any[];
      code?: string;
    };

const TEMPLATE_HEADERS = [
  "pillar",
  "display_order",
  "question_core",
  "context_mode",
  "industry_context_json",
  "question_text",
  "weight",
  "active",
  "audience",
] as const;

function normalizeKey(k: string) {
  return (k ?? "").trim().toLowerCase();
}

function normalizeEnumLike(v: any) {
  const raw = (v ?? "").toString().trim();
  if (!raw) return "";
  return raw.toUpperCase().replace(/\s+/g, "_");
}

function toBool(v: any, defaultValue = true) {
  if (v === undefined || v === null || String(v).trim() === "") return defaultValue;
  const s = String(v).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return defaultValue;
}

function toNum(v: any, defaultValue: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultValue;
}

// Minimal CSV parser that supports quoted values containing commas.
// (Good enough for MVP; avoids “split(',')” breaking on commas in question text.)
function parseCSV(text: string) {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return { headers: [], rows: [], error: "CSV must include header row and at least one data row." };
  }

  const parseLine = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        // handle escaped quotes ("")
        const next = line[i + 1];
        if (inQuotes && next === '"') {
          cur += '"';
          i++;
          continue;
        }
        inQuotes = !inQuotes;
        continue;
      }

      if (ch === "," && !inQuotes) {
        out.push(cur.trim());
        cur = "";
        continue;
      }

      cur += ch;
    }

    out.push(cur.trim());
    return out;
  };

  const headers = parseLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => parseLine(line));

  return { headers, rows, error: null as string | null };
}

function isEffectivelyEmptyRow(row: Record<string, string>) {
  return Object.values(row).every((v) => String(v ?? "").trim().length === 0);
}

function validateTemplateHeaders(headers: string[]) {
  const normalized = headers.map(normalizeKey);
  const expected = [...TEMPLATE_HEADERS];
  if (normalized.length !== expected.length) {
    return `Header mismatch. Expected exactly: ${expected.join(", ")}`;
  }
  for (let i = 0; i < expected.length; i++) {
    if (normalized[i] !== expected[i]) {
      return `Header mismatch. Expected exactly: ${expected.join(", ")}`;
    }
  }
  return null;
}

export default function QuestionIngestPage() {
  const [rawRows, setRawRows] = useState<Array<Record<string, string>>>([]);
  const [error, setError] = useState<string | null>(null);

  const [version, setVersion] = useState<string>("1");
  const [importing, setImporting] = useState(false);
  const [importStartedAt, setImportStartedAt] = useState<number | null>(null);
  const [importElapsedSec, setImportElapsedSec] = useState(0);
  const [importResult, setImportResult] = useState<IngestResult | null>(null);

  const columns = useMemo(() => {
    if (rawRows.length === 0) return [];
    return Object.keys(rawRows[0] ?? {});
  }, [rawRows]);

  const importingLabel = importing
    ? `Import in progress... ${importElapsedSec}s elapsed`
    : "Ready to import";

  function downloadTemplateCsv() {
    const csv =
      [
        TEMPLATE_HEADERS.join(","),
        'SYSTEM_INTEGRITY,6,"Do your systems work well together, or do they feel disconnected?",INLINE,"{""LOGISTICS"":""dispatch, tracking, customer updates"",""SAAS"":""CRM, product data, customer success tools""}",,1,true,ALL',
        'HUMAN_ALIGNMENT,3,"Do people trust the decisions leadership makes?",NONE,"{}",,1,true,ALL',
        'SYSTEM_INTEGRITY,1,"Do your core workflows feel clearly defined, or do people still figure them out as they go?",APPEND,"{""LOGISTICS"":""In areas like dispatch, shipment handling, and customer updates.""}",,1,true,ALL',
      ].join("\n") + "\n";

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "question_ingest_template.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportResult(null);
    setError(null);

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const parsed = parseCSV(text);
      if (parsed.error) {
        setError(parsed.error);
        setRawRows([]);
        return;
      }

      const headers = parsed.headers;
      const dataRows = parsed.rows;
      const headerError = validateTemplateHeaders(headers);
      if (headerError) {
        setError(headerError);
        setRawRows([]);
        return;
      }

      // Convert to array of objects by header
      const objs: Array<Record<string, string>> = dataRows.map((vals) => {
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => {
          obj[h] = vals[i] ?? "";
        });
        return obj;
      });

      const nonEmptyRows = objs.filter((row) => !isEffectivelyEmptyRow(row));
      setRawRows(nonEmptyRows);
      setError(null);
    };
    reader.readAsText(file);
  }

  function buildPayload() {
    // Keep ingest format strictly aligned to template headers.
    const required = ["pillar"];
    const normalizedRows = rawRows.map((r) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) out[normalizeKey(k)] = v;
      return out;
    }).filter((row) => !isEffectivelyEmptyRow(row));

    for (const req of required) {
      if (!normalizedRows.every((r) => (r[req] ?? "").toString().trim().length > 0)) {
        throw new Error(`Missing required column/values: "${req}"`);
      }
    }
    if (!normalizedRows.every((r) => ((r["question_core"] ?? "").toString().trim() || (r["question_text"] ?? "").toString().trim()))) {
      throw new Error('Each row must include "question_core" (or fallback "question_text").');
    }

    // Build { pillars: { PILLAR: [ ...questions ] } }
    const pillars: Record<string, any[]> = {};

    normalizedRows.forEach((r, idx) => {
      const pillar = normalizeEnumLike(r["pillar"]);
      const question_text = (r["question_text"] ?? "").toString().trim();
      const question_core = (r["question_core"] ?? "").toString().trim();
      const context_mode = normalizeEnumLike(r["context_mode"]) || "NONE";
      const industry_context_json = (r["industry_context_json"] ?? "").toString().trim();
      const display_order = toNum(r["display_order"], idx + 1);
      const weight = toNum(r["weight"], 1);
      const active = toBool(r["active"], true);
      const audience = normalizeEnumLike(r["audience"]) || "ALL";

      if (!pillars[pillar]) pillars[pillar] = [];
      pillars[pillar].push({
        question_core,
        context_mode,
        industry_context_json,
        question_text,
        display_order,
        weight,
        active,
        audience,
      });
    });

    return {
      version: String(version || "1"),
      pillars,
    };
  }

  async function importNow() {
    setImportResult(null);
    setError(null);

    if (rawRows.length === 0) {
      setError("Upload a CSV first.");
      return;
    }

    let payload: any;
    try {
      payload = buildPayload();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      return;
    }

    setImporting(true);
    setImportStartedAt(Date.now());
    setImportElapsedSec(0);
    try {
      const res = await fetch("/api/questions/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const ct = res.headers.get("content-type") ?? "";
      const data = ct.includes("application/json") ? await res.json() : await res.text();

      if (!res.ok) {
        // show server-side errors cleanly
        if (typeof data === "string") {
          setImportResult({ ok: false, error: `HTTP ${res.status}`, message: data });
        } else {
          setImportResult({ ok: false, ...(data as any) });
        }
      } else {
        setImportResult(data as IngestResult);
      }
    } catch (e: any) {
      setImportResult({ ok: false, error: "Network error", message: e?.message ?? String(e) });
    } finally {
      setImporting(false);
      setImportStartedAt(null);
      setImportElapsedSec(0);
    }
  }

  useEffect(() => {
    if (!importing || importStartedAt === null) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setImportElapsedSec(Math.max(0, Math.floor((now - importStartedAt) / 1000)));
    }, 250);
    return () => window.clearInterval(id);
  }, [importing, importStartedAt]);

  return (
    <div className="min-h-screen" style={{ background: shellBackground, color: BRAND.dark }}>
      <div className="mx-auto max-w-5xl px-6 py-10">
        <style>{`
          @keyframes question-import-progress {
            0% { transform: translateX(-120%); }
            100% { transform: translateX(240%); }
          }
        `}</style>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Question Ingestion</h1>
            <p className="mt-2 text-sm" style={{ color: BRAND.greyBlue }}>
              Upload a CSV → preview → import into the question bank.
            </p>
          </div>

          <a
            href="/admin/dashboard"
            className="rounded-lg border bg-white px-3 py-2 text-sm font-medium shadow-sm transition hover:shadow"
            style={{ borderColor: BRAND.border }}
          >
            Back to Dashboard
          </a>
        </div>

        <div
          className="mt-6 rounded-2xl border bg-white p-6 shadow-sm"
          style={{ borderColor: BRAND.border }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-semibold">CSV file</label>
              <input
                type="file"
                accept=".csv"
                onChange={handleFile}
                className="mt-2 block w-full text-sm"
              />
              <div className="mt-2 text-xs" style={{ color: BRAND.greyBlue }}>
                Columns expected (exact):{" "}
                <b>{TEMPLATE_HEADERS.join(", ")}</b>
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold">Version to import</label>
              <input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                className="mt-2 w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: BRAND.border }}
                placeholder="1"
              />
              <div className="mt-2 text-xs" style={{ color: BRAND.greyBlue }}>
                This sets <b>body.version</b> for the ingest call.
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3 flex-wrap">
          <button
  onClick={importNow}
  disabled={importing}
  className="rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition disabled:opacity-60"
  style={{ background: importing ? "#98a2b3" : BRAND.dark }}
>
  {importing ? "Importing…" : "Import Questions"}
</button>

            <div className="text-xs" style={{ color: BRAND.greyBlue }}>
              Only rows in the CSV are created/updated. Anything not in the CSV is left unchanged.
            </div>
          </div>

          <div className="mt-3">
            <div className="mb-1 text-xs font-semibold" style={{ color: importing ? BRAND.dark : BRAND.greyBlue }}>
              {importingLabel}
            </div>
            <div
              className="relative h-2 overflow-hidden rounded-full border"
              style={{ borderColor: BRAND.border, background: "#eef3f8" }}
              aria-live="polite"
            >
              {importing ? (
                <div
                  className="absolute inset-y-0 w-1/3 rounded-full"
                  style={{
                    background: `linear-gradient(90deg, ${BRAND.cyan}, ${BRAND.dark})`,
                    animation: "question-import-progress 1.25s linear infinite",
                  }}
                />
              ) : (
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: importResult?.ok ? "100%" : "0%",
                    background: importResult?.ok
                      ? `linear-gradient(90deg, ${BRAND.cyan}, ${BRAND.dark})`
                      : "transparent",
                    transition: "width 220ms ease",
                  }}
                />
              )}
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-lg border p-3 text-sm font-medium text-red-700" style={{ borderColor: BRAND.border }}>
              {error}
            </div>
          )}

          {importResult && (
            <div
              className="mt-4 rounded-lg border p-4 text-sm"
              style={{ borderColor: BRAND.border, background: "#f9fafb" }}
            >
              {importResult.ok ? (
                <div className="grid gap-2">
                  <div className="font-semibold">Import complete</div>
                  <div>
                    Version: <b>{importResult.version}</b>
                  </div>
                  <div>
                    Normalized rows: <b>{importResult.normalizedQuestionCount}</b> • Upserted:{" "}
                    <b>{importResult.upsertedCount}</b>
                    {typeof importResult.deactivatedCount === "number" ? (
                      <>
                        {" "}
                        • Deactivated: <b>{importResult.deactivatedCount}</b>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="grid gap-2">
                  <div className="font-semibold text-red-700">Import failed</div>
                  <div style={{ color: BRAND.dark }}>
                    {(importResult.error ?? "Error") + (importResult.message ? `: ${importResult.message}` : "")}
                  </div>
                  {importResult.issues && (
                    <pre className="text-xs overflow-auto p-2 rounded border bg-white" style={{ borderColor: BRAND.border }}>
                      {JSON.stringify(importResult.issues, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          {rawRows.length > 0 && (
            <div className="mt-6 overflow-auto">
              <div className="text-sm font-semibold mb-2">Preview ({rawRows.length} rows)</div>
              <table className="min-w-full border text-sm" style={{ borderColor: BRAND.border }}>
                <thead style={{ background: "#f6f8fc" }}>
                  <tr>
                    {columns.map((key) => (
                      <th key={key} className="border px-3 py-2 text-left font-medium" style={{ borderColor: BRAND.border }}>
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rawRows.slice(0, 25).map((row, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: BRAND.border }}>
                      {columns.map((k) => (
                        <td key={k} className="border px-3 py-2" style={{ borderColor: BRAND.border }}>
                          {row[k]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rawRows.length > 25 && (
                <div className="mt-2 text-xs" style={{ color: BRAND.greyBlue }}>
                  Showing first 25 rows.
                </div>
              )}
            </div>
          )}
        </div>

        <div
          className="mt-6 rounded-2xl border bg-white p-6 shadow-sm"
          style={{ borderColor: BRAND.border }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold">CSV template (copy/paste)</div>
            <button
              type="button"
              onClick={downloadTemplateCsv}
              className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold shadow-sm transition hover:shadow"
              style={{ borderColor: BRAND.border }}
            >
              Download CSV Template
            </button>
          </div>
          <pre
            className="mt-2 overflow-auto rounded-lg border p-3 text-xs"
            style={{ borderColor: BRAND.border, background: "#f9fafb" }}
          >
            {`pillar,display_order,question_core,context_mode,industry_context_json,question_text,weight,active,audience
SYSTEM_INTEGRITY,6,"Do your systems work well together, or do they feel disconnected?",INLINE,"{""LOGISTICS"":""dispatch, tracking, customer updates"",""SAAS"":""CRM, product data, customer success tools""}",,1,TRUE,ALL
HUMAN_ALIGNMENT,3,"Do people trust the decisions leadership makes?",NONE,"{}",,1,TRUE,ALL
SYSTEM_INTEGRITY,1,"Do your core workflows feel clearly defined, or do people still figure them out as they go?",APPEND,"{""LOGISTICS"":""In areas like dispatch, shipment handling, and customer updates.""}",,1,TRUE,ALL`}
          </pre>
          <div className="mt-2 text-xs" style={{ color: BRAND.greyBlue }}>
            Note: if your question text contains commas, wrap it in quotes like the examples above.
          </div>
        </div>
      </div>
    </div>
  );
}