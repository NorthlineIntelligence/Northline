"use client";

import React, { useEffect, useMemo } from "react";
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

const BRAND = {
  dark: "#173464",
  cyan: "#34b0b4",
  greyBlue: "#66819e",
  lightAzure: "#cdd8df",
  lightBlue: "#fcfcfe",
  border: "#E6EAF2",
  text: "#0B1220",
  muted: "#4B5565",
  card: "#FFFFFF",
};

const shellBackground = `radial-gradient(ellipse 100% 80% at 100% -10%, rgba(52, 176, 180, 0.11) 0%, transparent 55%),
  radial-gradient(ellipse 80% 60% at -5% 100%, rgba(23, 52, 100, 0.08) 0%, transparent 48%),
  ${BRAND.lightBlue}`;

const glassCard = {
  background: "rgba(255, 255, 255, 0.92)",
  backdropFilter: "saturate(160%) blur(14px)",
  WebkitBackdropFilter: "saturate(160%) blur(14px)",
  border: `1px solid rgba(205, 216, 223, 0.65)`,
  boxShadow: "0 4px 28px rgba(23, 52, 100, 0.07), 0 1px 2px rgba(15, 23, 42, 0.04)",
} as const;

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (inviteEmail) window.sessionStorage.setItem("invite_email", inviteEmail);
      if (inviteToken) window.sessionStorage.setItem("invite_token", inviteToken);
    } catch {}
  }, [inviteEmail, inviteToken]);

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
        background: shellBackground,
        padding: "clamp(20px, 4vw, 40px)",
        fontFamily: openSans.style.fontFamily,
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
          borderRadius: 20,
          padding: 28,
          ...glassCard,
        }}
      >
        <BrandWordmark />
        <div
          style={{
            marginTop: 20,
            fontFamily: montserrat.style.fontFamily,
            fontSize: "clamp(1.5rem, 4vw, 1.85rem)",
            fontWeight: 800,
            color: BRAND.dark,
            letterSpacing: "-0.03em",
            lineHeight: 1.2,
          }}
        >
          Thank you
        </div>

        <div
          style={{
            marginTop: 12,
            color: BRAND.greyBlue,
            fontWeight: 500,
            lineHeight: 1.55,
            fontSize: 15,
          }}
        >
          Your responses have been recorded. Next, open your executive narrative when it is available.
        </div>

        {!inviteEmail || !inviteToken ? (
          <div style={{ marginTop: 14, color: "#b42318", fontWeight: 700, fontSize: 13, lineHeight: 1.45 }}>
            This page is missing your invite email/token. If you hit issues accessing your narrative, ask your admin to
            resend the invite link.
          </div>
        ) : null}

        <div style={{ marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => {
              if (!assessmentId) return;
              router.push(`/assessments/${assessmentId}/narrative${authQs}`);
            }}
            disabled={!assessmentId}
            style={{
              background: BRAND.cyan,
              color: BRAND.dark,
              border: "none",
              padding: "14px 22px",
              borderRadius: 14,
              fontWeight: 800,
              fontSize: 14,
              letterSpacing: "0.02em",
              cursor: assessmentId ? "pointer" : "not-allowed",
              opacity: assessmentId ? 1 : 0.55,
              boxShadow: assessmentId ? "0 6px 22px rgba(52, 176, 180, 0.35)" : "none",
            }}
          >
            Executive narrative →
          </button>

          <button
            type="button"
            onClick={() => {
              if (!assessmentId) return;
              router.push(`/assessments/${assessmentId}${authQs}`);
            }}
            disabled={!assessmentId}
            style={{
              background: "#fff",
              color: BRAND.dark,
              border: `1px solid ${BRAND.lightAzure}`,
              padding: "14px 22px",
              borderRadius: 14,
              fontWeight: 700,
              cursor: assessmentId ? "pointer" : "not-allowed",
              opacity: assessmentId ? 1 : 0.55,
            }}
          >
            Back to assessment
          </button>
        </div>

        <div
          style={{
            marginTop: 22,
            paddingTop: 18,
            borderTop: `1px solid ${BRAND.lightAzure}`,
            color: BRAND.greyBlue,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.02em",
          }}
        >
          Assessment ID · {assessmentId ?? "—"}
        </div>
      </div>
    </main>
  );
}
