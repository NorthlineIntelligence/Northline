"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Montserrat } from "next/font/google";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  display: "swap",
});

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
        background: BRAND.bg,
        color: BRAND.text,
        fontFamily: montserrat.style.fontFamily,
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
          <p style={{ marginTop: 10, color: BRAND.muted, fontWeight: 600, lineHeight: 1.5, maxWidth: 640 }}>
            Executive-level scope, outcomes, cost band, risks, and timelines for each high-value entry point. Estimates
            are conservative and subject to change as requirements evolve.
          </p>
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
          <div style={{ display: "grid", gap: 20 }}>
            {typeof doc.disclaimer === "string" ? (
              <div
                style={{
                  fontSize: 13,
                  color: BRAND.muted,
                  fontWeight: 600,
                  lineHeight: 1.5,
                  padding: 16,
                  background: BRAND.card,
                  borderRadius: 14,
                  border: `1px solid ${BRAND.border}`,
                }}
              >
                {doc.disclaimer}
              </div>
            ) : null}

            {(metrics?.protectedReadinessScore != null || metrics?.readinessBand) && (
              <section
                style={{
                  padding: 22,
                  background: BRAND.card,
                  borderRadius: 18,
                  border: `1px solid ${BRAND.border}`,
                  boxShadow: "0 8px 28px rgba(23, 52, 100, 0.06)",
                }}
              >
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: BRAND.dark }}>Readiness</h2>
                <div style={{ marginTop: 8, fontWeight: 800, color: BRAND.greyBlue, fontSize: 14 }}>
                  {metrics?.readinessBand ? String(metrics.readinessBand) : ""}
                  {metrics?.protectedReadinessScore != null
                    ? ` · Score ${Number(metrics.protectedReadinessScore).toFixed(2)} / 5`
                    : ""}
                </div>
                {typeof readiness.executiveMemo === "string" ? (
                  <p style={{ marginTop: 14, fontWeight: 600, lineHeight: 1.55, color: BRAND.text, fontSize: 15 }}>
                    {readiness.executiveMemo}
                  </p>
                ) : null}
                {Array.isArray(readiness.stabilizeFirstAccelerators) && readiness.stabilizeFirstAccelerators.length > 0 ? (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontWeight: 900, color: BRAND.dark, marginBottom: 8 }}>Move the needle faster</div>
                    <ul style={{ margin: 0, paddingLeft: 20, fontWeight: 600, color: BRAND.muted, lineHeight: 1.5 }}>
                      {readiness.stabilizeFirstAccelerators.map((x: string, i: number) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            )}

            {projects.map((p: any, idx: number) => (
              <section
                key={idx}
                style={{
                  padding: 22,
                  background: BRAND.card,
                  borderRadius: 18,
                  border: `1px solid ${BRAND.border}`,
                  boxShadow: "0 8px 28px rgba(23, 52, 100, 0.06)",
                }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12 }}>
                  <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, color: BRAND.dark }}>{p.name ?? `Project ${idx + 1}`}</h2>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 900,
                      color: BRAND.dark,
                      background: "rgba(52, 176, 180, 0.2)",
                      padding: "6px 12px",
                      borderRadius: 999,
                    }}
                  >
                    Cost: {costLabel(String(p.costEstimate ?? "medium"))}
                  </div>
                </div>

                <div style={{ marginTop: 14, fontWeight: 800, color: BRAND.greyBlue, fontSize: 13 }}>Scope</div>
                <p style={{ margin: "6px 0 0", fontWeight: 600, lineHeight: 1.55, fontSize: 15 }}>{p.scopeOfWork}</p>

                <div style={{ marginTop: 14, fontWeight: 800, color: BRAND.greyBlue, fontSize: 13 }}>Objectives</div>
                <p style={{ margin: "6px 0 0", fontWeight: 600, lineHeight: 1.55, fontSize: 15 }}>{p.objectives}</p>

                <div style={{ marginTop: 14, fontWeight: 800, color: BRAND.greyBlue, fontSize: 13 }}>Expected outcomes</div>
                <ul style={{ margin: "6px 0 0", paddingLeft: 20, fontWeight: 600, lineHeight: 1.5 }}>
                  {(Array.isArray(p.expectedOutcomes) ? p.expectedOutcomes : []).map((o: string, i: number) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>

                <div style={{ marginTop: 14, fontWeight: 800, color: BRAND.greyBlue, fontSize: 13 }}>Risks & barriers</div>
                <ul style={{ margin: "6px 0 0", paddingLeft: 20, fontWeight: 600, lineHeight: 1.5 }}>
                  {(Array.isArray(p.risksAndBarriers) ? p.risksAndBarriers : []).map((o: string, i: number) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>

                {p.timeline ? (
                  <div style={{ marginTop: 18 }}>
                    <div style={{ fontWeight: 800, color: BRAND.greyBlue, fontSize: 13, marginBottom: 8 }}>Timeline</div>
                    <div style={{ fontWeight: 900, color: BRAND.dark, fontSize: 15 }}>{p.timeline.displayLabel}</div>
                    {Array.isArray(p.timelinePhases) && p.timelinePhases.length > 0 ? (
                      <div style={{ marginTop: 12, display: "flex", height: 12, borderRadius: 8, overflow: "hidden" }}>
                        {p.timelinePhases.map((ph: any, i: number) => (
                          <div
                            key={i}
                            title={`${ph.label ?? ""} — ${ph.durationLabel ?? ""}`}
                            style={{
                              flex: Number(ph.portionPct) || 1,
                              background: i % 2 === 0 ? BRAND.cyan : BRAND.dark,
                              opacity: 0.75 + (i % 3) * 0.08,
                              minWidth: 8,
                            }}
                          />
                        ))}
                      </div>
                    ) : null}
                    {Array.isArray(p.timelinePhases)
                      ? p.timelinePhases.map((ph: any, i: number) => (
                          <div key={i} style={{ marginTop: 6, fontSize: 13, fontWeight: 600, color: BRAND.muted }}>
                            <span style={{ color: BRAND.dark, fontWeight: 800 }}>{ph.label}</span>
                            {ph.durationLabel ? ` — ${ph.durationLabel}` : ""}
                          </div>
                        ))
                      : null}
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
