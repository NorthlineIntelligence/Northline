"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { NORTHLINE_BRAND as BRAND, NORTHLINE_GLASS_CARD as glassCard, NORTHLINE_SHELL_BG as shellBackground } from "@/lib/northlineBrand";

type Question = {
  id: string;
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
};

type Answer = {
  answerText?: string | null;
  answerNumber?: number | null;
  answerJson?: unknown;
};

export default function PriorityDiscoveryParticipant(props: {
  assessmentId: string;
  participantId: string;
  inviteEmail: string;
  inviteToken: string;
  authQs: string;
  organizationName?: string | null;
}) {
  const router = useRouter();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const sections = useMemo(() => Array.from(new Set(questions.map((q) => q.section))), [questions]);
  const answeredCount = useMemo(() => questions.filter((q) => hasAnswer(answers[q.id])).length, [answers, questions]);
  const completionPct = questions.length ? Math.round((answeredCount / questions.length) * 100) : 0;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setMessage(null);
      const res = await fetch(
        `/api/priority-discovery/questions?assessmentId=${encodeURIComponent(props.assessmentId)}&participantId=${encodeURIComponent(props.participantId)}`,
        { credentials: "include" }
      );
      const json = await res.json().catch(() => null);
      if (cancelled) return;
      if (!res.ok || !json?.ok) {
        setMessage(json?.error ?? `Failed to load assessment (${res.status}).`);
        setLoading(false);
        return;
      }
      setQuestions(json.questions ?? []);
      const nextAnswers: Record<string, Answer> = {};
      for (const response of json.responses ?? []) {
        nextAnswers[response.questionId] = {
          answerText: response.answerText,
          answerNumber: response.answerNumber,
          answerJson: response.answerJson,
        };
      }
      setAnswers(nextAnswers);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [props.assessmentId, props.participantId]);

  function setAnswer(questionId: string, answer: Answer) {
    setAnswers((prev) => ({ ...prev, [questionId]: answer }));
  }

  function buildResponses() {
    return questions.map((q) => ({
      questionId: q.id,
      answerText: answers[q.id]?.answerText ?? null,
      answerNumber: answers[q.id]?.answerNumber ?? null,
      answerJson: answers[q.id]?.answerJson ?? null,
    }));
  }

  async function save(complete: boolean) {
    setSaving(true);
    setMessage(null);

    if (complete) {
      const missing = questions.filter((q) => q.required && !hasAnswer(answers[q.id]));
      if (missing.length) {
        setMessage(`Please answer required questions before submitting. Missing: ${missing.slice(0, 3).map((q) => q.order).join(", ")}${missing.length > 3 ? "..." : ""}`);
        setSaving(false);
        return;
      }
    }

    const res = await fetch("/api/priority-discovery/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        assessmentId: props.assessmentId,
        participantId: props.participantId,
        email: props.inviteEmail,
        token: props.inviteToken,
        complete,
        responses: buildResponses(),
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setMessage(json?.error ?? `Save failed (${res.status}).`);
      setSaving(false);
      return;
    }
    setSaving(false);
    if (complete) {
      router.push(`/assessments/${props.assessmentId}/complete${props.authQs}`);
      return;
    }
    setMessage("Draft saved. You can return to this link and continue.");
  }

  if (loading) {
    return (
      <main style={{ minHeight: "100vh", background: shellBackground, padding: "clamp(20px, 4vw, 40px)", color: BRAND.text }}>
        <div style={{ maxWidth: 920, margin: "0 auto", borderRadius: 20, padding: 28, ...glassCard }}>
          <div style={{ fontWeight: 900, color: BRAND.dark, fontSize: 22 }}>AI Priority Discovery Assessment</div>
          <div style={{ marginTop: 10, color: BRAND.greyBlue }}>Preparing your questions...</div>
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", background: shellBackground, padding: "clamp(20px, 4vw, 40px)", color: BRAND.text }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ position: "sticky", top: 12, zIndex: 10, borderRadius: 20, padding: 22, ...glassCard }}>
          <div style={{ display: "flex", gap: 18, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 320px" }}>
              <div style={{ color: BRAND.greyBlue, fontSize: 12, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Northline Intelligence
              </div>
              <h1 style={{ margin: "8px 0 0", color: BRAND.dark, fontSize: "clamp(1.35rem, 3vw, 1.9rem)", lineHeight: 1.12 }}>
                AI Priority Discovery Assessment
              </h1>
              <div style={{ marginTop: 10, color: BRAND.greyBlue, fontWeight: 700, lineHeight: 1.45 }}>
                {props.organizationName ?? "Your organization"} • Tell us where AI or automation could create real leverage. This is not a test.
              </div>
            </div>
            <div style={{ minWidth: 240 }}>
              <div style={{ display: "flex", justifyContent: "space-between", color: BRAND.greyBlue, fontSize: 12, fontWeight: 900 }}>
                <span>Progress</span>
                <span style={{ color: BRAND.dark }}>{answeredCount}/{questions.length} • {completionPct}%</span>
              </div>
              <div style={{ marginTop: 8, height: 10, borderRadius: 999, overflow: "hidden", background: BRAND.lightAzure }}>
                <div style={{ width: `${completionPct}%`, height: "100%", background: `linear-gradient(90deg, ${BRAND.cyan}, ${BRAND.dark})` }} />
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button disabled={saving} onClick={() => save(false)} style={buttonStyle("secondary", saving)}>Save draft</button>
                <button disabled={saving} onClick={() => save(true)} style={buttonStyle("primary", saving)}>Submit</button>
              </div>
            </div>
          </div>
          {message ? (
            <div style={{ marginTop: 14, border: `1px solid ${BRAND.border}`, borderRadius: 14, padding: 12, background: "#fff", color: message.startsWith("Please") || message.includes("failed") ? "#b42318" : BRAND.dark, fontWeight: 800 }}>
              {message}
            </div>
          ) : null}
        </div>

        <div style={{ marginTop: 24, display: "grid", gap: 22 }}>
          {sections.map((section, sectionIndex) => (
            <section key={section} style={{ borderRadius: 20, padding: 24, background: BRAND.card, border: `1px solid ${BRAND.border}`, boxShadow: "0 12px 40px rgba(23, 52, 100, 0.08)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ color: BRAND.cyan, fontWeight: 900, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>Section {sectionIndex + 1}</div>
                  <h2 style={{ margin: "6px 0 0", color: BRAND.dark, fontSize: 20 }}>{section}</h2>
                </div>
                <div style={{ color: BRAND.greyBlue, fontSize: 12, fontWeight: 800 }}>
                  {questions.filter((q) => q.section === section).length} questions
                </div>
              </div>

              <div style={{ marginTop: 18, display: "grid", gap: 16 }}>
                {questions.filter((q) => q.section === section).map((q) => (
                  <QuestionCard key={q.id} question={q} answer={answers[q.id]} setAnswer={(answer) => setAnswer(q.id, answer)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}

function hasAnswer(answer: Answer | undefined) {
  if (!answer) return false;
  if (typeof answer.answerText === "string" && answer.answerText.trim()) return true;
  if (typeof answer.answerNumber === "number") return true;
  if (Array.isArray(answer.answerJson)) return answer.answerJson.length > 0;
  return Boolean(answer.answerJson);
}

function buttonStyle(kind: "primary" | "secondary", disabled: boolean): CSSProperties {
  return {
    border: kind === "primary" ? "none" : `1px solid ${BRAND.border}`,
    background: disabled ? "#98a2b3" : kind === "primary" ? BRAND.dark : "#fff",
    color: kind === "primary" ? "#fff" : BRAND.dark,
    padding: "10px 14px",
    borderRadius: 12,
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function QuestionCard(props: { question: Question; answer: Answer | undefined; setAnswer: (answer: Answer) => void }) {
  const q = props.question;
  return (
    <div style={{ border: `1px solid ${BRAND.border}`, borderRadius: 18, padding: 18, background: "#fff" }}>
      <div style={{ color: BRAND.dark, fontWeight: 900, lineHeight: 1.45 }}>
        <span style={{ color: BRAND.cyan, marginRight: 8 }}>{q.order}.</span>
        {q.questionText} {q.required ? <span style={{ color: "#b42318" }}>*</span> : null}
      </div>
      {q.questionHelpText ? <div style={{ marginTop: 6, color: BRAND.greyBlue, fontSize: 13, fontWeight: 700 }}>{q.questionHelpText}</div> : null}
      <div style={{ marginTop: 14 }}>
        <QuestionInput question={q} answer={props.answer} setAnswer={props.setAnswer} />
      </div>
    </div>
  );
}

function QuestionInput(props: { question: Question; answer: Answer | undefined; setAnswer: (answer: Answer) => void }) {
  const q = props.question;
  const value = props.answer;

  if (["LIKERT", "CONFIDENCE", "URGENCY"].includes(q.responseType)) {
    const min = q.scaleMin ?? 1;
    const max = q.scaleMax ?? 5;
    return (
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${max - min + 1}, minmax(0, 1fr))`, gap: 10 }}>
        {Array.from({ length: max - min + 1 }, (_, i) => i + min).map((n) => {
          const selected = value?.answerNumber === n;
          return (
            <button key={n} type="button" onClick={() => props.setAnswer({ answerNumber: n })} style={{ border: `2px solid ${selected ? BRAND.cyan : BRAND.border}`, background: selected ? "rgba(52,176,180,0.16)" : "#fff", borderRadius: 14, padding: 12, cursor: "pointer", fontWeight: 900, color: BRAND.dark }}>
              <div>{n}</div>
              <div style={{ marginTop: 4, color: BRAND.greyBlue, fontSize: 11 }}>{q.scaleLabels?.[String(n)] ?? ""}</div>
            </button>
          );
        })}
      </div>
    );
  }

  if (q.responseType === "MULTI_SELECT") {
    const selected = Array.isArray(value?.answerJson) ? value?.answerJson.map(String) : [];
    return (
      <div style={{ display: "grid", gap: 8 }}>
        {q.options.map((option) => (
          <label key={option} style={choiceStyle}>
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={(e) => {
                const next = e.target.checked ? [...selected, option] : selected.filter((item) => item !== option);
                props.setAnswer({ answerJson: next });
              }}
            />
            {option}
          </label>
        ))}
      </div>
    );
  }

  if (q.responseType === "FORCED_CHOICE" || q.responseType === "DEPARTMENT") {
    return (
      <div style={{ display: "grid", gap: 8 }}>
        {q.options.map((option) => (
          <label key={option} style={choiceStyle}>
            <input
              type="radio"
              name={q.id}
              checked={value?.answerText === option}
              onChange={() => props.setAnswer({ answerText: option })}
            />
            {option}
          </label>
        ))}
      </div>
    );
  }

  if (q.responseType === "RANKING") {
    const current = Array.isArray(value?.answerJson) && value.answerJson.length ? value.answerJson.map(String) : q.options;
    function move(index: number, dir: -1 | 1) {
      const next = [...current];
      const target = index + dir;
      if (target < 0 || target >= next.length) return;
      [next[index], next[target]] = [next[target], next[index]];
      props.setAnswer({ answerJson: next });
    }
    return (
      <div style={{ display: "grid", gap: 8 }}>
        {current.map((option, index) => (
          <div key={option} style={{ ...choiceStyle, justifyContent: "space-between" }}>
            <span><b>{index + 1}.</b> {option}</span>
            <span style={{ display: "inline-flex", gap: 6 }}>
              <button type="button" onClick={() => move(index, -1)} style={miniButton}>Up</button>
              <button type="button" onClick={() => move(index, 1)} style={miniButton}>Down</button>
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <textarea
      value={value?.answerText ?? ""}
      onChange={(e) => props.setAnswer({ answerText: e.target.value })}
      rows={4}
      style={{ width: "100%", borderRadius: 14, border: `1px solid ${BRAND.border}`, padding: 14, font: "inherit", resize: "vertical" }}
      placeholder="Share what you are seeing. Short bullets are welcome."
    />
  );
}

const choiceStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  border: `1px solid ${BRAND.border}`,
  borderRadius: 14,
  padding: "10px 12px",
  background: "#fff",
  color: BRAND.dark,
  fontWeight: 800,
};

const miniButton: CSSProperties = {
  border: `1px solid ${BRAND.border}`,
  background: "#fff",
  color: BRAND.dark,
  borderRadius: 8,
  padding: "4px 8px",
  fontWeight: 800,
  cursor: "pointer",
};
