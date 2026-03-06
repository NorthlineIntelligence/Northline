"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

type Pillar =
  | "SYSTEM_INTEGRITY"
  | "HUMAN_ALIGNMENT"
  | "STRATEGIC_COHERENCE"
  | "SUSTAINABILITY_PRACTICE";

type Question = {
  id: string;
  pillar: Pillar;
  question_text: string;
  display_order: number;
  weight: number;
  version: string;
};
type Department =
  | "ALL"
  | "SALES"
  | "MARKETING"
  | "CUSTOMER_SUCCESS"
  | "OPS"
  | "REVOPS"
  | "GTM";

type AssessmentMeta = {
  id: string;
  name: string | null;
  locked_department: Department | null;
  organization?: {
    id: string;
    name: string | null;
  } | null;
};

type QuestionsResponse = {
  version: string;
  active: boolean;
  pillars: Record<Pillar, Question[]>;
};

function prettyPillar(p: Pillar) {
  switch (p) {
    case "SYSTEM_INTEGRITY":
      return "System Integrity";
    case "HUMAN_ALIGNMENT":
      return "Human Alignment";
    case "STRATEGIC_COHERENCE":
      return "Strategic Coherence";
    case "SUSTAINABILITY_PRACTICE":
      return "Sustainability Practice";
    default:
      return p;
  }
}

const pillarsOrder: Pillar[] = [
  "SYSTEM_INTEGRITY",
  "HUMAN_ALIGNMENT",
  "STRATEGIC_COHERENCE",
  "SUSTAINABILITY_PRACTICE",
];

const LIKERT: Array<{ value: 1 | 2 | 3 | 4 | 5; label: string }> = [
  { value: 1, label: "Strongly Disagree" },
  { value: 2, label: "Disagree" },
  { value: 3, label: "Neutral" },
  { value: 4, label: "Agree" },
  { value: 5, label: "Strongly Agree" },
];

const BRAND = {
  dark: "#173464",
  cyan: "#34b0b4",
  greyBlue: "#66819e",
  bg: "#F6F8FC",
  card: "#FFFFFF",
  border: "#E6EAF2",
  text: "#0B1220",
  muted: "#4B5565",
};

function RadarChart({
  data,
  size = 320,
}: {
  data: Array<{ label: string; value: number; color?: string }>;
  size?: number;
}) {
  const center = size / 2;
  const radius = size / 2 - 40;
  const levels = 5;
  const angleStep = (Math.PI * 2) / data.length;

  const points = data.map((d, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const r = (d.value / 5) * radius;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
    };
  });

  const polygonPoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <svg width={size} height={size}>
      {[...Array(levels)].map((_, level) => {
        const r = ((level + 1) / levels) * radius;
        const gridPoints = data.map((_, i) => {
          const angle = i * angleStep - Math.PI / 2;
          return {
            x: center + r * Math.cos(angle),
            y: center + r * Math.sin(angle),
          };
        });
        return (
          <polygon
            key={level}
            points={gridPoints.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="#E6EAF2"
            strokeWidth="1"
          />
        );
      })}

      <polygon
        points={polygonPoints}
        fill="rgba(23, 52, 100, 0.15)"
        stroke="#173464"
        strokeWidth="2"
      />

      {data.map((d, i) => {
        const angle = i * angleStep - Math.PI / 2;
        const labelRadius = radius + 20;
        return (
          <text
            key={d.label}
            x={center + labelRadius * Math.cos(angle)}
            y={center + labelRadius * Math.sin(angle)}
            textAnchor="middle"
            fontSize="11"
            fill="#173464"
            fontWeight="700"
          >
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}

function clampText(s: string, max = 120) {
  const t = (s ?? "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

function safeLower(s: string) {
  return (s ?? "").trim().toLowerCase();
}

function safeTrim(s: string) {
  return (s ?? "").trim();
}

export default function AssessmentTakePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const assessmentId =
    typeof params?.id === "string" && params.id.length > 0 ? params.id : null;

  const [loading, setLoading] = useState(true);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [participantDept, setParticipantDept] = useState<Department | null>(null);
  const [assessmentMeta, setAssessmentMeta] = useState<AssessmentMeta | null>(null);

  const [questions, setQuestions] = useState<QuestionsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [aiUseCase, setAiUseCase] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);

  // for hover styling per question/option
  const [hover, setHover] = useState<{ qid: string; value: number } | null>(null);

  // --- Invite auth handling (belt + suspenders)
  // Read from URL first; if missing, fall back to sessionStorage.
  const inviteEmail = useMemo(() => {
    const urlEmail = safeLower(searchParams?.get("email") ?? "");
    if (urlEmail) return urlEmail;

    if (typeof window === "undefined") return "";
    try {
      return safeLower(window.sessionStorage.getItem("invite_email") ?? "");
    } catch {
      return "";
    }
  }, [searchParams]);

  const inviteToken = useMemo(() => {
    const urlToken = safeTrim(searchParams?.get("token") ?? "");
    if (urlToken) return urlToken;

    if (typeof window === "undefined") return "";
    try {
      return safeTrim(window.sessionStorage.getItem("invite_token") ?? "");
    } catch {
      return "";
    }
  }, [searchParams]);

  // Persist invite params when present in URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (inviteEmail) window.sessionStorage.setItem("invite_email", inviteEmail);
      if (inviteToken) window.sessionStorage.setItem("invite_token", inviteToken);
    } catch {}
  }, [inviteEmail, inviteToken]);

  // Shared querystring for links + API calls that support invite auth
  const authQs = useMemo(() => {
    const qs = new URLSearchParams();
    if (inviteEmail) qs.set("email", inviteEmail);
    if (inviteToken) qs.set("token", inviteToken);
    const s = qs.toString();
    return s ? `?${s}` : "";
  }, [inviteEmail, inviteToken]);

  const allQuestionsFlat = useMemo(() => {
    if (!questions) return [];
    const pillars = questions.pillars;
    return (Object.keys(pillars) as Pillar[]).flatMap((p) => pillars[p] ?? []);
  }, [questions]);

  const answeredCount = useMemo(() => {
    return allQuestionsFlat.reduce((acc, q) => acc + (scores[q.id] ? 1 : 0), 0);
  }, [allQuestionsFlat, scores]);

  const completionPct = useMemo(() => {
    const total = allQuestionsFlat.length;
    if (total === 0) return 0;
    return Math.round((answeredCount / total) * 100);
  }, [answeredCount, allQuestionsFlat.length]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      setSubmitResult(null);

      if (!assessmentId) {
        setLoadError("Missing assessment id in route. Ensure URL is /assessments/<UUID>.");
        setLoading(false);
        return;
      }

      try {
        // Ensure participant (invite link auth: email + token)
        const ensureRes = await fetch(`/api/assessments/${assessmentId}/participant`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            email: inviteEmail,
            token: inviteToken,
          }),
        });

        if (ensureRes.status === 401) {
          if (inviteEmail && inviteToken) {
            setLoadError(
              "Unauthorized. Your invite link is invalid or expired. Ask your admin to resend the invite."
            );
            setLoading(false);
            return;
          }

          setLoadError("Unauthorized. This link is missing your email or token. Ask your admin to resend the invite.");
          setLoading(false);
          return;
        }

        const ensureJson = await ensureRes.json().catch(() => null);
        if (ensureRes.ok && ensureJson?.ok) {
          if (!cancelled) {
            setParticipantId(ensureJson.participant.id);
            setParticipantDept(ensureJson.participant.department ?? null);
          }
        } else {
          if (!cancelled) {
            setLoadError(
              ensureJson?.error ??
                ensureJson?.message ??
                `Failed to initialize participant (${ensureRes.status}).`
            );
            setLoading(false);
          }
          return;
        }

        const pid = ensureJson.participant.id as string;

        // Load assessment meta (optional). This endpoint may require session; ignore 401.
        const metaUrl = new URL(`/api/assessments/${assessmentId}`, window.location.origin);
        if (inviteEmail) metaUrl.searchParams.set("email", inviteEmail);
        if (inviteToken) metaUrl.searchParams.set("token", inviteToken);

        const metaRes = await fetch(metaUrl.toString(), {
          method: "GET",
          credentials: "include",
        });

        if (!metaRes.ok) {
          if (metaRes.status !== 401) {
            const txt = await metaRes.text();
            if (!cancelled) {
              setLoadError(`Failed to load assessment metadata: ${metaRes.status} ${txt}`);
              setLoading(false);
            }
            return;
          }
        } else {
          const metaJson = await metaRes.json().catch(() => null);
          if (!cancelled) setAssessmentMeta(metaJson?.assessment ?? null);
        }

        // Load questions
        const qUrl = new URL("/api/questions", window.location.origin);
        qUrl.searchParams.set("active", "true");
        qUrl.searchParams.set("version", "1");
        qUrl.searchParams.set("assessmentId", assessmentId);
        qUrl.searchParams.set("participantId", pid);

        const qRes = await fetch(qUrl.toString(), {
          method: "GET",
          credentials: "include",
        });

        if (!qRes.ok) {
          const txt = await qRes.text();
          if (!cancelled) {
            setLoadError(`Failed to load questions: ${qRes.status} ${txt}`);
            setLoading(false);
          }
          return;
        }

        const qJson = (await qRes.json()) as QuestionsResponse;
        if (!cancelled) {
          setQuestions(qJson);
          setLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setLoadError(e?.message ?? String(e));
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [assessmentId, inviteEmail, inviteToken]);

  async function submit() {
    if (!assessmentId || !participantId) return;

    const payloadResponses = allQuestionsFlat
      .filter((q) => typeof scores[q.id] === "number")
      .map((q, index) => ({
        question_id: q.id,
        score: scores[q.id],
        // Store the single free text once until we introduce a dedicated field/model
        free_write: index === 0 ? aiUseCase.trim() || undefined : undefined,
      }));

    if (payloadResponses.length === 0) {
      setSubmitResult("Please answer at least 1 question before submitting.");
      return;
    }

    setSubmitting(true);
    setSubmitResult(null);

    const res = await fetch(`/api/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        assessment_id: assessmentId,
        participant_id: participantId,
        email: inviteEmail,
        token: inviteToken,
        responses: payloadResponses,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const dup = (json as any)?.duplicateQuestionIds;
      setSubmitResult(
        `Error (${res.status}): ${(json as any)?.error ?? "Submit failed."}` +
          (Array.isArray(dup) && dup.length ? ` Duplicates: ${dup.join(", ")}` : "")
      );
      setSubmitting(false);
      return;
    }

    setSubmitting(false);

    // Always carry auth params forward to completion page
    router.push(`/assessments/${assessmentId}/complete${authQs}`);
  }

  if (loading) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: BRAND.bg,
          padding: 32,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto",
          color: BRAND.text,
        }}
      >
        <div
          style={{
            maxWidth: 980,
            margin: "0 auto",
            background: BRAND.card,
            border: `1px solid ${BRAND.border}`,
            borderRadius: 16,
            padding: 24,
            boxShadow: "0 8px 30px rgba(15, 23, 42, 0.06)",
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 900, color: BRAND.dark }}>Northline AI Readiness</div>
          <div style={{ color: BRAND.muted, marginTop: 6 }}>Loading assessment…</div>
        </div>
      </main>
    );
  }

  if (loadError) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: BRAND.bg,
          padding: 32,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto",
          color: BRAND.text,
        }}
      >
        <div
          style={{
            maxWidth: 980,
            margin: "0 auto",
            background: BRAND.card,
            border: `1px solid ${BRAND.border}`,
            borderRadius: 16,
            padding: 24,
            boxShadow: "0 8px 30px rgba(15, 23, 42, 0.06)",
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 900, color: BRAND.dark }}>Northline AI Readiness</div>
          <div style={{ marginTop: 12, color: "#b42318", fontWeight: 700 }}>{loadError}</div>
          <div style={{ marginTop: 10, color: BRAND.muted }}>
            If this is a dev environment, we’ll add an end-user login UI next.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: BRAND.bg,
        padding: 32,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto",
        color: BRAND.text,
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        {/* Header card */}
        <div
          style={{
            background: BRAND.card,
            border: `1px solid ${BRAND.border}`,
            borderRadius: 16,
            padding: 20,
            boxShadow: "0 8px 30px rgba(15, 23, 42, 0.06)",
            position: "sticky",
            top: 16,
            zIndex: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 280px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: BRAND.dark }}>Northline AI Readiness</div>

              <div style={{ marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    color: BRAND.dark,
                    background: "#F3F4F6",
                    border: `1px solid ${BRAND.border}`,
                    padding: "4px 10px",
                    borderRadius: 999,
                  }}
                >
                  {assessmentMeta?.organization?.name ?? "Org Name Unavailable"}
                </span>
              </div>

              <div style={{ marginTop: 6, color: BRAND.muted }}>
                Answer honestly. This is diagnostic, not performative.
              </div>

              {/* Helpful: show if invite auth is missing */}
              {!inviteEmail || !inviteToken ? (
                <div style={{ marginTop: 8, color: "#b42318", fontWeight: 800, fontSize: 12 }}>
                  This page is missing your invite email/token. Ask your admin to resend the invite link.
                </div>
              ) : null}
            </div>

            <div style={{ minWidth: 240 }}>
              <div style={{ display: "flex", justifyContent: "space-between", color: BRAND.muted, fontSize: 13 }}>
                <span>Progress</span>
                <span>
                  {answeredCount}/{allQuestionsFlat.length} ({completionPct}%)
                </span>
              </div>
              <div
                style={{
                  height: 10,
                  borderRadius: 999,
                  background: "#E9EEF7",
                  overflow: "hidden",
                  marginTop: 6,
                }}
              >
                <div
                  style={{
                    width: `${completionPct}%`,
                    height: "100%",
                    background: BRAND.cyan,
                  }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button
                onClick={submit}
                disabled={submitting}
                style={{
                  background: submitting ? "#98a2b3" : BRAND.dark,
                  color: "white",
                  border: "none",
                  padding: "10px 14px",
                  borderRadius: 12,
                  fontWeight: 800,
                  cursor: submitting ? "not-allowed" : "pointer",
                }}
              >
                {submitting ? "Submitting…" : "Submit"}
              </button>

              
              
            </div>
          </div>

          {submitResult && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 12,
                border: `1px solid ${BRAND.border}`,
                background: "#F9FAFB",
                color: BRAND.text,
                fontWeight: 600,
              }}
            >
              {submitResult}
            </div>
          )}
        </div>

        {/* Questions */}
        <div style={{ marginTop: 18, display: "grid", gap: 18 }}>
          {questions &&
            pillarsOrder.map((pillar) => {
              const qs = questions.pillars[pillar] ?? [];
              if (qs.length === 0) return null;

              return (
                <section
                  key={pillar}
                  style={{
                    background: BRAND.card,
                    border: `1px solid ${BRAND.border}`,
                    borderRadius: 16,
                    padding: 20,
                    boxShadow: "0 8px 30px rgba(15, 23, 42, 0.04)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                      marginBottom: 12,
                    }}
                  >
                    <h2 style={{ margin: 0, color: BRAND.dark, fontSize: 18, fontWeight: 900 }}>
                      {prettyPillar(pillar)}
                    </h2>
                    <div style={{ color: BRAND.muted, fontSize: 13 }}>
                      {qs.length} question{qs.length === 1 ? "" : "s"}
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 16 }}>
                    {qs.map((q) => {
                      const selected = scores[q.id] ?? null;

                      return (
                        <div
                          key={q.id}
                          style={{
                            border: `1px solid ${BRAND.border}`,
                            borderRadius: 14,
                            padding: 18,
                            background: "#FFFFFF",
                          }}
                        >
                          {/* Centered question */}
                          <div
                            style={{
                              textAlign: "center",
                              color: BRAND.dark,
                              fontWeight: 900,
                              fontSize: 16,
                              lineHeight: 1.35,
                              marginBottom: 14,
                            }}
                          >
                            {q.display_order}. {q.question_text}
                          </div>

                          {/* Likert scale */}
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                              gap: 12,
                              alignItems: "start",
                              maxWidth: 780,
                              margin: "0 auto",
                            }}
                          >
                            {LIKERT.map((opt) => {
                              const isSelected = selected === opt.value;
                              const isHover = hover?.qid === q.id && hover?.value === opt.value;

                              const bg = isSelected ? BRAND.cyan : isHover ? "#EAF3FF" : "#FFFFFF";

                              const border = isSelected ? BRAND.cyan : isHover ? BRAND.dark : "#D7DEEA";

                              const numColor = BRAND.dark;
                              const labelColor = isSelected ? BRAND.dark : BRAND.muted;

                              return (
                                <button
                                  key={opt.value}
                                  onClick={() => setScores((prev) => ({ ...prev, [q.id]: opt.value }))}
                                  onMouseEnter={() => setHover({ qid: q.id, value: opt.value })}
                                  onMouseLeave={() => setHover(null)}
                                  style={{
                                    width: "100%",
                                    borderRadius: 14,
                                    border: `1px solid ${border}`,
                                    background: bg,
                                    padding: "12px 10px",
                                    cursor: "pointer",
                                    boxShadow: isSelected ? "0 10px 24px rgba(52, 176, 180, 0.18)" : "none",
                                    transition:
                                      "background 120ms ease, border 120ms ease, transform 120ms ease, box-shadow 120ms ease",
                                    transform: isHover ? "translateY(-1px)" : "translateY(0)",
                                    textAlign: "center",
                                  }}
                                  aria-pressed={isSelected}
                                >
                                  <div
                                    style={{
                                      fontWeight: 900,
                                      fontSize: 18,
                                      color: numColor,
                                      lineHeight: 1,
                                      marginBottom: 8,
                                    }}
                                  >
                                    {opt.value}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 700,
                                      color: isHover ? BRAND.dark : labelColor,
                                      whiteSpace: "normal",
                                      lineHeight: 1.2,
                                    }}
                                  >
                                    {opt.label}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}

          {/* Single free-text use case */}
          <section
            style={{
              background: BRAND.card,
              border: `1px solid ${BRAND.border}`,
              borderRadius: 16,
              padding: 20,
              boxShadow: "0 8px 30px rgba(15, 23, 42, 0.04)",
            }}
          >
            <h2 style={{ margin: 0, color: BRAND.dark, fontSize: 18, fontWeight: 900 }}>
              Best Use Case for AI Automation
            </h2>
            <div style={{ color: BRAND.muted, marginTop: 6 }}>
              In your own words, what would create the most leverage right now?
            </div>

            <textarea
              value={aiUseCase}
              onChange={(e) => setAiUseCase(e.target.value)}
              rows={4}
              style={{
                width: "100%",
                marginTop: 12,
                border: `1px solid ${BRAND.border}`,
                borderRadius: 14,
                padding: 12,
                fontSize: 14,
                fontFamily: "inherit",
                outline: "none",
                boxShadow: "0 1px 0 rgba(15, 23, 42, 0.04) inset",
              }}
              placeholder="Example: automate client onboarding, generate first-draft SOPs, sales follow-ups, internal reporting, support ticket triage…"
            />
            <div style={{ marginTop: 6, color: BRAND.muted, fontSize: 12 }}>{aiUseCase.length}/5000</div>
          </section>
        </div>
      </div>
    </main>
  );
}