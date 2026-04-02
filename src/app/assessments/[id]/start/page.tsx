"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Montserrat, Open_Sans } from "next/font/google";
import {
  NORTHLINE_BRAND as BRAND,
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

/** Server may return Prisma Department including ALL; picker only lists real teams. */
type Department = ParticipantDepartmentCode | "ALL";

type AssessmentMeta = {
    id: string;
    status: string;
    type: string;
    locked_at: string | null;
    locked_department: Department | null;
    name?: string | null;
    organization?: {
      id: string;
      name: string | null;
    } | null;
  };

const shellCard = {
  maxWidth: 720,
  margin: "0 auto" as const,
  borderRadius: 20,
  padding: 26,
  background: "rgba(255, 255, 255, 0.92)",
  backdropFilter: "saturate(160%) blur(14px)",
  WebkitBackdropFilter: "saturate(160%) blur(14px)",
  border: `1px solid rgba(205, 216, 223, 0.65)`,
  boxShadow: "0 4px 28px rgba(23, 52, 100, 0.07), 0 1px 2px rgba(15, 23, 42, 0.04)",
};

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

function labelDept(d: string) {
  return String(d ?? "").toUpperCase().replaceAll("_", " ");
}

async function safeReadError(res: Response): Promise<string> {
  const ct = res.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      const j = await res.json();
      return (
        (j?.message as string) ||
        (j?.error as string) ||
        JSON.stringify(j).slice(0, 400)
      );
    }
    return (await res.text()).slice(0, 400);
  } catch {
    return "";
  }
}

export default function AssessmentStartPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const assessmentId =
    typeof params?.id === "string" && params.id.length > 0 ? params.id : null;

    const emailFromLink = (searchParams.get("email") ?? "").trim().toLowerCase();
    const tokenFromLink = (searchParams.get("token") ?? "").trim();
  const created = searchParams.get("created") === "1";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [assessment, setAssessment] = useState<AssessmentMeta | null>(null);
  const [selected, setSelected] = useState<ParticipantDepartmentCode | null>(null);

  const [seniority, setSeniority] = useState<string>("");
  const [role, setRole] = useState<string>("");
  const [aiNotes, setAiNotes] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);

      if (!assessmentId) {
        setLoadError("Missing assessment id in route.");
        setLoading(false);
        return;
      }

      // If your participant API requires email when not signed in, enforce it here.
            // Enforce email + token for hardened invite links
            if (!emailFromLink || !tokenFromLink) {
                setLoadError(
                  "This invite link is missing your email or token. Ask your admin to resend the invite link."
                );
                setLoading(false);
                return;
              }

      try {
        // 1) Ensure participant exists (send email in body)
        const ensureRes = await fetch(`/api/assessments/${assessmentId}/participant`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: emailFromLink,
              token: tokenFromLink,
            }),
          });

        if (!ensureRes.ok) {
          const detail = await safeReadError(ensureRes);
          setLoadError(
            detail ||
              `Failed to initialize participant (${ensureRes.status}).`
          );
          setLoading(false);
          return;
        }

        const ensureJson = await ensureRes.json().catch(() => null);

        // If server returns participant info, we can preselect department if already stored
        const existingDept = ensureJson?.participant?.department;
        if (
          typeof existingDept === "string" &&
          existingDept !== "ALL" &&
          (PARTICIPANT_DEPARTMENT_CODES as readonly string[]).includes(existingDept)
        ) {
          setSelected(existingDept as ParticipantDepartmentCode);
        }

        // 2) Try to fetch assessment metadata (optional — if it 401s, we still let them proceed)
        try {
            const metaUrl = new URL(
                `/api/assessments/${assessmentId}`,
                window.location.origin
              );
              
              metaUrl.searchParams.set("email", emailFromLink);
              
              const aRes = await fetch(metaUrl.toString(), {
                method: "GET",
                credentials: "include",
              });

          if (aRes.ok) {
            const aJson = await aRes.json().catch(() => null);
            const meta = aJson?.assessment as AssessmentMeta;

            if (!cancelled) {
              setAssessment(meta);
            }

            // 3) If locked_department exists and assessment is NOT locked, auto-set dept silently
            const lockDept = meta?.locked_department;
            if (
              meta?.locked_at == null &&
              lockDept &&
              lockDept !== "ALL" &&
              (PARTICIPANT_DEPARTMENT_CODES as readonly string[]).includes(lockDept)
            ) {
              await fetch(`/api/assessments/${assessmentId}/participant`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  email: emailFromLink,
                  department: lockDept,
                }),
              }).catch(() => {});
              if (!cancelled) setSelected(lockDept);
            }
          }
        } catch {
          // ignore meta fetch errors
        }

        if (!cancelled) setLoading(false);
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
  }, [assessmentId, emailFromLink, tokenFromLink]);

  async function saveIntakeAndContinue() {
    if (!assessmentId) return;

    if (!emailFromLink || !tokenFromLink) {
      setLoadError(
        "This invite link is missing your email or token. Ask your admin to resend the invite link."
      );
      return;
    }

    if (!selected && !lockedDept) {
      setLoadError("Please choose the department or team you work in most (for reporting).");
      return;
    }

    if (!seniority.trim()) {
      setLoadError("Please choose your seniority level to continue.");
      return;
    }

    if (!role.trim()) {
      setLoadError("Please enter your role to continue.");
      return;
    }

    if (!aiNotes.trim()) {
      setLoadError("Please answer the AI automation question to continue.");
      return;
    }

    setSaving(true);
    setLoadError(null);

    const res = await fetch(`/api/assessments/${assessmentId}/participant`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: emailFromLink,
        token: tokenFromLink,
        department: lockedDept ? lockedDept : (selected as ParticipantDepartmentCode),
        seniority_level: seniority.trim(),
        role: role.trim(),
        ai_opportunities_notes: aiNotes.trim(),
      }),
    });

    if (!res.ok) {
      const detail = await safeReadError(res);
      setLoadError(detail || `Failed to save intake (${res.status}).`);
      setSaving(false);
      return;
    }

    router.push(
      `/assessments/${assessmentId}?email=${encodeURIComponent(
        emailFromLink
      )}&token=${encodeURIComponent(tokenFromLink)}`
    );
  }

  const isLocked = assessment?.locked_at != null;
  const lockedDept = assessment?.locked_department ?? null;

  if (loading) {
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
        <div style={shellCard}>
          {created && (
            <div
              style={{
                marginBottom: 14,
                padding: 14,
                borderRadius: 14,
                background: "#ECFDF5",
                border: "1px solid #A7F3D0",
                color: "#065F46",
                fontWeight: 700,
              }}
            >
              Assessment created successfully.
            </div>
          )}

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
          <div style={{ color: BRAND.greyBlue, marginTop: 8, fontWeight: 500 }}>Loading…</div>
        </div>
      </main>
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
        <div style={shellCard}>
          {created && (
            <div
              style={{
                marginBottom: 14,
                padding: 14,
                borderRadius: 14,
                background: "#ECFDF5",
                border: "1px solid #A7F3D0",
                color: "#065F46",
                fontWeight: 700,
              }}
            >
              Assessment created successfully.
            </div>
          )}

          <BrandWordmark />
          <h2
            style={{
              margin: "14px 0 0 0",
              color: BRAND.dark,
              fontFamily: montserrat.style.fontFamily,
              fontSize: 18,
              fontWeight: 800,
            }}
          >
            Department selection
          </h2>

          <div
            style={{
              marginTop: 12,
              padding: 14,
              borderRadius: 12,
              background: "#F9FAFB",
              border: `1px solid ${BRAND.border}`,
              fontWeight: 600,
              whiteSpace: "pre-wrap",
            }}
          >
            {loadError}
          </div>

          <button
            onClick={() =>
                router.push(
                  `/assessments/${assessmentId ?? ""}?email=${encodeURIComponent(
                    emailFromLink
                  )}&token=${encodeURIComponent(tokenFromLink)}`
                )
              }
            style={{
              marginTop: 18,
              background: BRAND.dark,
              color: "white",
              border: "none",
              padding: "10px 14px",
              borderRadius: 12,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Continue
          </button>
        </div>
      </main>
    );
  }

  // Locked assessment: no picker. Just tell them and continue.
  if (isLocked) {
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
        <div style={shellCard}>
          {created && (
            <div
              style={{
                marginBottom: 14,
                padding: 14,
                borderRadius: 14,
                background: "#ECFDF5",
                border: "1px solid #A7F3D0",
                color: "#065F46",
                fontWeight: 700,
              }}
            >
              Assessment created successfully.
            </div>
          )}

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
            Assessment is locked
          </div>
          <div style={{ color: BRAND.muted, marginTop: 8, fontWeight: 600 }}>
            Department can no longer be changed.
          </div>

          {lockedDept && (
            <div style={{ marginTop: 10, color: BRAND.muted }}>
              Locked department:{" "}
              <b style={{ color: BRAND.dark }}>{labelDept(lockedDept)}</b>
            </div>
          )}

          <button
            onClick={() => router.push(`/assessments/${assessmentId ?? ""}`)}
            style={{
              marginTop: 18,
              background: BRAND.dark,
              color: "white",
              border: "none",
              padding: "10px 14px",
              borderRadius: 12,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Continue
          </button>
        </div>
      </main>
    );
  }

  // Team-only locked: no picker. Show info + continue.
  if (lockedDept) {
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
        <div style={shellCard}>
          {created && (
            <div
              style={{
                marginBottom: 14,
                padding: 14,
                borderRadius: 14,
                background: "#ECFDF5",
                border: "1px solid #A7F3D0",
                color: "#065F46",
                fontWeight: 700,
              }}
            >
              Assessment created successfully.
            </div>
          )}

          <BrandWordmark />
          <div
            style={{
              marginTop: 14,
              fontFamily: montserrat.style.fontFamily,
              fontSize: 20,
              fontWeight: 800,
              color: BRAND.dark,
              lineHeight: 1.3,
            }}
          >
            This assessment is locked to {labelDept(lockedDept)}
          </div>
          <div style={{ color: BRAND.muted, marginTop: 8 }}>
            You don’t need to choose a department. We’ll include the org-wide questions plus{" "}
            <b style={{ color: BRAND.dark }}>{labelDept(lockedDept)}</b>.
          </div>

          <button
            onClick={() => router.push(`/assessments/${assessmentId ?? ""}`)}
            style={{
              marginTop: 18,
              background: BRAND.dark,
              color: "white",
              border: "none",
              padding: "10px 14px",
              borderRadius: 12,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Continue
          </button>
        </div>
      </main>
    );
  }

  // Org-wide: show intake + picker + continue.
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
      <div style={shellCard}>
        {created && (
          <div
            style={{
              marginBottom: 14,
              padding: 14,
              borderRadius: 14,
              background: "#ECFDF5",
              border: "1px solid #A7F3D0",
              color: "#065F46",
              fontWeight: 700,
            }}
          >
            Assessment created successfully.
          </div>
        )}

        <BrandWordmark />
        <div
          style={{
            marginTop: 14,
            fontFamily: montserrat.style.fontFamily,
            fontSize: "clamp(1.1rem, 3vw, 1.35rem)",
            fontWeight: 800,
            color: BRAND.dark,
            letterSpacing: "-0.02em",
          }}
        >
          Welcome to the Northline diagnostic
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: BRAND.dark }}>
            {assessment?.organization?.name ?? "Organization"}
          </div>

          <div style={{ color: BRAND.greyBlue, marginTop: 6, fontSize: 13, fontWeight: 500 }}>
            Assessment ID: <span style={{ fontWeight: 700, color: BRAND.dark }}>{assessmentId ?? ""}</span>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: BRAND.dark }}>
            1) Your department or team
          </div>
          <div style={{ color: BRAND.muted, marginTop: 6, lineHeight: 1.5 }}>
            This identifies your current function for reporting and narrative context. The questions you see are set by
            your administrator (assessment configuration)—not by this selection.
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {PARTICIPANT_DEPARTMENT_CODES.map((dept) => {
              const isSelected = selected === dept;
              return (
                <button
                  key={dept}
                  disabled={saving}
                  onClick={() => setSelected(dept)}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: `1.5px solid ${isSelected ? BRAND.dark : BRAND.lightAzure}`,
                    background: isSelected ? BRAND.cyan : BRAND.lightBlue,
                    color: BRAND.dark,
                    fontWeight: 700,
                    cursor: saving ? "not-allowed" : "pointer",
                    opacity: saving ? 0.75 : 1,
                    boxShadow: isSelected ? "0 6px 18px rgba(52, 176, 180, 0.25)" : "none",
                    transition: "box-shadow 0.15s ease, border-color 0.15s ease",
                  }}
                >
                  {labelDept(dept)}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 12, color: BRAND.muted, fontSize: 12 }}>
            You can’t change department after the assessment is locked.
          </div>
        </div>

        <div style={{ marginTop: 22 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: BRAND.dark }}>
            2) Seniority level
          </div>

          <select
            value={seniority}
            onChange={(e) => setSeniority(e.target.value)}
            disabled={saving}
            style={{
              marginTop: 10,
              width: "100%",
              padding: "10px 12px",
              borderRadius: 12,
              border: `1px solid ${BRAND.border}`,
              background: "#fff",
              fontWeight: 700,
            }}
          >
            <option value="">Select…</option>
            <option value="IC">Individual Contributor</option>
            <option value="Manager">Manager</option>
            <option value="Director">Director</option>
            <option value="VP">VP</option>
            <option value="C-Level">C-Level</option>
            <option value="Owner">Owner / Founder</option>
          </select>
        </div>

        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: BRAND.dark }}>
            3) Role / title
          </div>

          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={saving}
            placeholder="Example: Head of Sales, RevOps Manager, COO…"
            style={{
              marginTop: 10,
              width: "100%",
              padding: "10px 12px",
              borderRadius: 12,
              border: `1px solid ${BRAND.border}`,
              background: "#fff",
              fontWeight: 700,
            }}
          />
        </div>

        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: BRAND.dark }}>
            4) AI automation opportunities
          </div>
          <div style={{ color: BRAND.muted, marginTop: 6 }}>
            Think about your day-to-day work. List and describe 2 instances today where AI
            automation could make your job easier, make you more efficient, or help you make more money.
            Even if you don’t know where AI can help, list areas you’d like to see improved.
          </div>

          <textarea
            value={aiNotes}
            onChange={(e) => setAiNotes(e.target.value)}
            disabled={saving}
            rows={5}
            style={{
              marginTop: 10,
              width: "100%",
              padding: "10px 12px",
              borderRadius: 12,
              border: `1px solid ${BRAND.border}`,
              background: "#fff",
              fontWeight: 700,
            }}
          />
          <div style={{ marginTop: 6, color: BRAND.muted, fontSize: 12 }}>
            {aiNotes.length}/5000
          </div>
        </div>

        <button
          disabled={saving}
          onClick={saveIntakeAndContinue}
          style={{
            marginTop: 20,
            width: "100%",
            background: saving ? "#98a2b3" : BRAND.dark,
            color: "white",
            border: "none",
            padding: "12px 14px",
            borderRadius: 12,
            fontWeight: 900,
            cursor: saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Continue to Assessment"}
        </button>
      </div>
    </main>
  );
}