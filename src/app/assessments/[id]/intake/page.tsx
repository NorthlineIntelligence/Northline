"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

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

  const [department, setDepartment] = useState<(typeof DEPARTMENTS)[number] | "">("");
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
    <main style={{ minHeight: "100vh", padding: 28, background: "#F6F8FC" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", background: "#fff", border: "1px solid #E6EAF2", borderRadius: 16, padding: 20 }}>
        <div style={{ fontWeight: 900, fontSize: 18, color: "#173464" }}>Participant Intake</div>
        <div style={{ marginTop: 6, color: "#4B5565", fontWeight: 700 }}>
          {loadingOrg ? "Loading organization…" : `Organization: ${orgName}`}
        </div>

        <div style={{ marginTop: 18, display: "grid", gap: 14 }}>
          <div>
            <div style={{ fontWeight: 900, marginBottom: 6, color: "#173464" }}>Department</div>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value as any)}
              style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #E6EAF2", fontWeight: 700 }}
            >
              <option value="">Select…</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={{ fontWeight: 900, marginBottom: 6, color: "#173464" }}>Seniority level</div>
            <select
              value={seniority}
              onChange={(e) => setSeniority(e.target.value as any)}
              style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #E6EAF2", fontWeight: 700 }}
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
            <div style={{ fontWeight: 900, marginBottom: 6, color: "#173464" }}>
              Day-to-day opportunities for AI automation
            </div>
            <div style={{ color: "#4B5565", fontWeight: 700, fontSize: 13, lineHeight: 1.4, marginBottom: 8 }}>
              Think about your work today. List and describe two instances where AI automation could make your job easier,
              improve efficiency, or help you generate more revenue. If you’re unsure, describe areas you wish were smoother.
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={6}
              placeholder="Example: Follow-up emails after demos…"
              style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #E6EAF2", fontWeight: 700, lineHeight: 1.5 }}
            />
          </div>

          {err ? (
            <div style={{ background: "#FFF5F5", border: "1px solid #FCA5A5", color: "#7F1D1D", padding: 12, borderRadius: 12, fontWeight: 800 }}>
              {err}
            </div>
          ) : null}

          <button
            type="button"
            disabled={!canContinue || saving}
            onClick={() => setConfirmOpen(true)}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #E6EAF2",
              background: canContinue ? "#34b0b4" : "#D7DEE8",
              color: "#173464",
              fontWeight: 900,
              cursor: canContinue ? "pointer" : "not-allowed",
            }}
          >
            {saving ? "Saving…" : "Go To Assessment"}
          </button>
        </div>
      </div>

      {/* Confirm Modal */}
      {confirmOpen ? (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(11,18,32,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 18
        }}>
          <div style={{ width: "100%", maxWidth: 520, background: "#fff", borderRadius: 16, border: "1px solid #E6EAF2", padding: 18 }}>
            <div style={{ fontWeight: 900, fontSize: 16, color: "#173464" }}>One second…</div>
            <div style={{ marginTop: 10, fontWeight: 800, color: "#0B1220" }}>
              Please confirm this is your organization:
            </div>
            <div style={{ marginTop: 6, fontWeight: 900, color: "#173464", fontSize: 18 }}>
              {orgName}
            </div>
            <div style={{ marginTop: 10, color: "#4B5565", fontWeight: 700, fontSize: 13 }}>
              If this is not your organization, please let your administrator know.
            </div>

            <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={saving}
                style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid #E6EAF2", background: "#fff", fontWeight: 900, cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveAndGo}
                disabled={saving}
                style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid #E6EAF2", background: "#34b0b4", color: "#173464", fontWeight: 900, cursor: "pointer" }}
              >
                Confirm & Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}