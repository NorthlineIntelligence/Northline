"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { NORTHLINE_BRAND as BRAND } from "@/lib/northlineBrand";

type PriorityQuestion = {
  id: string;
  section: string;
  questionText: string;
  questionHelpText: string | null;
  responseType: string;
  required: boolean;
  order: number;
  isActive: boolean;
};

type AssessmentPriorityQuestionsEditorProps = {
  assessmentId: string;
};

export function AssessmentPriorityQuestionsEditor(props: AssessmentPriorityQuestionsEditorProps) {
  const [questions, setQuestions] = useState<PriorityQuestion[]>([]);
  const [usesCustomQuestions, setUsesCustomQuestions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Partial<PriorityQuestion>>>({});

  const sections = useMemo(() => {
    const grouped = new Map<string, PriorityQuestion[]>();
    for (const q of questions) {
      const list = grouped.get(q.section) ?? [];
      list.push(q);
      grouped.set(q.section, list);
    }
    return Array.from(grouped.entries()).map(([section, items]) => ({
      section,
      items: items.sort((a, b) => a.order - b.order),
    }));
  }, [questions]);

  async function load() {
    setLoading(true);
    setMessage(null);
    const res = await fetch(`/api/admin/assessments/${props.assessmentId}/priority-questions`, {
      credentials: "include",
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setMessage(json?.error ?? `Failed to load questions (${res.status}).`);
      setLoading(false);
      return;
    }
    setQuestions(json.questions ?? []);
    setUsesCustomQuestions(Boolean(json.usesCustomQuestions));
    setDrafts({});
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.assessmentId]);

  async function initializeQuestions() {
    setInitializing(true);
    setMessage(null);
    const res = await fetch(`/api/admin/assessments/${props.assessmentId}/priority-questions`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "initialize", source: { type: "default" } }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setMessage(json?.error ?? `Initialize failed (${res.status}).`);
      setInitializing(false);
      return;
    }
    setMessage(`Initialized ${json.count ?? 0} questions for this assessment.`);
    setInitializing(false);
    await load();
  }

  function questionValue(question: PriorityQuestion): PriorityQuestion {
    return { ...question, ...(drafts[question.id] ?? {}) };
  }

  function updateDraft(questionId: string, patch: Partial<PriorityQuestion>) {
    setDrafts((prev) => ({ ...prev, [questionId]: { ...(prev[questionId] ?? {}), ...patch } }));
  }

  async function saveQuestion(questionId: string) {
    const draft = drafts[questionId];
    if (!draft) return;

    setSavingId(questionId);
    setMessage(null);
    const res = await fetch(`/api/admin/assessments/${props.assessmentId}/priority-questions`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: questionId,
        question: {
          ...(draft.section !== undefined ? { section: draft.section } : {}),
          ...(draft.questionText !== undefined ? { questionText: draft.questionText } : {}),
          ...(draft.questionHelpText !== undefined ? { questionHelpText: draft.questionHelpText } : {}),
          ...(draft.required !== undefined ? { required: draft.required } : {}),
          ...(draft.order !== undefined ? { order: draft.order } : {}),
          ...(draft.isActive !== undefined ? { isActive: draft.isActive } : {}),
        },
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setMessage(json?.error ?? `Save failed (${res.status}).`);
      setSavingId(null);
      return;
    }
    setSavingId(null);
    setMessage("Question saved.");
    await load();
  }

  async function deactivateQuestion(questionId: string) {
    if (!window.confirm("Deactivate this question for this assessment?")) return;
    setSavingId(questionId);
    const res = await fetch(
      `/api/admin/assessments/${props.assessmentId}/priority-questions?questionId=${encodeURIComponent(questionId)}`,
      { method: "DELETE", credentials: "include" }
    );
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setMessage(json?.error ?? `Deactivate failed (${res.status}).`);
      setSavingId(null);
      return;
    }
    setSavingId(null);
    setMessage("Question deactivated.");
    await load();
  }

  const activeCount = questions.filter((q) => q.isActive).length;

  return (
    <section className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BRAND.border }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.14em]" style={{ color: BRAND.cyan }}>
            Assessment question set
          </div>
          <h2 className="mt-2 text-xl font-semibold" style={{ color: BRAND.dark }}>
            Customize Questions Before Send
          </h2>
          <p className="mt-1 text-sm" style={{ color: BRAND.greyBlue }}>
            Edit this assessment&apos;s question set without changing the global Priority Discovery bank.
            {usesCustomQuestions ? ` ${activeCount} active questions.` : " No custom question set yet."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!usesCustomQuestions ? (
            <button
              type="button"
              onClick={initializeQuestions}
              disabled={initializing}
              className="rounded-lg px-3 py-2 text-xs font-semibold text-white"
              style={{ background: initializing ? "#98a2b3" : BRAND.dark }}
            >
              {initializing ? "Copying…" : "Copy Default Questions"}
            </button>
          ) : null}
          <Link
            href="/admin/priority-discovery/questions"
            className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold"
            style={{ borderColor: BRAND.border, color: BRAND.dark }}
          >
            Global Question Bank
          </Link>
        </div>
      </div>

      {message ? (
        <div className="mt-4 rounded-xl border px-4 py-3 text-sm font-semibold" style={{ borderColor: BRAND.border }}>
          {message}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-4 text-sm" style={{ color: BRAND.greyBlue }}>Loading questions…</div>
      ) : !usesCustomQuestions ? (
        <div className="mt-4 rounded-xl border border-dashed p-5 text-sm" style={{ borderColor: BRAND.border, color: BRAND.greyBlue }}>
          This assessment is still using the shared global question bank. Copy questions here to create a phase-specific version you can edit before inviting participants.
        </div>
      ) : (
        <div className="mt-4 grid gap-5">
          {sections.map(({ section, items }) => (
            <div key={section}>
              <h3 className="text-sm font-black uppercase tracking-[0.1em]" style={{ color: BRAND.greyBlue }}>
                {section}
              </h3>
              <div className="mt-3 grid gap-3">
                {items.map((question) => {
                  const value = questionValue(question);
                  const hasDraft = Boolean(drafts[question.id]);
                  return (
                    <div
                      key={question.id}
                      className="rounded-xl border p-4"
                      style={{
                        borderColor: value.isActive ? BRAND.border : "#FECDCA",
                        background: value.isActive ? "#FFFFFF" : "#FFFBFA",
                        opacity: value.isActive ? 1 : 0.85,
                      }}
                    >
                      <div className="flex flex-wrap items-center justify-between gap--2">
                        <div className="text-xs font-black uppercase tracking-[0.08em]" style={{ color: BRAND.cyan }}>
                          #{value.order} • {value.responseType}{value.required ? " • Required" : ""}
                          {!value.isActive ? " • Inactive" : ""}
                        </div>
                        <div className="flex gap-2">
                          {hasDraft ? (
                            <button
                              type="button"
                              onClick={() => saveQuestion(question.id)}
                              disabled={savingId === question.id}
                              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
                              style={{ background: savingId === question.id ? "#98a2b3" : BRAND.dark }}
                            >
                              {savingId === question.id ? "Saving…" : "Save"}
                            </button>
                          ) : null}
                          {value.isActive ? (
                            <button
                              type="button"
                              onClick={() => deactivateQuestion(question.id)}
                              disabled={savingId === question.id}
                              className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
                              style={{ borderColor: "#FECDCA", color: "#B42318" }}
                            >
                              Deactivate
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <textarea
                        value={value.questionText}
                        onChange={(e) => updateDraft(question.id, { questionText: e.target.value })}
                        rows={3}
                        className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: BRAND.border }}
                      />
                      <textarea
                        value={value.questionHelpText ?? ""}
                        onChange={(e) => updateDraft(question.id, { questionHelpText: e.target.value || null })}
                        rows={2}
                        placeholder="Help text (optional)"
                        className="mt-2 w-full rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: BRAND.border }}
                      />
                      <div className="mt-2 flex flex-wrap gap-4 text-xs font-semibold" style={{ color: BRAND.greyBlue }}>
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={value.required}
                            onChange={(e) => updateDraft(question.id, { required: e.target.checked })}
                          />
                          Required
                        </label>
                        <label className="inline-flex items-center gap-2">
                          Order
                          <input
                            type="number"
                            value={value.order}
                            onChange={(e) => updateDraft(question.id, { order: Number(e.target.value) })}
                            className="w-20 rounded border px-2 py-1"
                            style={{ borderColor: BRAND.border }}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
