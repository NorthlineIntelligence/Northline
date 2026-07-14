"use client";

import { useEffect, useMemo, useState } from "react";
import { NORTHLINE_BRAND as BRAND, NORTHLINE_SHELL_BG as shellBackground } from "@/lib/northlineBrand";
import {
  PRIORITY_CSV_COLUMNS,
  PRIORITY_RESPONSE_TYPES,
  PRIORITY_SCORING_DIMENSIONS,
} from "@/lib/priorityDiscovery/questions";

type Question = {
  id: string;
  questionSetVersion: string;
  section: string;
  questionText: string;
  questionHelpText: string | null;
  responseType: string;
  options: string[];
  scaleMin: number | null;
  scaleMax: number | null;
  scaleLabels: Record<string, string> | null;
  required: boolean;
  order: number;
  tags: string[];
  scoringDimension: string | null;
  isActive: boolean;
};

const emptyDraft: Omit<Question, "id"> = {
  questionSetVersion: "1",
  section: "Business Pressure",
  questionText: "",
  questionHelpText: "",
  responseType: "FREE_TEXT",
  options: [],
  scaleMin: null,
  scaleMax: null,
  scaleLabels: null,
  required: true,
  order: 1,
  tags: [],
  scoringDimension: "BUSINESS_IMPACT",
  isActive: true,
};

function splitList(value: string) {
  return value
    .split(/[|;\n]/g)
    .map((v) => v.trim())
    .filter(Boolean);
}

function joinList(value: string[] | null | undefined) {
  return (value ?? []).join(" | ");
}

function quoteCsv(value: unknown) {
  const s = Array.isArray(value) ? value.join("|") : String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

export default function PriorityDiscoveryQuestionsPage() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedVersion, setSelectedVersion] = useState("1");
  const [includeInactive, setIncludeInactive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Omit<Question, "id">>(emptyDraft);
  const [importRaw, setImportRaw] = useState("");
  const [importFormat, setImportFormat] = useState<"json" | "csv">("json");
  const [importPreview, setImportPreview] = useState<string | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState("");

  const visibleQuestions = useMemo(
    () =>
      questions
        .filter((q) => q.questionSetVersion === selectedVersion)
        .sort((a, b) => a.order - b.order),
    [questions, selectedVersion]
  );

  const versions = useMemo(() => {
    const values = Array.from(new Set(questions.map((q) => q.questionSetVersion)));
    return values.length ? values.sort() : ["1"];
  }, [questions]);

  async function load() {
    setLoading(true);
    setMessage(null);
    const res = await fetch(`/api/admin/priority-discovery/questions?includeInactive=${includeInactive}`, {
      credentials: "include",
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setMessage(json?.error ?? `Failed to load questions (${res.status}).`);
      setLoading(false);
      return;
    }
    setQuestions(json.questions ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeInactive]);

  function startCreate() {
    setEditingId(null);
    setDraft({
      ...emptyDraft,
      questionSetVersion: selectedVersion,
      order: visibleQuestions.length ? Math.max(...visibleQuestions.map((q) => q.order)) + 1 : 1,
    });
  }

  function startEdit(q: Question) {
    setEditingId(q.id);
    const rest = {
      questionSetVersion: q.questionSetVersion,
      section: q.section,
      questionText: q.questionText,
      questionHelpText: q.questionHelpText,
      responseType: q.responseType,
      options: q.options,
      scaleMin: q.scaleMin,
      scaleMax: q.scaleMax,
      scaleLabels: q.scaleLabels,
      required: q.required,
      order: q.order,
      tags: q.tags,
      scoringDimension: q.scoringDimension,
      isActive: q.isActive,
    };
    setDraft(rest);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveDraft() {
    setMessage(null);
    if (!draft.questionText.trim()) {
      setMessage("Question text is required.");
      return;
    }
    const payload = {
      question: {
        ...draft,
        options: draft.options.length ? draft.options : null,
        tags: draft.tags.length ? draft.tags : null,
        scaleMin: draft.responseType === "LIKERT" || draft.responseType === "CONFIDENCE" || draft.responseType === "URGENCY" ? draft.scaleMin ?? 1 : null,
        scaleMax: draft.responseType === "LIKERT" || draft.responseType === "CONFIDENCE" || draft.responseType === "URGENCY" ? draft.scaleMax ?? 5 : null,
      },
    };
    const res = await fetch("/api/admin/priority-discovery/questions", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(editingId ? { id: editingId, ...payload } : { action: "create", ...payload }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setMessage(json?.error ?? `Save failed (${res.status}).`);
      return;
    }
    setMessage(editingId ? "Question updated." : "Question created.");
    setEditingId(null);
    await load();
  }

  async function seed() {
    setMessage(null);
    const res = await fetch("/api/admin/priority-discovery/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "seed", version: selectedVersion }),
    });
    const json = await res.json().catch(() => null);
    setMessage(json?.ok ? `Seeded ${json.count} questions.` : json?.error ?? "Seed failed.");
    await load();
  }

  async function toggleActive(q: Question) {
    await fetch("/api/admin/priority-discovery/questions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id: q.id, question: { isActive: !q.isActive } }),
    });
    await load();
  }

  async function remove(q: Question) {
    if (!window.confirm("Delete this question?")) return;
    await fetch(`/api/admin/priority-discovery/questions?id=${encodeURIComponent(q.id)}`, {
      method: "DELETE",
      credentials: "include",
    });
    await load();
  }

  async function duplicateVersion() {
    if (!duplicateTarget.trim()) {
      setMessage("Enter a target version.");
      return;
    }
    const res = await fetch("/api/admin/priority-discovery/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "duplicate", sourceVersion: selectedVersion, targetVersion: duplicateTarget.trim() }),
    });
    const json = await res.json().catch(() => null);
    setMessage(json?.ok ? `Duplicated ${json.count} questions into version ${duplicateTarget}.` : json?.error ?? "Duplicate failed.");
    setSelectedVersion(duplicateTarget.trim());
    setDuplicateTarget("");
    await load();
  }

  function previewImport() {
    try {
      if (importFormat === "json") {
        const parsed = JSON.parse(importRaw);
        if (!Array.isArray(parsed)) throw new Error("JSON must be an array.");
        setImportPreview(`Valid JSON array with ${parsed.length} question object(s).`);
      } else {
        const lines = importRaw.split(/\r?\n/).filter((line) => line.trim());
        const header = lines[0] ?? "";
        const ok = header === PRIORITY_CSV_COLUMNS.join(",");
        setImportPreview(ok ? `CSV preview: ${Math.max(0, lines.length - 1)} row(s).` : `CSV header must be: ${PRIORITY_CSV_COLUMNS.join(",")}`);
      }
    } catch (err: unknown) {
      setImportPreview(err instanceof Error ? err.message : "Preview failed.");
    }
  }

  async function importQuestions() {
    setMessage(null);
    const res = await fetch("/api/admin/priority-discovery/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "import", version: selectedVersion, format: importFormat, raw: importRaw }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setMessage(json?.error ?? `Import failed (${res.status}).`);
      return;
    }
    setMessage(`Imported ${json.count} questions.`);
    setImportRaw("");
    setImportPreview(null);
    await load();
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(visibleQuestions, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `priority-discovery-questions-v${selectedVersion}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    const rows = [
      PRIORITY_CSV_COLUMNS.join(","),
      ...visibleQuestions.map((q) =>
        [
          q.section,
          q.questionText,
          q.questionHelpText ?? "",
          q.responseType,
          q.options,
          q.scaleMin ?? "",
          q.scaleMax ?? "",
          q.required,
          q.order,
          q.tags,
          q.scoringDimension ?? "",
          q.isActive,
        ]
          .map(quoteCsv)
          .join(",")
      ),
    ];
    const blob = new Blob([rows.join("\n") + "\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `priority-discovery-questions-v${selectedVersion}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen" style={{ background: shellBackground, color: BRAND.dark }}>
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Priority Discovery Questions</h1>
            <p className="mt-2 max-w-3xl text-sm" style={{ color: BRAND.greyBlue }}>
              Manage the consultative question set for AI Priority Discovery. Results are decision-support recommendations and should stay evidence-backed.
            </p>
          </div>
          <a className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold shadow-sm" style={{ borderColor: BRAND.border }} href="/admin/dashboard">
            Admin Dashboard
          </a>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[420px_1fr]">
          <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
            <div className="text-lg font-semibold">{editingId ? "Edit Question" : "Create Question"}</div>
            <div className="mt-4 grid gap-3">
              <Field label="Version" value={draft.questionSetVersion} onChange={(v) => setDraft((d) => ({ ...d, questionSetVersion: v }))} />
              <Field label="Section" value={draft.section} onChange={(v) => setDraft((d) => ({ ...d, section: v }))} />
              <TextArea label="Question Text" value={draft.questionText} onChange={(v) => setDraft((d) => ({ ...d, questionText: v }))} rows={4} />
              <TextArea label="Help Text" value={draft.questionHelpText ?? ""} onChange={(v) => setDraft((d) => ({ ...d, questionHelpText: v }))} rows={2} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Answer Type" value={draft.responseType} options={[...PRIORITY_RESPONSE_TYPES]} onChange={(v) => setDraft((d) => ({ ...d, responseType: v }))} />
                <Select label="Scoring Dimension" value={draft.scoringDimension ?? ""} options={["", ...PRIORITY_SCORING_DIMENSIONS]} onChange={(v) => setDraft((d) => ({ ...d, scoringDimension: v || null }))} />
              </div>
              <TextArea label="Options (pipe, semicolon, or newline separated)" value={joinList(draft.options)} onChange={(v) => setDraft((d) => ({ ...d, options: splitList(v) }))} rows={3} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Scale Min" value={draft.scaleMin?.toString() ?? ""} onChange={(v) => setDraft((d) => ({ ...d, scaleMin: v ? Number(v) : null }))} />
                <Field label="Scale Max" value={draft.scaleMax?.toString() ?? ""} onChange={(v) => setDraft((d) => ({ ...d, scaleMax: v ? Number(v) : null }))} />
                <Field label="Order" value={String(draft.order)} onChange={(v) => setDraft((d) => ({ ...d, order: Number(v) || 1 }))} />
              </div>
              <TextArea label="Tags" value={joinList(draft.tags)} onChange={(v) => setDraft((d) => ({ ...d, tags: splitList(v) }))} rows={2} />
              <div className="flex flex-wrap gap-4 text-sm font-semibold">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={draft.required} onChange={(e) => setDraft((d) => ({ ...d, required: e.target.checked }))} />
                  Required
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))} />
                  Active
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={saveDraft} className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: BRAND.dark }}>
                  {editingId ? "Save Changes" : "Create Question"}
                </button>
                <button onClick={startCreate} className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold" style={{ borderColor: BRAND.border }}>
                  New Blank
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Question Set</div>
                <div className="mt-1 text-sm" style={{ color: BRAND.greyBlue }}>
                  {loading ? "Loading..." : `${visibleQuestions.length} question(s) in version ${selectedVersion}`}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select value={selectedVersion} onChange={(e) => setSelectedVersion(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: BRAND.border }}>
                  {versions.map((v) => <option key={v} value={v}>Version {v}</option>)}
                </select>
                <label className="inline-flex items-center gap-2 text-xs font-semibold">
                  <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
                  Show inactive
                </label>
                <button onClick={seed} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold" style={{ borderColor: BRAND.border }}>Seed Defaults</button>
                <button onClick={exportJson} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold" style={{ borderColor: BRAND.border }}>Export JSON</button>
                <button onClick={exportCsv} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold" style={{ borderColor: BRAND.border }}>Export CSV</button>
              </div>
            </div>

            {message ? <div className="mt-4 rounded-lg border p-3 text-sm font-semibold" style={{ borderColor: BRAND.border }}>{message}</div> : null}

            <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border p-3" style={{ borderColor: BRAND.border, background: "#f9fafb" }}>
              <Field label="Duplicate selected version to" value={duplicateTarget} onChange={setDuplicateTarget} compact />
              <button onClick={duplicateVersion} className="rounded-lg px-3 py-2 text-xs font-semibold text-white" style={{ background: BRAND.dark }}>Duplicate Question Set</button>
            </div>

            <div className="mt-5 overflow-auto rounded-xl border" style={{ borderColor: BRAND.border }}>
              <table className="min-w-full text-sm">
                <thead className="bg-[#f6f8fc]">
                  <tr>
                    <th className="px-3 py-2 text-left">Order</th>
                    <th className="px-3 py-2 text-left">Section</th>
                    <th className="px-3 py-2 text-left">Question</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Req</th>
                    <th className="px-3 py-2 text-left">Active</th>
                    <th className="px-3 py-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleQuestions.map((q) => (
                    <tr key={q.id} className="border-t" style={{ borderColor: BRAND.border }}>
                      <td className="px-3 py-2 font-semibold">{q.order}</td>
                      <td className="px-3 py-2">{q.section}</td>
                      <td className="max-w-md px-3 py-2">
                        <div className="font-semibold">{q.questionText}</div>
                        <div className="mt-1 text-xs" style={{ color: BRAND.greyBlue }}>{q.scoringDimension ?? "No scoring dimension"}</div>
                      </td>
                      <td className="px-3 py-2">{q.responseType}</td>
                      <td className="px-3 py-2">{q.required ? "Yes" : "No"}</td>
                      <td className="px-3 py-2">{q.isActive ? "Active" : "Inactive"}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => startEdit(q)} className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold" style={{ borderColor: BRAND.border }}>Edit</button>
                          <button onClick={() => toggleActive(q)} className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold" style={{ borderColor: BRAND.border }}>{q.isActive ? "Deactivate" : "Activate"}</button>
                          <button onClick={() => remove(q)} className="rounded-lg bg-red-700 px-2 py-1 text-xs font-semibold text-white">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 rounded-2xl border p-4" style={{ borderColor: BRAND.border }}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">Import Questions</div>
                  <div className="mt-1 text-xs" style={{ color: BRAND.greyBlue }}>
                    JSON accepts an array of question objects. CSV headers must be: {PRIORITY_CSV_COLUMNS.join(", ")}
                  </div>
                </div>
                <select value={importFormat} onChange={(e) => setImportFormat(e.target.value as "json" | "csv")} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: BRAND.border }}>
                  <option value="json">JSON</option>
                  <option value="csv">CSV</option>
                </select>
              </div>
              <textarea value={importRaw} onChange={(e) => setImportRaw(e.target.value)} rows={8} className="mt-3 w-full rounded-lg border px-3 py-2 text-xs font-mono" style={{ borderColor: BRAND.border }} placeholder={importFormat === "json" ? "[{...}]" : PRIORITY_CSV_COLUMNS.join(",")} />
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={previewImport} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold" style={{ borderColor: BRAND.border }}>Preview Import</button>
                <button onClick={importQuestions} className="rounded-lg px-3 py-2 text-xs font-semibold text-white" style={{ background: BRAND.dark }}>Import to Version {selectedVersion}</button>
              </div>
              {importPreview ? <div className="mt-3 rounded-lg border p-3 text-xs font-semibold" style={{ borderColor: BRAND.border }}>{importPreview}</div> : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; compact?: boolean }) {
  return (
    <label className={props.compact ? "block" : "block text-sm"}>
      <span className="font-semibold">{props.label}</span>
      <input value={props.value} onChange={(e) => props.onChange(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: BRAND.border }} />
    </label>
  );
}

function TextArea(props: { label: string; value: string; onChange: (v: string) => void; rows: number }) {
  return (
    <label className="block text-sm">
      <span className="font-semibold">{props.label}</span>
      <textarea value={props.value} onChange={(e) => props.onChange(e.target.value)} rows={props.rows} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: BRAND.border }} />
    </label>
  );
}

function Select(props: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="font-semibold">{props.label}</span>
      <select value={props.value} onChange={(e) => props.onChange(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: BRAND.border }}>
        {props.options.map((option) => (
          <option key={option || "blank"} value={option}>
            {option || "None"}
          </option>
        ))}
      </select>
    </label>
  );
}
