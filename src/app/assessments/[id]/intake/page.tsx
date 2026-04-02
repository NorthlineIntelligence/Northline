"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Montserrat, Open_Sans } from "next/font/google";
import {
  NORTHLINE_BRAND as BRAND,
  NORTHLINE_GLASS_CARD as glassCard,
  NORTHLINE_SHELL_BG as shellBackground,
  PARTICIPANT_DEPARTMENT_CODES,
  type ParticipantDepartmentCode,
} from "@/lib/northlineBrand";

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

function BrandWordmark() {
  return (
    <div aria-label="Northline Intelligence" style={{ lineHeight: 1.2 }}>
      <div
        style={{
          fontFamily: montserrat.style.fontFamily,
          fontWeight: 900,
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
          fontWeight: 800,
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

const SENIORITY = [
  "Individual Contributor",
  "Manager / Mid-level Leadership",
  "Director",
  "VP",
  "Executive",
] as const;

export default function AssessmentIntakePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const assessmentId = typeof params?.id === "string" ? params.id : null;

  const [orgName, setOrgName] = useState<string>("—");
  const [loadingOrg, setLoadingOrg] = useState(false);

  const [department, setDepartment] = useState<ParticipantDepartmentCode | "">("");
  const [seniority, setSeniority] = useState<(typeof SENIORITY)[number] | "">("");
  const [notes, setNotes] = useState("");

  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);

  const canContinue = useMemo(() => {
    return Boolean(department && seniority && notes.trim().length >= 10);
  }, [department, seniority, notes]);

  // Load org name from results endpoint (you already have organizationName there)
  useEffect(() => {
    if (!assessmentId) return;

    let alive = true;
    const ctrl = new AbortController();

    async function load() {
      setLoadingOrg(true);
      try {
        const res = await fetch(`/api/assessments/${assessmentId}/results`, {
          credentials: "include",
          signal: ctrl.signal,
        });
        const json = await res.json().catch(() => null);
        if (!alive) return;

        const name =
          typeof json?.organizationName === "string" && json.organizationName.trim()
            ? json.organizationName.trim()
            : "—";

        setOrgName(name);
      } catch (e: any) {
        if (!alive) return;
        setOrgName("—");
      } finally {
        if (!alive) return;
        setLoadingOrg(false);
      }
    }

    load();
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [assessmentId]);

  async function saveAndGo() {
    if (!assessmentId) return;
    setErr(null);
    setSaving(true);

    try {
      const res = await fetch(`/api/assessments/${assessmentId}/participant/intake`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          department,
          seniority_level: seniority,
          ai_opportunities_notes: notes,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setErr(json?.message || json?.error || `Save failed (${res.status})`);
        return;
      }

      // ✅ redirect to your assessment start route
      // Change this if your assessment route is different:
      router.push(`/assessments/${assessmentId}/start`);
    } catch (e: any) {
      setErr(e?.message ?? "Save failed.");
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "clamp(20px, 4vw, 36px)",
        background: shellBackground,
        fontFamily: openSans.style.fontFamily,
        color: BRAND.text,
      }}
    >
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
          borderRadius: 20,
          padding: 26,
          ...glassCard,
        }}
      >
        <BrandWordmark />
        <div
          style={{
            marginTop: 14,
            fontFamily: montserrat.style.fontFamily,
            fontWeight: 800,
            fontSize: 20,
            color: BRAND.dark,
            letterSpacing: "-0.02em",
          }}
        >
          Participant intake
        </div>
        <div style={{ marginTop: 8, color: BRAND.greyBlue, fontWeight: 600, fontSize: 14 }}>
          {loadingOrg ? "Loading organization…" : orgName}
        </div>

        <div style={{ marginTop: 22, display: "grid", gap: 18 }}>
          <div>
            <div
              style={{
                fontFamily: montserrat.style.fontFamily,
                fontWeight: 800,
                marginBottom: 8,
                color: BRAND.dark,
                fontSize: 13,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              Department or team
            </div>
            <div style={{ color: BRAND.muted, fontSize: 13, marginBottom: 8, lineHeight: 1.45 }}>
              Your primary function for reporting. This does not change which assessment questions you receive—those are
              set by your organization’s assessment configuration.
            </div>
            <select
              value={department}
              onChange={(e) =>
                setDepartment((e.target.value || "") as ParticipantDepartmentCode | "")
              }
              style={{
                width: "100%",
                padding: 14,
                borderRadius: 14,
                border: `1px solid ${BRAND.lightAzure}`,
                fontWeight: 600,
                background: BRAND.lightBlue,
                fontFamily: openSans.style.fontFamily,
              }}
            >
              <option value="">Select…</option>
              {PARTICIPANT_DEPARTMENT_CODES.map((d) => (
                <option key={d} value={d}>
                  {d.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div
              style={{
                fontFamily: montserrat.style.fontFamily,
                fontWeight: 800,
                marginBottom: 8,
                color: BRAND.dark,
                fontSize: 13,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              Seniority level
            </div>
            <select
              value={seniority}
              onChange={(e) => setSeniority(e.target.value as any)}
              style={{
                width: "100%",
                padding: 14,
                borderRadius: 14,
                border: `1px solid ${BRAND.lightAzure}`,
                fontWeight: 600,
                background: BRAND.lightBlue,
                fontFamily: openSans.style.fontFamily,
              }}
            >
              <option value="">Select…</option>
              {SENIORITY.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div
              style={{
                fontFamily: montserrat.style.fontFamily,
                fontWeight: 800,
                marginBottom: 8,
                color: BRAND.dark,
                fontSize: 15,
                letterSpacing: "-0.01em",
              }}
            >
              Day-to-day opportunities for AI automation
            </div>
            <div style={{ color: BRAND.greyBlue, fontWeight: 500, fontSize: 14, lineHeight: 1.5, marginBottom: 10 }}>
              Think about your work today. List and describe two instances where AI automation could make your job easier,
              improve efficiency, or help you generate more revenue. If you’re unsure, describe areas you wish were smoother.
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={6}
              placeholder="Example: Follow-up emails after demos…"
              style={{
                width: "100%",
                padding: 14,
                borderRadius: 16,
                border: `1px solid ${BRAND.lightAzure}`,
                fontWeight: 500,
                lineHeight: 1.5,
                background: BRAND.lightBlue,
                fontFamily: openSans.style.fontFamily,
              }}
            />
          </div>

          {err ? (
            <div
              style={{
                background: "#FFF5F5",
                border: "1px solid #FECACA",
                color: "#991B1B",
                padding: 14,
                borderRadius: 14,
                fontWeight: 600,
                lineHeight: 1.45,
              }}
            >
              {err}
            </div>
          ) : null}

          <button
            type="button"
            disabled={!canContinue || saving}
            onClick={() => setConfirmOpen(true)}
            style={{
              padding: "14px 18px",
              borderRadius: 14,
              border: "none",
              background: canContinue ? BRAND.dark : BRAND.lightAzure,
              color: canContinue ? "#fff" : BRAND.greyBlue,
              fontWeight: 800,
              fontSize: 14,
              letterSpacing: "0.03em",
              cursor: canContinue ? "pointer" : "not-allowed",
              boxShadow: canContinue ? "0 6px 20px rgba(23, 52, 100, 0.2)" : "none",
            }}
          >
            {saving ? "Saving…" : "Go to assessment"}
          </button>
        </div>
      </div>

      {/* Confirm Modal */}
      {confirmOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(11, 18, 32, 0.48)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
            zIndex: 50,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              background: "rgba(255,255,255,0.97)",
              borderRadius: 20,
              border: `1px solid ${BRAND.lightAzure}`,
              padding: 24,
              boxShadow: "0 20px 60px rgba(23, 52, 100, 0.18)",
            }}
          >
            <div style={{ fontFamily: montserrat.style.fontFamily, fontWeight: 800, fontSize: 17, color: BRAND.dark }}>
              One moment
            </div>
            <div style={{ marginTop: 10, fontWeight: 600, color: BRAND.text, lineHeight: 1.45 }}>
              Please confirm this is your organization:
            </div>
            <div
              style={{
                marginTop: 10,
                fontFamily: montserrat.style.fontFamily,
                fontWeight: 800,
                color: BRAND.dark,
                fontSize: 20,
              }}
            >
              {orgName}
            </div>
            <div style={{ marginTop: 12, color: BRAND.greyBlue, fontWeight: 500, fontSize: 14, lineHeight: 1.45 }}>
              If this is not your organization, please let your administrator know.
            </div>

            <div style={{ marginTop: 20, display: "flex", gap: 12, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={saving}
                style={{
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: `1px solid ${BRAND.lightAzure}`,
                  background: "#fff",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: openSans.style.fontFamily,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveAndGo}
                disabled={saving}
                style={{
                  padding: "12px 18px",
                  borderRadius: 14,
                  border: "none",
                  background: BRAND.cyan,
                  color: BRAND.dark,
                  fontWeight: 800,
                  cursor: "pointer",
                  fontFamily: openSans.style.fontFamily,
                  boxShadow: "0 4px 16px rgba(52, 176, 180, 0.35)",
                }}
              >
                Confirm &amp; continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}