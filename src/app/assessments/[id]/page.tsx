"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Montserrat, Open_Sans } from "next/font/google";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  display: "swap",
});

const openSans = Open_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

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

/** Northline Intelligence brand (aligned with official guide) */
const BRAND = {
  dark: "#173464",
  cyan: "#34b0b4",
  greyBlue: "#66819e",
  lightAzure: "#cdd8df",
  lightBlue: "#fcfcfe",
  bg: "#fcfcfe",
  card: "#FFFFFF",
  border: "#E6EAF2",
  text: "#0B1220",
  muted: "#4B5565",
  surfaceMuted: "#f3f6fb",
};

function BrandWordmark() {
  return (
    <div aria-label="Northline Intelligence" style={{ lineHeight: 1.2 }}>
      <div
        style={{
          fontFamily: montserrat.style.fontFamily,
          fontWeight: 800,
          fontSize: 11,
          letterSpacing: "0.12em",
          color: BRAND.dark,
          textTransform: "uppercase",
        }}
      >
        Northline
      </div>
      <div
        style={{
          fontFamily: openSans.style.fontFamily,
          fontWeight: 700,
          fontSize: 9,
          letterSpacing: "0.2em",
          color: BRAND.greyBlue,
          textTransform: "uppercase",
          marginTop: 3,
        }}
      >
        Intelligence
      </div>
    </div>
  );
}

const shellBackground = `radial-gradient(ellipse 100% 80% at 100% -10%, rgba(52, 176, 180, 0.11) 0%, transparent 55%),
  radial-gradient(ellipse 80% 60% at -5% 100%, rgba(23, 52, 100, 0.08) 0%, transparent 48%),
  ${BRAND.lightBlue}`;

const glassCard = {
  background: "rgba(255, 255, 255, 0.9)",
  backdropFilter: "saturate(160%) blur(14px)",
  WebkitBackdropFilter: "saturate(160%) blur(14px)",
  border: `1px solid rgba(205, 216, 223, 0.65)`,
  boxShadow: "0 4px 28px rgba(23, 52, 100, 0.07), 0 1px 2px rgba(15, 23, 42, 0.04)",
} as const;

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
            stroke="#cdd8df"
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
      <>
        <style>{`
          @keyframes nl-pulse {
            0%, 100% { opacity: 0.45; }
            50% { opacity: 1; }
          }
        `}</style>
        <main
          style={{
            minHeight: "100vh",
            background: shellBackground,
            padding: "clamp(20px, 4vw, 40px)",
            fontFamily: openSans.style.fontFamily,
            color: BRAND.text,
          }}
        >
          <div
            style={{
              maxWidth: 980,
              margin: "0 auto",
              borderRadius: 20,
              padding: 28,
              ...glassCard,
            }}
          >
            <BrandWordmark />
            <div
              style={{
                marginTop: 16,
                fontFamily: montserrat.style.fontFamily,
                fontSize: 20,
                fontWeight: 800,
                color: BRAND.dark,
                letterSpacing: "-0.02em",
              }}
            >
              AI Readiness Diagnostic
            </div>
            <div
              style={{
                marginTop: 12,
                color: BRAND.greyBlue,
                fontWeight: 600,
                fontSize: 14,
                animation: "nl-pulse 1.4s ease-in-out infinite",
              }}
            >
              Preparing your assessment…
            </div>
            <div
              style={{
                marginTop: 20,
                height: 3,
                borderRadius: 999,
                background: BRAND.lightAzure,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: "38%",
                  height: "100%",
                  background: `linear-gradient(90deg, ${BRAND.cyan}, ${BRAND.dark})`,
                  borderRadius: 999,
                  animation: "nl-pulse 1.1s ease-in-out infinite",
                }}
              />
            </div>
          </div>
        </main>
      </>
    );
  }

  if (loadError) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: shellBackground,
          padding: "clamp(20px, 4vw, 40px)",
          fontFamily: openSans.style.fontFamily,
          color: BRAND.text,
        }}
      >
        <div
          style={{
            maxWidth: 980,
            margin: "0 auto",
            borderRadius: 20,
            padding: 28,
            ...glassCard,
          }}
        >
          <BrandWordmark />
          <div
            style={{
              marginTop: 14,
              fontFamily: montserrat.style.fontFamily,
              fontSize: 20,
              fontWeight: 800,
              color: BRAND.dark,
            }}
          >
            AI Readiness Diagnostic
          </div>
          <div
            style={{
              marginTop: 16,
              padding: 16,
            borderRadius: 14,
            background: "#FFF5F5",
            border: "1px solid #FECACA",
            color: "#991B1B",
            fontWeight: 600,
            lineHeight: 1.5,
            }}
          >
            {loadError}
          </div>
          <div style={{ marginTop: 14, color: BRAND.greyBlue, fontSize: 14, fontWeight: 500, lineHeight: 1.45 }}>
            If this is a dev environment, we’ll add an end-user login UI next.
          </div>
        </div>
      </main>
    );
  }

  return (
    <>
      <style>{`
        .nl-assess-focus:focus {
          outline: none;
          border-color: ${BRAND.cyan} !important;
          box-shadow: 0 0 0 3px rgba(52, 176, 180, 0.28);
        }
      `}</style>
      <main
        style={{
          minHeight: "100vh",
          background: shellBackground,
          padding: "clamp(20px, 4vw, 40px)",
          fontFamily: openSans.style.fontFamily,
          color: BRAND.text,
        }}
      >
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        {/* Header card */}
        <div
          style={{
            ...glassCard,
            borderRadius: 20,
            padding: "22px 24px",
            position: "sticky",
            top: 14,
            zIndex: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 18, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 280px" }}>
              <BrandWordmark />
              <div
                style={{
                  marginTop: 12,
                  fontFamily: montserrat.style.fontFamily,
                  fontSize: "clamp(1.15rem, 2.5vw, 1.45rem)",
                  fontWeight: 800,
                  color: BRAND.dark,
                  letterSpacing: "-0.02em",
                  lineHeight: 1.2,
                }}
              >
                AI Readiness Diagnostic
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: BRAND.dark,
                    background: BRAND.surfaceMuted,
                    border: `1px solid ${BRAND.lightAzure}`,
                    padding: "6px 12px",
                    borderRadius: 999,
                    letterSpacing: "0.02em",
                  }}
                >
                  {assessmentMeta?.organization?.name ?? "Organization"}
                </span>
              </div>

              <div style={{ marginTop: 10, color: BRAND.greyBlue, fontSize: 14, fontWeight: 500, lineHeight: 1.45 }}>
                Answer honestly. This is diagnostic, not performative.
              </div>

              {!inviteEmail || !inviteToken ? (
                <div
                  style={{
                    marginTop: 10,
                    color: "#b42318",
                    fontWeight: 700,
                    fontSize: 12,
                    lineHeight: 1.4,
                  }}
                >
                  This page is missing your invite email/token. Ask your admin to resend the invite link.
                </div>
              ) : null}
            </div>

            <div style={{ minWidth: 220, flex: "1 1 200px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  color: BRAND.greyBlue,
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                <span>Progress</span>
                <span style={{ color: BRAND.dark }}>
                  {answeredCount}/{allQuestionsFlat.length} · {completionPct}%
                </span>
              </div>
              <div
                style={{
                  height: 8,
                  borderRadius: 999,
                  background: BRAND.lightAzure,
                  overflow: "hidden",
                  marginTop: 8,
                }}
              >
                <div
                  style={{
                    width: `${completionPct}%`,
                    height: "100%",
                    background: `linear-gradient(90deg, ${BRAND.cyan}, ${BRAND.dark})`,
                    borderRadius: 999,
                    transition: "width 280ms ease-out",
                  }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", alignSelf: "center" }}>
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                style={{
                  background: submitting ? BRAND.lightAzure : BRAND.dark,
                  color: submitting ? BRAND.greyBlue : "#fff",
                  border: "none",
                  padding: "12px 22px",
                  borderRadius: 14,
                  fontWeight: 800,
                  fontSize: 14,
                  letterSpacing: "0.03em",
                  cursor: submitting ? "not-allowed" : "pointer",
                  boxShadow: submitting ? "none" : "0 6px 20px rgba(23, 52, 100, 0.22)",
                  transition: "transform 0.15s ease, box-shadow 0.15s ease",
                }}
              >
                {submitting ? "Submitting…" : "Submit assessment"}
              </button>
            </div>
          </div>

          {submitResult && (
            <div
              style={{
                marginTop: 14,
                padding: 14,
                borderRadius: 14,
                border: `1px solid ${BRAND.lightAzure}`,
                background: BRAND.surfaceMuted,
                color: BRAND.text,
                fontWeight: 600,
                lineHeight: 1.5,
              }}
            >
              {submitResult}
            </div>
          )}
        </div>

        {/* Questions */}
        <div style={{ marginTop: 24, display: "grid", gap: 22 }}>
          {questions &&
            pillarsOrder.map((pillar) => {
              const qs = questions.pillars[pillar] ?? [];
              if (qs.length === 0) return null;

              return (
                <section
                  key={pillar}
                  style={{
                    position: "relative",
                    background: BRAND.card,
                    border: `1px solid rgba(205, 216, 223, 0.55)`,
                    borderRadius: 20,
                    padding: "24px 24px 24px 22px",
                    boxShadow: "0 6px 32px rgba(23, 52, 100, 0.055)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    aria-hidden
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: 4,
                      background: `linear-gradient(180deg, ${BRAND.cyan}, ${BRAND.dark})`,
                      opacity: 0.95,
                      borderRadius: "20px 0 0 20px",
                    }}
                  />
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                      marginBottom: 18,
                    }}
                  >
                    <h2
                      style={{
                        margin: 0,
                        color: BRAND.dark,
                        fontSize: 17,
                        fontWeight: 800,
                        fontFamily: montserrat.style.fontFamily,
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {prettyPillar(pillar)}
                    </h2>
                    <div
                      style={{
                        color: BRAND.greyBlue,
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}
                    >
                      {qs.length} item{qs.length === 1 ? "" : "s"}
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 18 }}>
                    {qs.map((q) => {
                      const selected = scores[q.id] ?? null;

                      return (
                        <div
                          key={q.id}
                          style={{
                            border: `1px solid ${BRAND.lightAzure}`,
                            borderRadius: 16,
                            padding: "20px 18px",
                            background: BRAND.lightBlue,
                          }}
                        >
                          <div
                            style={{
                              textAlign: "center",
                              color: BRAND.dark,
                              fontWeight: 700,
                              fontSize: 16,
                              lineHeight: 1.45,
                              marginBottom: 16,
                              maxWidth: 720,
                              marginLeft: "auto",
                              marginRight: "auto",
                            }}
                          >
                            <span
                              style={{
                                display: "inline-block",
                                marginRight: 8,
                                fontFamily: montserrat.style.fontFamily,
                                fontSize: 12,
                                fontWeight: 800,
                                color: BRAND.cyan,
                                verticalAlign: "middle",
                              }}
                            >
                              {q.display_order}
                            </span>
                            {q.question_text}
                          </div>

                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                              gap: 10,
                              alignItems: "start",
                              maxWidth: 800,
                              margin: "0 auto",
                            }}
                          >
                            {LIKERT.map((opt) => {
                              const isSelected = selected === opt.value;
                              const isHover = hover?.qid === q.id && hover?.value === opt.value;

                              const bg = isSelected
                                ? BRAND.cyan
                                : isHover
                                  ? "rgba(52, 176, 180, 0.12)"
                                  : BRAND.card;

                              const border = isSelected ? BRAND.dark : isHover ? BRAND.cyan : BRAND.lightAzure;

                              const numColor = BRAND.dark;
                              const labelColor = isSelected ? BRAND.dark : BRAND.greyBlue;

                              return (
                                <button
                                  type="button"
                                  key={opt.value}
                                  onClick={() => setScores((prev) => ({ ...prev, [q.id]: opt.value }))}
                                  onMouseEnter={() => setHover({ qid: q.id, value: opt.value })}
                                  onMouseLeave={() => setHover(null)}
                                  style={{
                                    width: "100%",
                                    borderRadius: 14,
                                    border: `1.5px solid ${border}`,
                                    background: bg,
                                    padding: "14px 8px",
                                    cursor: "pointer",
                                    boxShadow: isSelected
                                      ? "0 8px 26px rgba(52, 176, 180, 0.28), 0 2px 6px rgba(23, 52, 100, 0.08)"
                                      : isHover
                                        ? "0 4px 14px rgba(23, 52, 100, 0.06)"
                                        : "none",
                                    transition:
                                      "background 140ms ease, border 140ms ease, transform 140ms ease, box-shadow 140ms ease",
                                    transform: isHover ? "translateY(-2px)" : "translateY(0)",
                                    textAlign: "center",
                                  }}
                                  aria-pressed={isSelected}
                                >
                                  <div
                                    style={{
                                      fontFamily: montserrat.style.fontFamily,
                                      fontWeight: 800,
                                      fontSize: 19,
                                      color: numColor,
                                      lineHeight: 1,
                                      marginBottom: 8,
                                    }}
                                  >
                                    {opt.value}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: 11,
                                      fontWeight: 600,
                                      color: isHover ? BRAND.dark : labelColor,
                                      whiteSpace: "normal",
                                      lineHeight: 1.25,
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

          <section
            style={{
              position: "relative",
              background: BRAND.card,
              border: `1px solid rgba(205, 216, 223, 0.55)`,
              borderRadius: 20,
              padding: "24px 24px 24px 22px",
              boxShadow: "0 6px 32px rgba(23, 52, 100, 0.055)",
              overflow: "hidden",
            }}
          >
            <div
              aria-hidden
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: 4,
                background: `linear-gradient(180deg, ${BRAND.greyBlue}, ${BRAND.cyan})`,
                opacity: 0.9,
                borderRadius: "20px 0 0 20px",
              }}
            />
            <h2
              style={{
                margin: 0,
                color: BRAND.dark,
                fontSize: 17,
                fontWeight: 800,
                fontFamily: montserrat.style.fontFamily,
                letterSpacing: "-0.02em",
              }}
            >
              Best use case for AI automation
            </h2>
            <div style={{ color: BRAND.greyBlue, marginTop: 8, fontSize: 14, fontWeight: 500, lineHeight: 1.5 }}>
              In your own words, what would create the most leverage right now?
            </div>

            <textarea
              className="nl-assess-focus"
              value={aiUseCase}
              onChange={(e) => setAiUseCase(e.target.value)}
              rows={4}
              style={{
                width: "100%",
                marginTop: 14,
                border: `1px solid ${BRAND.lightAzure}`,
                borderRadius: 16,
                padding: 14,
                fontSize: 14,
                fontFamily: openSans.style.fontFamily,
                lineHeight: 1.5,
                background: BRAND.lightBlue,
                transition: "border-color 0.15s ease, box-shadow 0.15s ease",
              }}
              placeholder="Example: automate client onboarding, generate first-draft SOPs, sales follow-ups, internal reporting, support ticket triage…"
            />
            <div style={{ marginTop: 8, color: BRAND.greyBlue, fontSize: 12, fontWeight: 600 }}>
              {aiUseCase.length} / 5000
            </div>
          </section>
        </div>
      </div>
    </main>
    </>
  );
}