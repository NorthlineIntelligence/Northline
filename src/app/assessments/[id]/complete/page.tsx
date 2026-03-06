"use client";

import React, { useEffect, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

const BRAND = {
  dark: "#173464",
  cyan: "#34b0b4",
  bg: "#F6F8FC",
  card: "#FFFFFF",
  border: "#E6EAF2",
  text: "#0B1220",
  muted: "#4B5565",
};

function safeLower(s: string) {
  return (s ?? "").trim().toLowerCase();
}
function safeTrim(s: string) {
  return (s ?? "").trim();
}

export default function AssessmentCompletePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const assessmentId =
    typeof params?.id === "string" && params.id.length > 0 ? params.id : null;

  // Read invite auth from URL first; fall back to sessionStorage.
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

  // Persist if present (so refresh/navigation doesn’t break)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (inviteEmail) window.sessionStorage.setItem("invite_email", inviteEmail);
      if (inviteToken) window.sessionStorage.setItem("invite_token", inviteToken);
    } catch {}
  }, [inviteEmail, inviteToken]);

  // Build querystring for all navigation
  const authQs = useMemo(() => {
    const qs = new URLSearchParams();
    if (inviteEmail) qs.set("email", inviteEmail);
    if (inviteToken) qs.set("token", inviteToken);
    const s = qs.toString();
    return s ? `?${s}` : "";
  }, [inviteEmail, inviteToken]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: BRAND.bg,
        padding: 32,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto",
        color: BRAND.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 720,
          background: BRAND.card,
          border: `1px solid ${BRAND.border}`,
          borderRadius: 16,
          padding: 24,
          boxShadow: "0 8px 30px rgba(15, 23, 42, 0.06)",
        }}
      >
        <div style={{ fontSize: 24, fontWeight: 980, color: BRAND.dark }}>
          Thank you.
        </div>

        <div style={{ marginTop: 8, color: BRAND.muted, fontWeight: 700, lineHeight: 1.45 }}>
          Your responses have been recorded. Next, review your results and executive narrative (once available).
        </div>

        {/* Helpful warning if invite auth is missing */}
        {!inviteEmail || !inviteToken ? (
          <div style={{ marginTop: 12, color: "#b42318", fontWeight: 800, fontSize: 12 }}>
            This page is missing your invite email/token. If you hit issues accessing results, ask your admin to resend
            the invite link.
          </div>
        ) : null}

        <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => {
              if (!assessmentId) return;
              router.push(`/assessments/${assessmentId}/results${authQs}`);
            }}
            disabled={!assessmentId}
            style={{
              background: BRAND.cyan,
              color: BRAND.dark,
              border: `1px solid ${BRAND.border}`,
              padding: "10px 14px",
              borderRadius: 12,
              fontWeight: 950,
              cursor: assessmentId ? "pointer" : "not-allowed",
              opacity: assessmentId ? 1 : 0.6,
            }}
          >
            View results →
          </button>

          <button
            onClick={() => {
              if (!assessmentId) return;
              router.push(`/assessments/${assessmentId}/narrative${authQs}`);
            }}
            disabled={!assessmentId}
            style={{
              background: "#FFFFFF",
              color: BRAND.dark,
              border: `1px solid ${BRAND.border}`,
              padding: "10px 14px",
              borderRadius: 12,
              fontWeight: 850,
              cursor: assessmentId ? "pointer" : "not-allowed",
              opacity: assessmentId ? 1 : 0.6,
            }}
          >
            Executive narrative →
          </button>

          <button
            onClick={() => {
              if (!assessmentId) return;
              router.push(`/assessments/${assessmentId}${authQs}`);
            }}
            disabled={!assessmentId}
            style={{
              background: "#FFFFFF",
              color: BRAND.dark,
              border: `1px solid ${BRAND.border}`,
              padding: "10px 14px",
              borderRadius: 12,
              fontWeight: 850,
              cursor: assessmentId ? "pointer" : "not-allowed",
              opacity: assessmentId ? 1 : 0.6,
            }}
          >
            Back to assessment
          </button>
        </div>

        <div style={{ marginTop: 14, color: BRAND.muted, fontSize: 12, fontWeight: 700 }}>
          Assessment: {assessmentId ?? "—"}
        </div>
      </div>
    </main>
  );
}