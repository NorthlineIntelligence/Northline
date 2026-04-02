"use client";

import { useMemo, useState } from "react";
import { NORTHLINE_BRAND as BRAND, NORTHLINE_SHELL_BG as shellBackground } from "@/lib/northlineBrand";

type IngestResult =
  | {
      ok: true;
      version: string;
      created: number;
      updated: number;
      receivedPillarKeys?: string[];
      invalidPillars?: any[];
      skippedQuestions?: any[];
    }
  | {
      ok: false;
      error?: string;
      message?: string;
      issues?: any[];
      code?: string;
    };

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

export default function QuestionIngestPage() {
  const [rawRows, setRawRows] = useState<Array<Record<string, string>>>([]);
  const [error, setError] = useState<string | null>(null);

  const [version, setVersion] = useState<string>("1");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<IngestResult | null>(null);

  const columns = useMemo(() => {
    if (rawRows.length === 0) return [];
    return Object.keys(rawRows[0] ?? {});
  }, [rawRows]);

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

      // Convert to array of objects by header
      const objs: Array<Record<string, string>> = dataRows.map((vals) => {
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => {
          obj[h] = vals[i] ?? "";
        });
        return obj;
      });

      setRawRows(objs);
      setError(null);
    };
    reader.readAsText(file);
  }

  function buildPayload() {
    // Expect these columns (case-insensitive): pillar, display_order, question_text, weight, version, active, audience
    const required = ["pillar", "question_text"];
    const normalizedRows = rawRows.map((r) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) out[normalizeKey(k)] = v;
      return out;
    });

    for (const req of required) {
      if (!normalizedRows.every((r) => (r[req] ?? "").toString().trim().length > 0)) {
        throw new Error(`Missing required column/values: "${req}"`);
      }
    }

    // Build { pillars: { PILLAR: [ ...questions ] } }
    const pillars: Record<string, any[]> = {};

    normalizedRows.forEach((r, idx) => {
      const pillar = normalizeEnumLike(r["pillar"]);
      const question_text = (r["question_text"] ?? "").toString().trim();
      const display_order = toNum(r["display_order"], idx + 1);
      const weight = toNum(r["weight"], 1);
      const active = toBool(r["active"], true);
      const audience = normalizeEnumLike(r["audience"]) || "ALL";

      if (!pillars[pillar]) pillars[pillar] = [];
      pillars[pillar].push({
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
    }
  }

  return (
    <div className="min-h-screen" style={{ background: shellBackground, color: BRAND.dark }}>
      <div className="mx-auto max-w-5xl px-6 py-10">
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
                Columns expected: <b>pillar</b>, <b>question_text</b>, optional: display_order, weight, version, active, audience
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
                This sets <b>body.version</b> for the ingest call. (CSV “version” column is ignored in MVP.)
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
                    Created: <b>{importResult.created}</b> • Updated: <b>{importResult.updated}</b>
                  </div>
                  {(importResult.invalidPillars?.length ?? 0) > 0 && (
                    <div className="text-xs" style={{ color: BRAND.greyBlue }}>
                      Invalid pillars: {JSON.stringify(importResult.invalidPillars)}
                    </div>
                  )}
                  {(importResult.skippedQuestions?.length ?? 0) > 0 && (
                    <div className="text-xs" style={{ color: BRAND.greyBlue }}>
                      Skipped questions: {JSON.stringify(importResult.skippedQuestions)}
                    </div>
                  )}
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
          <div className="text-sm font-semibold">CSV template (copy/paste)</div>
          <pre
            className="mt-2 overflow-auto rounded-lg border p-3 text-xs"
            style={{ borderColor: BRAND.border, background: "#f9fafb" }}
          >
pillar,display_order,question_text,weight,active,audience
STRATEGIC_COHERENCE,1,"AI strategy exists.",1,true,ALL
STRATEGIC_COHERENCE,1,"Sales AI strategy is documented and adopted.",1,true,SALES
SYSTEM_INTEGRITY,3,"Test question — System Integrity",1,true,ALL
          </pre>
          <div className="mt-2 text-xs" style={{ color: BRAND.greyBlue }}>
            Note: if your question text contains commas, wrap it in quotes like the examples above.
          </div>
        </div>
      </div>
    </div>
  );
}