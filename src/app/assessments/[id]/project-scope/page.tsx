"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Montserrat, Open_Sans } from "next/font/google";
import { NORTHLINE_BRAND as BRAND, NORTHLINE_SHELL_BG as shellBackground } from "@/lib/northlineBrand";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  display: "swap",
});

const openSans = Open_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
});

function inviteStorageKey(assessmentId: string) {
  return `nl_invite_${assessmentId}`;
}

function costLabel(c: string) {
  const m: Record<string, string> = {
    low: "Low",
    medium: "Medium",
    high: "High",
    "low-medium": "Low–Medium",
    "medium-high": "Medium–High",
  };
  return m[c] ?? c;
}

function SectionLabel({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginTop: first ? 0 : 20,
        marginBottom: 10,
      }}
    >
      <span
        style={{
          width: 4,
          height: 22,
          borderRadius: 2,
          background: `linear-gradient(180deg, ${BRAND.cyan} 0%, ${BRAND.dark} 100%)`,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontFamily: montserrat.style.fontFamily,
          fontSize: 11,
          fontWeight: 900,
          letterSpacing: "0.1em",
          color: BRAND.greyBlue,
          textTransform: "uppercase",
        }}
      >
        {children}
      </span>
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul
      style={{
        margin: 0,
        padding: 0,
        listStyle: "none",
        display: "grid",
        gap: 14,
      }}
    >
      {items.map((text, i) => (
        <li
          key={i}
          style={{
            display: "flex",
            gap: 14,
            alignItems: "flex-start",
            fontFamily: openSans.style.fontFamily,
            fontSize: 15,
            fontWeight: 600,
            lineHeight: 1.62,
            color: BRAND.text,
          }}
        >
          <span
            aria-hidden
            style={{
              flexShrink: 0,
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: BRAND.cyan,
              marginTop: 8,
              boxShadow: "0 0 0 3px rgba(52, 176, 180, 0.2)",
            }}
          />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

function ProseBlock({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: openSans.style.fontFamily,
        fontSize: 15,
        fontWeight: 600,
        lineHeight: 1.68,
        color: BRAND.text,
        padding: "16px 18px",
        background: BRAND.wash,
        borderRadius: 12,
        border: `1px solid rgba(205, 216, 223, 0.85)`,
      }}
    >
      {children}
    </div>
  );
}

/** Prefer newline breaks; otherwise break long memos into sentence bullets when there are several. */
function executiveMemoBlocks(
  text: string
): { kind: "bullets"; items: string[] } | { kind: "text"; text: string } {
  const t = text.trim();
  if (!t) return { kind: "text", text: "" };
  const byLine = t
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (byLine.length > 1) return { kind: "bullets", items: byLine };
  const sentences = t
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
  if (sentences.length >= 3) return { kind: "bullets", items: sentences };
  return { kind: "text", text: t };
}

export default function ProjectScopePage() {
  const params = useParams<{ id: string }>();
  const assessmentId = typeof params?.id === "string" && params.id.length > 0 ? params.id : null;
  const searchParams = useSearchParams();

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteToken, setInviteToken] = useState("");

  useEffect(() => {
    if (!assessmentId) return;

    const urlEmail = (searchParams.get("email") ?? "").trim().toLowerCase();
    const urlToken = (searchParams.get("token") ?? "").trim();

    if (urlEmail && urlToken) {
      try {
        sessionStorage.setItem(inviteStorageKey(assessmentId), JSON.stringify({ email: urlEmail, token: urlToken }));
      } catch {}
      setInviteEmail(urlEmail);
      setInviteToken(urlToken);
      return;
    }

    try {
      const raw = sessionStorage.getItem(inviteStorageKey(assessmentId));
      if (raw) {
        const parsed = JSON.parse(raw);
        const storedEmail = typeof parsed?.email === "string" ? parsed.email : "";
        const storedToken = typeof parsed?.token === "string" ? parsed.token : "";
        if (storedEmail && storedToken) {
          setInviteEmail(storedEmail);
          setInviteToken(storedToken);
        }
      }
    } catch {}
  }, [assessmentId, searchParams]);

  const authQs = useMemo(() => {
    const qs = new URLSearchParams();
    if (inviteEmail) qs.set("email", inviteEmail);
    if (inviteToken) qs.set("token", inviteToken);
    return qs.toString();
  }, [inviteEmail, inviteToken]);

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [scopeRow, setScopeRow] = useState<any | null>(null);
  const [featureDisabled, setFeatureDisabled] = useState(false);

  const loadScope = useCallback(async () => {
    if (!assessmentId) return;
    setLoading(true);
    setErr(null);
    setFeatureDisabled(false);
    try {
      const url = `/api/assessments/${assessmentId}/project-scope${authQs ? `?${authQs}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      const json = await res.json().catch(() => null);
      if (res.status === 403) {
        setFeatureDisabled(true);
        setScopeRow(null);
        return;
      }
      if (res.status === 409) {
        setErr(
          typeof json?.error === "string"
            ? json.error
            : "All participants must complete the assessment before project scope is available."
        );
        setScopeRow(null);
        return;
      }
      if (!res.ok || !json?.ok) {
        setErr(json?.error ?? json?.message ?? `Could not load project scope (${res.status}).`);
        setScopeRow(null);
        return;
      }
      setScopeRow(json.scope ?? null);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [assessmentId, authQs]);

  useEffect(() => {
    void loadScope();
  }, [loadScope]);

  async function onGenerate() {
    if (!assessmentId) return;
    setGenerating(true);
    setErr(null);
    try {
      const url = `/api/assessments/${assessmentId}/project-scope/generate${authQs ? `?${authQs}` : ""}`;
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail || undefined,
          token: inviteToken || undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setErr(json?.error ?? json?.message ?? `Generate failed (${res.status}).`);
        return;
      }
      setScopeRow(json.scope ?? null);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  const doc = scopeRow?.scope_json ?? null;
  const projects = Array.isArray(doc?.projects) ? doc.projects : [];
  const readiness = doc?.readiness ?? {};
  const metrics = doc?.readinessMetrics ?? {};

  return (
    <div
      style={{
        minHeight: "100vh",
        background: shellBackground,
        color: BRAND.text,
        fontFamily: openSans.style.fontFamily,
      }}
    >
      <div style={{ maxWidth: 920, margin: "0 auto", padding: "24px 20px 48px" }}>
        <div style={{ marginBottom: 20 }}>
          <Link
            href={assessmentId ? `/assessments/${assessmentId}/narrative${authQs ? `?${authQs}` : ""}` : "#"}
            style={{ color: BRAND.cyan, fontWeight: 800, fontSize: 14, textDecoration: "none" }}
          >
            ← Executive Insights
          </Link>
        </div>

        <header style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: BRAND.greyBlue, letterSpacing: "0.06em" }}>
            NORTHLINE INTELLIGENCE
          </div>
          <h1 style={{ margin: "8px 0 0", fontSize: 28, fontWeight: 900, color: BRAND.dark, letterSpacing: "-0.02em" }}>
            Project Scope Overview
          </h1>
          <ul
            style={{
              margin: "12px 0 0",
              paddingLeft: 22,
              maxWidth: 680,
              fontFamily: openSans.style.fontFamily,
              color: BRAND.muted,
              fontWeight: 600,
              fontSize: 15,
              lineHeight: 1.65,
            }}
          >
            <li style={{ marginBottom: 6 }}>One card per high-value entry point: scope, objectives, and outcomes.</li>
            <li style={{ marginBottom: 6 }}>Cost bands and timelines are conservative planning aids—not fixed quotes.</li>
            <li>All detail is subject to change as you add facts, owners, and constraints.</li>
          </ul>
        </header>

        {featureDisabled ? (
          <div
            style={{
              border: `1px solid ${BRAND.border}`,
              borderRadius: 16,
              padding: 20,
              background: BRAND.card,
              fontWeight: 700,
              color: BRAND.dark,
            }}
          >
            Project scope review is not enabled for this organization. Ask a Northline admin to turn on{" "}
            <strong>Project scope</strong> for your org on the admin dashboard.
          </div>
        ) : null}

        {!featureDisabled ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => void onGenerate()}
              disabled={generating || !assessmentId || loading}
              style={{
                background: BRAND.cyan,
                color: BRAND.dark,
                border: `1px solid ${BRAND.border}`,
                padding: "10px 18px",
                borderRadius: 14,
                fontWeight: 900,
                cursor: generating || loading ? "not-allowed" : "pointer",
                opacity: generating || loading ? 0.65 : 1,
                fontFamily: montserrat.style.fontFamily,
              }}
            >
              {generating ? "Generating…" : scopeRow ? "Regenerate scope" : "Generate scope"}
            </button>
            <button
              type="button"
              onClick={() => void loadScope()}
              disabled={loading}
              style={{
                background: "#fff",
                color: BRAND.dark,
                border: `1px solid ${BRAND.border}`,
                padding: "10px 14px",
                borderRadius: 14,
                fontWeight: 800,
                cursor: loading ? "not-allowed" : "pointer",
                fontFamily: montserrat.style.fontFamily,
              }}
            >
              Refresh
            </button>
          </div>
        ) : null}

        {err ? (
          <div
            style={{
              marginBottom: 20,
              padding: 14,
              borderRadius: 12,
              background: "#FFF5F5",
              border: "1px solid #FED7D7",
              color: "#9B2C2C",
              fontWeight: 700,
            }}
          >
            {err}
          </div>
        ) : null}

        {loading ? <div style={{ color: BRAND.muted, fontWeight: 700 }}>Loading…</div> : null}

        {!loading && !featureDisabled && doc ? (
          <div style={{ display: "grid", gap: 24 }}>
            {typeof doc.disclaimer === "string" ? (
              <aside
                style={{
                  padding: "18px 20px",
                  background: BRAND.card,
                  borderRadius: 16,
                  border: `1px solid ${BRAND.border}`,
                  boxShadow: "0 4px 20px rgba(23, 52, 100, 0.04)",
                }}
              >
                <SectionLabel first>Important</SectionLabel>
                <BulletList items={[doc.disclaimer]} />
              </aside>
            ) : null}

            {(metrics?.protectedReadinessScore != null || metrics?.readinessBand) && (
              <section
                style={{
                  position: "relative",
                  padding: "26px 26px 26px 22px",
                  background: BRAND.card,
                  borderRadius: 18,
                  border: `1px solid ${BRAND.border}`,
                  boxShadow: "0 12px 36px rgba(23, 52, 100, 0.07)",
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
                    width: 5,
                    background: `linear-gradient(180deg, ${BRAND.cyan}, ${BRAND.dark})`,
                  }}
                />
                <h2
                  style={{
                    margin: 0,
                    fontSize: 20,
                    fontWeight: 900,
                    color: BRAND.dark,
                    fontFamily: montserrat.style.fontFamily,
                    letterSpacing: "-0.02em",
                  }}
                >
                  Readiness overview
                </h2>
                <div
                  style={{
                    marginTop: 14,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  {metrics?.readinessBand ? (
                    <span
                      style={{
                        fontFamily: montserrat.style.fontFamily,
                        fontSize: 13,
                        fontWeight: 900,
                        color: BRAND.dark,
                        background: "rgba(52, 176, 180, 0.22)",
                        padding: "8px 14px",
                        borderRadius: 999,
                      }}
                    >
                      {String(metrics.readinessBand)}
                    </span>
                  ) : null}
                  {metrics?.protectedReadinessScore != null ? (
                    <span
                      style={{
                        fontFamily: montserrat.style.fontFamily,
                        fontSize: 13,
                        fontWeight: 800,
                        color: BRAND.greyBlue,
                        background: BRAND.wash,
                        padding: "8px 14px",
                        borderRadius: 999,
                        border: `1px solid ${BRAND.border}`,
                      }}
                    >
                      Protected readiness score: {Number(metrics.protectedReadinessScore).toFixed(2)} / 5
                    </span>
                  ) : null}
                </div>

                {typeof readiness.executiveMemo === "string" && readiness.executiveMemo.trim() ? (
                  <div style={{ marginTop: 18 }}>
                    <SectionLabel first>Executive memo</SectionLabel>
                    {(() => {
                      const blocks = executiveMemoBlocks(readiness.executiveMemo);
                      if (blocks.kind === "bullets") {
                        return <BulletList items={blocks.items} />;
                      }
                      return <ProseBlock>{blocks.text}</ProseBlock>;
                    })()}
                  </div>
                ) : null}

                {Array.isArray(readiness.stabilizeFirstAccelerators) && readiness.stabilizeFirstAccelerators.length > 0 ? (
                  <div style={{ marginTop: 8 }}>
                    <SectionLabel>Suggested actions (stabilize first)</SectionLabel>
                    <div
                      style={{
                        padding: "16px 18px",
                        borderRadius: 12,
                        background: "linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)",
                        border: `1px solid rgba(102, 129, 158, 0.25)`,
                      }}
                    >
                      <BulletList items={readiness.stabilizeFirstAccelerators.filter(Boolean)} />
                    </div>
                  </div>
                ) : null}
              </section>
            )}

            {projects.length > 0 ? (
              <div
                style={{
                  fontFamily: montserrat.style.fontFamily,
                  fontSize: 12,
                  fontWeight: 900,
                  letterSpacing: "0.08em",
                  color: BRAND.greyBlue,
                  textTransform: "uppercase",
                }}
              >
                High-value entry points ({projects.length})
              </div>
            ) : null}

            {projects.map((p: any, idx: number) => (
              <section
                key={idx}
                style={{
                  position: "relative",
                  padding: "26px 26px 26px 22px",
                  background: BRAND.card,
                  borderRadius: 18,
                  border: `1px solid ${BRAND.border}`,
                  boxShadow: "0 12px 36px rgba(23, 52, 100, 0.06)",
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
                    width: 5,
                    background: `linear-gradient(180deg, ${BRAND.greyBlue} 0%, ${BRAND.cyan} 100%)`,
                  }}
                />

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 14,
                  }}
                >
                  <div style={{ minWidth: 0, flex: "1 1 240px" }}>
                    <div
                      style={{
                        fontFamily: montserrat.style.fontFamily,
                        fontSize: 12,
                        fontWeight: 900,
                        color: BRAND.cyan,
                        marginBottom: 6,
                      }}
                    >
                      Entry point {idx + 1} of {projects.length}
                    </div>
                    <h2
                      style={{
                        margin: 0,
                        fontSize: 21,
                        fontWeight: 900,
                        color: BRAND.dark,
                        fontFamily: montserrat.style.fontFamily,
                        letterSpacing: "-0.03em",
                        lineHeight: 1.25,
                      }}
                    >
                      {p.name ?? `Project ${idx + 1}`}
                    </h2>
                  </div>
                  <div
                    style={{
                      fontFamily: montserrat.style.fontFamily,
                      fontSize: 13,
                      fontWeight: 900,
                      color: BRAND.dark,
                      background: "rgba(52, 176, 180, 0.24)",
                      padding: "10px 16px",
                      borderRadius: 999,
                      border: `1px solid rgba(52, 176, 180, 0.35)`,
                      whiteSpace: "nowrap",
                    }}
                  >
                    Estimated cost: {costLabel(String(p.costEstimate ?? "medium"))}
                  </div>
                </div>

                <SectionLabel first>Scope of work</SectionLabel>
                {p.scopeOfWork ? <ProseBlock>{String(p.scopeOfWork)}</ProseBlock> : null}

                <SectionLabel>What we’re trying to accomplish</SectionLabel>
                {p.objectives ? <ProseBlock>{String(p.objectives)}</ProseBlock> : null}

                <SectionLabel>Expected outcomes</SectionLabel>
                <BulletList items={(Array.isArray(p.expectedOutcomes) ? p.expectedOutcomes : []).filter(Boolean)} />

                <SectionLabel>Risks & barriers</SectionLabel>
                <div
                  style={{
                    padding: "16px 18px",
                    borderRadius: 12,
                    background: "#fffbf8",
                    border: "1px solid rgba(180, 83, 9, 0.18)",
                  }}
                >
                  <BulletList
                    items={(Array.isArray(p.risksAndBarriers) ? p.risksAndBarriers : []).filter(Boolean)}
                  />
                  {(Array.isArray(p.risksAndBarriers) ? p.risksAndBarriers : []).length === 0 ? (
                    <p
                      style={{
                        margin: 0,
                        fontFamily: openSans.style.fontFamily,
                        fontSize: 14,
                        fontWeight: 600,
                        color: BRAND.muted,
                      }}
                    >
                      None called out in this pass—validate with your team during planning.
                    </p>
                  ) : null}
                </div>

                {p.timeline ? (
                  <div style={{ marginTop: 4 }}>
                    <SectionLabel>Timeline</SectionLabel>
                    <ProseBlock>
                      <strong style={{ color: BRAND.dark, fontFamily: montserrat.style.fontFamily, fontWeight: 900 }}>
                        Duration
                      </strong>
                      <span style={{ display: "block", marginTop: 8 }}>{p.timeline.displayLabel}</span>
                      {p.timeline.valueBuffered != null && p.timeline.valueRealistic != null ? (
                        <span
                          style={{
                            display: "block",
                            marginTop: 8,
                            fontSize: 13,
                            fontWeight: 600,
                            color: BRAND.greyBlue,
                          }}
                        >
                          Planning basis: ~{p.timeline.valueRealistic} {p.timeline.unit} realistic → ~{p.timeline.valueBuffered}{" "}
                          {p.timeline.unit} with buffer applied.
                        </span>
                      ) : null}
                    </ProseBlock>
                    {Array.isArray(p.timelinePhases) && p.timelinePhases.length > 0 ? (
                      <div style={{ marginTop: 14 }}>
                        <div
                          style={{
                            fontFamily: montserrat.style.fontFamily,
                            fontSize: 11,
                            fontWeight: 900,
                            letterSpacing: "0.08em",
                            color: BRAND.greyBlue,
                            textTransform: "uppercase",
                            marginBottom: 10,
                          }}
                        >
                          Phase breakdown
                        </div>
                        <div style={{ display: "flex", height: 14, borderRadius: 10, overflow: "hidden", marginBottom: 14 }}>
                          {p.timelinePhases.map((ph: any, i: number) => (
                            <div
                              key={i}
                              title={`${ph.label ?? ""} — ${ph.durationLabel ?? ""}`}
                              style={{
                                flex: Number(ph.portionPct) || 1,
                                background: i % 2 === 0 ? BRAND.cyan : BRAND.dark,
                                opacity: 0.78 + (i % 3) * 0.07,
                                minWidth: 10,
                              }}
                            />
                          ))}
                        </div>
                        <ol
                          style={{
                            margin: 0,
                            paddingLeft: 22,
                            fontFamily: openSans.style.fontFamily,
                            fontSize: 14,
                            fontWeight: 600,
                            lineHeight: 1.65,
                            color: BRAND.text,
                          }}
                        >
                          {p.timelinePhases.map((ph: any, i: number) => (
                            <li key={i} style={{ marginBottom: 10 }}>
                              <span style={{ color: BRAND.dark, fontWeight: 700 }}>{ph.label}</span>
                              {ph.portionPct != null ? (
                                <span style={{ color: BRAND.greyBlue }}> — ~{ph.portionPct}% of effort</span>
                              ) : null}
                              {ph.durationLabel ? (
                                <span style={{ display: "block", color: BRAND.muted, marginTop: 4 }}>
                                  {ph.durationLabel}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ol>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        ) : null}

        {!loading && !featureDisabled && !doc ? (
          <div style={{ color: BRAND.muted, fontWeight: 700 }}>
            No saved scope yet. Click <strong>Generate scope</strong> after Executive Insights has been generated.
          </div>
        ) : null}
      </div>
    </div>
  );
}
