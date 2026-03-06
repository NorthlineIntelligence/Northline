"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

/**
 * IMPORTANT:
 * - The participant API you showed returns 401 with:
 *   "No session found. Provide email in request body..."
 *   So this page MUST send { email } in the POST body.
 *
 * - Department values MUST match your Prisma enum exactly.
 *   If your enum uses ALL (not "All"), use "ALL".
 */
const DEPARTMENTS = [
  "ALL",
  "SALES",
  "MARKETING",
  "CUSTOMER_SUCCESS",
  "OPS",
  "REVOPS",
  "ENGINEERING",
  "PRODUCT",
  "GTM",
] as const;

type Department = (typeof DEPARTMENTS)[number];

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

const BRAND = {
  dark: "#173464",
  cyan: "#34b0b4",
  bg: "#F6F8FC",
  card: "#FFFFFF",
  border: "#E6EAF2",
  text: "#0B1220",
  muted: "#4B5565",
};

function labelDept(d: string) {
  const up = String(d ?? "").toUpperCase();
  if (up === "ALL") return "ORG-WIDE (ALL)";
  return up.replaceAll("_", " ");
}

function normalizeDeptForApi(d: Department): Department | null {
  // Your API route normalizes ALL -> null (meaning org-wide)
  return d === "ALL" ? null : d;
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
  const [selected, setSelected] = useState<Department | null>(null);

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
          (DEPARTMENTS as readonly string[]).includes(existingDept)
        ) {
          setSelected(existingDept as Department);
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
            if (meta?.locked_at == null && meta?.locked_department) {
              await fetch(`/api/assessments/${assessmentId}/participant`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  email: emailFromLink,
                  department: meta.locked_department,
                }),
              }).catch(() => {});
              if (!cancelled) setSelected(meta.locked_department);
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
  }, [assessmentId, emailFromLink]);

  async function saveIntakeAndContinue() {
    if (!assessmentId) return;

    if (!emailFromLink || !tokenFromLink) {
      setLoadError(
        "This invite link is missing your email or token. Ask your admin to resend the invite link."
      );
      return;
    }

    if (!selected && !lockedDept) {
      setLoadError("Please choose your department to continue.");
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
        department: lockedDept ? lockedDept : normalizeDeptForApi(selected as Department),
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
          background: BRAND.bg,
          padding: 32,
          fontFamily: "system-ui",
          color: BRAND.text,
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            background: BRAND.card,
            border: `1px solid ${BRAND.border}`,
            borderRadius: 16,
            padding: 24,
            boxShadow: "0 8px 30px rgba(15, 23, 42, 0.06)",
          }}
        >
          {created && (
            <div
              style={{
                marginBottom: 12,
                padding: 12,
                borderRadius: 12,
                background: "#ECFDF5",
                border: "1px solid #A7F3D0",
                color: "#065F46",
                fontWeight: 800,
              }}
            >
              ✅ Assessment created successfully.
            </div>
          )}

          <div style={{ fontSize: 22, fontWeight: 900, color: BRAND.dark }}>
            Northline AI Readiness
          </div>
          <div style={{ color: BRAND.muted, marginTop: 6 }}>Loading…</div>
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
          fontFamily: "system-ui",
          color: BRAND.text,
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            background: BRAND.card,
            border: `1px solid ${BRAND.border}`,
            borderRadius: 16,
            padding: 24,
            boxShadow: "0 8px 30px rgba(15, 23, 42, 0.06)",
          }}
        >
          {created && (
            <div
              style={{
                marginBottom: 12,
                padding: 12,
                borderRadius: 12,
                background: "#ECFDF5",
                border: "1px solid #A7F3D0",
                color: "#065F46",
                fontWeight: 800,
              }}
            >
              ✅ Assessment created successfully.
            </div>
          )}

          <h2 style={{ margin: 0, color: BRAND.dark }}>Department Selection</h2>

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
          background: BRAND.bg,
          padding: 32,
          fontFamily: "system-ui",
          color: BRAND.text,
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            background: BRAND.card,
            border: `1px solid ${BRAND.border}`,
            borderRadius: 16,
            padding: 24,
            boxShadow: "0 8px 30px rgba(15, 23, 42, 0.06)",
          }}
        >
          {created && (
            <div
              style={{
                marginBottom: 12,
                padding: 12,
                borderRadius: 12,
                background: "#ECFDF5",
                border: "1px solid #A7F3D0",
                color: "#065F46",
                fontWeight: 800,
              }}
            >
              ✅ Assessment created successfully.
            </div>
          )}

          <div style={{ fontSize: 22, fontWeight: 900, color: BRAND.dark }}>
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
          background: BRAND.bg,
          padding: 32,
          fontFamily: "system-ui",
          color: BRAND.text,
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            background: BRAND.card,
            border: `1px solid ${BRAND.border}`,
            borderRadius: 16,
            padding: 24,
            boxShadow: "0 8px 30px rgba(15, 23, 42, 0.06)",
          }}
        >
          {created && (
            <div
              style={{
                marginBottom: 12,
                padding: 12,
                borderRadius: 12,
                background: "#ECFDF5",
                border: "1px solid #A7F3D0",
                color: "#065F46",
                fontWeight: 800,
              }}
            >
              ✅ Assessment created successfully.
            </div>
          )}

          <div style={{ fontSize: 22, fontWeight: 900, color: BRAND.dark }}>
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
        background: BRAND.bg,
        padding: 32,
        fontFamily: "system-ui",
        color: BRAND.text,
      }}
    >
      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          background: BRAND.card,
          border: `1px solid ${BRAND.border}`,
          borderRadius: 16,
          padding: 24,
          boxShadow: "0 8px 30px rgba(15, 23, 42, 0.06)",
        }}
      >
        {created && (
          <div
            style={{
              marginBottom: 12,
              padding: 12,
              borderRadius: 12,
              background: "#ECFDF5",
              border: "1px solid #A7F3D0",
              color: "#065F46",
              fontWeight: 800,
            }}
          >
            ✅ Assessment created successfully.
          </div>
        )}

<div style={{ fontSize: 22, fontWeight: 900, color: BRAND.dark }}>
  Welcome to the Northline Diagnostic
</div>

<div style={{ marginTop: 8 }}>
  <div
    style={{
      fontSize: 14,
      fontWeight: 800,
      color: BRAND.dark,
    }}
  >
    {assessment?.organization?.name ?? "Organization"}
  </div>

  <div style={{ color: BRAND.muted, marginTop: 4 }}>
    Assessment ID:{" "}
    <span style={{ fontWeight: 800 }}>
      {assessmentId ?? ""}
    </span>
  </div>
</div>

        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: BRAND.dark }}>
            1) Choose your department
          </div>
          <div style={{ color: BRAND.muted, marginTop: 6 }}>
            Your answers will be contextualized to your functional role.
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {DEPARTMENTS.map((dept) => {
              const isSelected = selected === dept;
              return (
                <button
                  key={dept}
                  disabled={saving}
                  onClick={() => setSelected(dept)}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: `1px solid ${BRAND.border}`,
                    background: isSelected ? BRAND.cyan : BRAND.dark,
                    color: "white",
                    fontWeight: 800,
                    cursor: saving ? "not-allowed" : "pointer",
                    opacity: saving ? 0.75 : 1,
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