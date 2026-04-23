"use client";

import React, { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { NORTHLINE_BRAND as BRAND, NORTHLINE_SHELL_BG as shellBackground } from "@/lib/northlineBrand";

export default function CustomerAccessPage() {
  return (
    <React.Suspense fallback={null}>
      <CustomerAccessInner />
    </React.Suspense>
  );
}

function CustomerAccessInner() {
  const searchParams = useSearchParams();
  const emailPrefill = (searchParams.get("email") ?? "").trim().toLowerCase();
  const assessmentId = (searchParams.get("assessmentId") ?? "").trim();
  const error = (searchParams.get("error") ?? "").trim();

  const [email, setEmail] = useState(emailPrefill);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const errorText = useMemo(() => {
    if (!error) return null;
    if (error === "no_portal_access") return "No customer portal access is enabled for this email yet.";
    if (error === "already_claimed")
      return "This portal invite is already linked to another account. Contact support for access updates.";
    if (error === "exchange_failed") return "Sign-in link validation failed. Please request a new login link.";
    return "We could not complete sign-in. Please request a fresh login link.";
  }, [error]);

  async function onSend() {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/customer/auth/send-magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          assessmentId: assessmentId || undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setResult(json?.error ?? `Request failed (${res.status}).`);
      } else {
        setResult("Magic link sent. Check your inbox to complete sign-in.");
      }
    } catch (e: any) {
      setResult(e?.message ?? "Could not send magic link.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: shellBackground,
        padding: 24,
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          background: BRAND.card,
          border: `1px solid ${BRAND.border}`,
          borderRadius: 18,
          boxShadow: "0 12px 36px rgba(15, 23, 42, 0.08)",
          padding: 24,
        }}
      >
        <div style={{ fontSize: 24, fontWeight: 900, color: BRAND.dark }}>Northline Customer Portal</div>
        <div style={{ marginTop: 8, color: BRAND.dark, fontWeight: 750 }}>
          Secure, organization-scoped access for Executive Insights and assessment progress.
        </div>

        {errorText ? (
          <div
            style={{
              marginTop: 14,
              background: "#FFF5F5",
              border: "1px solid #FED7D7",
              borderRadius: 12,
              padding: 12,
              color: "#B42318",
              fontWeight: 800,
            }}
          >
            {errorText}
          </div>
        ) : null}

        <div style={{ marginTop: 18, display: "grid", gap: 8 }}>
          <label style={{ fontWeight: 800, color: BRAND.dark }}>Work Email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            style={{
              width: "100%",
              borderRadius: 12,
              border: `1px solid ${BRAND.border}`,
              padding: "10px 12px",
              fontSize: 14,
              fontFamily: "inherit",
              color: BRAND.dark,
              fontWeight: 700,
            }}
          />
        </div>

        <button
          onClick={onSend}
          disabled={submitting || !email}
          style={{
            marginTop: 16,
            background: submitting || !email ? "#98a2b3" : BRAND.dark,
            color: "white",
            border: "none",
            borderRadius: 12,
            padding: "10px 14px",
            fontWeight: 900,
            cursor: submitting || !email ? "not-allowed" : "pointer",
          }}
        >
          {submitting ? "Sending..." : "Send Secure Login Link"}
        </button>

        {result ? (
          <div
            style={{
              marginTop: 12,
              background: "#F8FAFC",
              border: `1px solid ${BRAND.border}`,
              borderRadius: 12,
              padding: 12,
              color: BRAND.dark,
              fontWeight: 750,
            }}
          >
            {result}
          </div>
        ) : null}
      </div>
    </main>
  );
}
