"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { NORTHLINE_BRAND as BRAND, NORTHLINE_SHELL_BG as shellBackground } from "@/lib/northlineBrand";

type OrgPayload = {
  id: string;
  name: string;
  industry: string | null;
  size: string | null;
  growth_stage: string | null;
  primary_pressures: string | null;
  website: string | null;
  context_notes: string | null;
  show_admin_controls: boolean;
};

type LoadResponse = {
  ok: boolean;
  isLocked: boolean;
  participantsTotal: number;
  participantsCompleted: number;
  organization: OrgPayload;
};

type ParticipantRow = {
  id: string;
  email: string | null;
  department: string | null;
  role: string | null;
  seniority_level: string | null;
  invite_sent_at: string | null;
  invite_accepted_at: string | null;
  completed_at: string | null;
  created_at: string;
};

type ParticipantsResponse = {
  ok: boolean;
  isLocked: boolean;
  participantsTotal: number;
  participantsCompleted: number;
  participants: ParticipantRow[];
};

function fmtDate(s: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export default function AdminAssessmentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const assessmentId =
    typeof params?.id === "string" && params.id.length > 0 ? params.id : null;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isLocked, setIsLocked] = useState(false);
  const [participantsTotal, setParticipantsTotal] = useState(0);
  const [participantsCompleted, setParticipantsCompleted] = useState(0);

  const [org, setOrg] = useState<OrgPayload | null>(null);

  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [size, setSize] = useState("");
  const [growthStage, setGrowthStage] = useState("");
  const [primaryPressures, setPrimaryPressures] = useState("");
  const [website, setWebsite] = useState("");
  const [contextNotes, setContextNotes] = useState("");
  const [showAdminControls, setShowAdminControls] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);

  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [participantsError, setParticipantsError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);

  const [inviteEmailsText, setInviteEmailsText] = useState("");
const [inviting, setInviting] = useState(false);
const [inviteResult, setInviteResult] = useState<string | null>(null);

const [resendingEmail, setResendingEmail] = useState<string | null>(null);
const [resendResult, setResendResult] = useState<string | null>(null);

const [deletingParticipantId, setDeletingParticipantId] = useState<string | null>(null);
const [deleteResult, setDeleteResult] = useState<string | null>(null);

async function resendInvite(email: string | null) {
  if (!assessmentId) return;

  const to = (email ?? "").trim().toLowerCase();
  if (!to) {
    setResendResult("Cannot resend: participant has no email.");
    return;
  }

  const ok = window.confirm(`Resend invite to ${to}?`);
  if (!ok) return;

  setResendingEmail(to);
  setResendResult(null);

  const res = await fetch(`/api/admin/assessments/${assessmentId}/participants/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      emails: [to],
      expiresInHours: 24 * 7,
    }),
  });

  const json = await res.json().catch(() => ({} as any));

  if (!res.ok) {
    setResendResult(`Error (${res.status}): ${json?.error ?? "Resend failed."}`);
    setResendingEmail(null);
    return;
  }

  setResendResult(`Resent invite to ${to}.`);
  setResendingEmail(null);

  await refreshParticipants();
}

async function deleteParticipant(participantId: string) {
  if (!assessmentId) return;

  const ok = window.confirm("Delete this participant? This cannot be undone.");
  if (!ok) return;

  setDeletingParticipantId(participantId);
  setDeleteResult(null);

  const url = `/api/admin/assessments/${assessmentId}/participants?participantId=${encodeURIComponent(
    participantId
  )}`;

  const res = await fetch(url, {
    method: "DELETE",
    credentials: "include",
  });

  const json = await res.json().catch(() => ({} as any));

  if (!res.ok) {
    if (res.status === 423) {
      setDeleteResult("Locked: participants are read-only.");
    } else {
      setDeleteResult(`Error (${res.status}): ${json?.error ?? "Delete failed."}`);
    }
    setDeletingParticipantId(null);
    return;
  }

  setDeleteResult("Deleted.");
  setDeletingParticipantId(null);

  await refreshParticipants();
}
 
  async function refreshParticipants() {
    if (!assessmentId) return;

    setParticipantsLoading(true);
    setParticipantsError(null);

    const pRes = await fetch(`/api/admin/assessments/${assessmentId}/participants`, {
      method: "GET",
      credentials: "include",
    });

    if (!pRes.ok) {
      const txt = await pRes.text();
      setParticipantsError(`Failed to load participants: ${pRes.status} ${txt}`);
      setParticipants([]);
      setParticipantsLoading(false);
      return;
    }

    const pJson = (await pRes.json()) as ParticipantsResponse;

    if (!pJson?.ok || !Array.isArray(pJson.participants)) {
      setParticipantsError("Failed to load participants.");
      setParticipants([]);
      setParticipantsLoading(false);
      return;
    }

    setParticipants(pJson.participants);
    setParticipantsLoading(false);
  }

  async function sendInvites() {
    if (!assessmentId) return;

    const raw = inviteEmailsText.trim();
    if (!raw) {
      setInviteResult("Please paste at least one email.");
      return;
    }

    const emails = Array.from(
      new Set(
        raw
          .split(/[,\n]/g)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      )
    );

    if (emails.length === 0) {
      setInviteResult("Please paste at least one email.");
      return;
    }

    setInviting(true);
    setInviteResult(null);

    const res = await fetch(`/api/admin/assessments/${assessmentId}/participants/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        emails,
        expiresInHours: 24 * 7,
      }),
    });

    const json = await res.json().catch(() => ({} as any));

    if (!res.ok) {
      setInviteResult(`Error (${res.status}): ${json?.error ?? "Invite failed."}`);
      setInviting(false);
      return;
    }

    const invited = Number(json?.invited ?? emails.length);
    setInviteResult(`Invited ${invited}.`);

    setInviteEmailsText("");
    setInviting(false);

    await refreshParticipants();
  }

  const lockLabel = useMemo(() => {
    if (!participantsTotal) return "No participants yet";
    return `${participantsCompleted}/${participantsTotal} completed`;
  }, [participantsCompleted, participantsTotal]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      setSaveResult(null);

      setParticipantsLoading(true);
      setParticipantsError(null);

      if (!assessmentId) {
        setLoadError("Missing assessment id in route.");
        setLoading(false);
        setParticipantsLoading(false);
        return;
      }

      try {
        // --- Load organization (admin-only) ---
        const res = await fetch(`/api/assessments/${assessmentId}/organization`, {
          method: "GET",
          credentials: "include",
        });

        if (!res.ok) {
          const txt = await res.text();
          if (!cancelled) {
            setLoadError(`Failed to load: ${res.status} ${txt}`);
            setLoading(false);
            setParticipantsLoading(false);
          }
          return;
        }

        const json = (await res.json()) as LoadResponse;

        if (!json?.ok || !json.organization) {
          if (!cancelled) {
            setLoadError("Failed to load organization.");
            setLoading(false);
            setParticipantsLoading(false);
          }
          return;
        }

        if (!cancelled) {
          setIsLocked(Boolean(json.isLocked));
          setParticipantsTotal(Number(json.participantsTotal ?? 0));
          setParticipantsCompleted(Number(json.participantsCompleted ?? 0));

          setOrg(json.organization);

          setName(json.organization.name ?? "");
          setIndustry(json.organization.industry ?? "");
          setSize(json.organization.size ?? "");
          setGrowthStage(json.organization.growth_stage ?? "");
          setPrimaryPressures(json.organization.primary_pressures ?? "");
          setWebsite(json.organization.website ?? "");
          setContextNotes(json.organization.context_notes ?? "");
          setShowAdminControls(Boolean(json.organization.show_admin_controls));

          setLoading(false);
        }

        // --- Load participants list (admin-only) ---
        const pRes = await fetch(`/api/admin/assessments/${assessmentId}/participants`, {
          method: "GET",
          credentials: "include",
        });

        if (!pRes.ok) {
          const txt = await pRes.text();
          if (!cancelled) {
            setParticipantsError(`Failed to load participants: ${pRes.status} ${txt}`);
            setParticipants([]);
            setParticipantsLoading(false);
          }
          return;
        }

        const pJson = (await pRes.json()) as ParticipantsResponse;

        if (!pJson?.ok || !Array.isArray(pJson.participants)) {
          if (!cancelled) {
            setParticipantsError("Failed to load participants.");
            setParticipants([]);
            setParticipantsLoading(false);
          }
          return;
        }

        if (!cancelled) {
          // Keep org route as the source for isLocked/counts in this page for now,
          // but still show the list from the participants route.
          setParticipants(pJson.participants);
          setParticipantsLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setLoadError(e?.message ?? String(e));
          setLoading(false);
          setParticipantsError(e?.message ?? String(e));
          setParticipantsLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [assessmentId]);

  async function save() {
    if (!assessmentId) return;

    setSaving(true);
    setSaveResult(null);

    const res = await fetch(`/api/assessments/${assessmentId}/organization`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        name,
        industry,
        size,
        growth_stage: growthStage,
        primary_pressures: primaryPressures,
        website,
        context_notes: contextNotes,
        show_admin_controls: showAdminControls,
      }),
    });

    const json = await res.json().catch(() => ({} as any));

    if (!res.ok) {
      if (res.status === 423) {
        setSaveResult("Locked: all participants have completed. Organization is read-only.");
      } else {
        setSaveResult(`Error (${res.status}): ${json?.error ?? "Save failed."}`);
      }
      setSaving(false);
      return;
    }

    setSaveResult("Saved.");
    setSaving(false);

    if (json?.organization) {
      const updated = json.organization as OrgPayload;
      setOrg(updated);
      setName(updated.name ?? "");
      setIndustry(updated.industry ?? "");
      setSize(updated.size ?? "");
      setGrowthStage(updated.growth_stage ?? "");
      setPrimaryPressures(updated.primary_pressures ?? "");
      setWebsite(updated.website ?? "");
      setContextNotes(updated.context_notes ?? "");
      setShowAdminControls(Boolean(updated.show_admin_controls));
    }
  }

  if (loading) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: shellBackground,
          padding: 32,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto",
          color: BRAND.text,
        }}
      >
        <div
          style={{
            maxWidth: 980,
            margin: "0 auto",
            background: BRAND.card,
            border: `1px solid ${BRAND.border}`,
            borderRadius: 16,
            padding: 24,
            boxShadow: "0 8px 30px rgba(15, 23, 42, 0.06)",
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 900, color: BRAND.dark }}>
            Admin • Assessment
          </div>
          <div style={{ color: BRAND.muted, marginTop: 6 }}>Loading organization…</div>
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
          padding: 32,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto",
          color: BRAND.text,
        }}
      >
        <div
          style={{
            maxWidth: 980,
            margin: "0 auto",
            background: BRAND.card,
            border: `1px solid ${BRAND.border}`,
            borderRadius: 16,
            padding: 24,
            boxShadow: "0 8px 30px rgba(15, 23, 42, 0.06)",
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 900, color: BRAND.dark }}>
            Admin • Assessment
          </div>
          <div style={{ marginTop: 12, color: "#b42318", fontWeight: 800 }}>
            {loadError}
          </div>
          <div style={{ marginTop: 10, color: BRAND.muted }}>
            If this is “Unauthorized” or “Forbidden”, make sure you are logged in as an admin email.
          </div>
        </div>
      </main>
    );
  }

  const disableEdits = isLocked || saving;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: shellBackground,
        padding: 32,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto",
        color: BRAND.text,
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        {/* Organization editor card */}
        <div
          style={{
            background: BRAND.card,
            border: `1px solid ${BRAND.border}`,
            borderRadius: 16,
            padding: 20,
            boxShadow: "0 8px 30px rgba(15, 23, 42, 0.06)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontSize: 22, fontWeight: 900, color: BRAND.dark }}>
                Admin • Organization
              </div>
              <div style={{ marginTop: 6, color: BRAND.muted }}>
                Edit org info used in Executive Insights and narrative generation.
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
  <span
    style={{
      fontSize: 12,
      fontWeight: 900,
      color: isLocked ? "#b42318" : BRAND.dark,
      background: "#F3F4F6",
      border: `1px solid ${BRAND.border}`,
      padding: "4px 10px",
      borderRadius: 999,
    }}
  >
    {isLocked ? "Locked" : "Editable"} • {lockLabel}
  </span>

  <button
    onClick={() => router.push("/admin/dashboard")}
    style={{
      background: "#FFFFFF",
      color: BRAND.dark,
      border: `1px solid ${BRAND.border}`,
      padding: "10px 12px",
      borderRadius: 12,
      fontWeight: 900,
      cursor: "pointer",
    }}
  >
    Admin Dashboard
  </button>

  <button
    onClick={() => router.push(`/admin/assessments/${assessmentId}/dashboard`)}
    disabled={!assessmentId}
    style={{
      background: "#FFFFFF",
      color: BRAND.dark,
      border: `1px solid ${BRAND.border}`,
      padding: "10px 12px",
      borderRadius: 12,
      fontWeight: 900,
      cursor: !assessmentId ? "not-allowed" : "pointer",
      opacity: !assessmentId ? 0.6 : 1,
    }}
  >
    Reporting Dashboard
  </button>

  <button
    onClick={() => router.push(`/assessments/${assessmentId}/narrative`)}
    style={{
      background: "#FFFFFF",
      color: BRAND.dark,
      border: `1px solid ${BRAND.border}`,
      padding: "10px 12px",
      borderRadius: 12,
      fontWeight: 900,
      cursor: "pointer",
    }}
  >
    View Executive Insights
  </button>
</div>  
          </div>

          <div style={{ marginTop: 18, display: "grid", gap: 14 }}>
            <Field
              label="Organization Name"
              value={name}
              onChange={setName}
              disabled={disableEdits}
              placeholder="Northline Client"
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 14,
              }}
            >
              <Field
                label="Industry"
                value={industry}
                onChange={setIndustry}
                disabled={disableEdits}
                placeholder="Example: Healthcare"
              />
              <Field
                label="Company Size"
                value={size}
                onChange={setSize}
                disabled={disableEdits}
                placeholder="Example: 50-200"
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 14,
              }}
            >
              <Field
                label="Growth Stage"
                value={growthStage}
                onChange={setGrowthStage}
                disabled={disableEdits}
                placeholder="Example: Scaling"
              />
              <Field
                label="Primary Pressures"
                value={primaryPressures}
                onChange={setPrimaryPressures}
                disabled={disableEdits}
                placeholder="Example: Margin, hiring, churn"
              />
            </div>

            <Field
              label="Website"
              value={website}
              onChange={setWebsite}
              disabled={disableEdits}
              placeholder="https://example.com"
            />

            <TextArea
              label="Context Notes"
              value={contextNotes}
              onChange={setContextNotes}
              disabled={disableEdits}
              placeholder="What they do, offerings, customer type, internal context…"
            />

            <div
              style={{
                border: `1px solid ${BRAND.border}`,
                borderRadius: 14,
                padding: 14,
                background: "#FFFFFF",
                display: "flex",
                gap: 12,
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ fontWeight: 900, color: BRAND.dark }}>
                  Show Admin Controls (in Executive Insights)
                </div>
                <div style={{ color: BRAND.muted, marginTop: 4, fontSize: 13 }}>
                  When ON, admin buttons appear for this organization.
                </div>
              </div>

              <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={showAdminControls}
                  onChange={(e) => setShowAdminControls(e.target.checked)}
                  disabled={disableEdits}
                />
                <span style={{ fontWeight: 900, color: BRAND.dark }}>
                  {showAdminControls ? "ON" : "OFF"}
                </span>
              </label>
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                justifyContent: "flex-end",
                flexWrap: "wrap",
              }}
            >
              {isLocked ? (
                <div style={{ color: "#b42318", fontWeight: 900 }}>
                  Locked: participants finished. Read-only.
                </div>
              ) : null}

              <button
                onClick={save}
                disabled={disableEdits}
                style={{
                  background: disableEdits ? "#98a2b3" : BRAND.dark,
                  color: "white",
                  border: "none",
                  padding: "10px 14px",
                  borderRadius: 12,
                  fontWeight: 900,
                  cursor: disableEdits ? "not-allowed" : "pointer",
                }}
              >
                {saving ? "Saving…" : "Save Organization"}
              </button>
            </div>

            {saveResult ? (
              <div
                style={{
                  marginTop: 6,
                  padding: 12,
                  borderRadius: 12,
                  border: `1px solid ${BRAND.border}`,
                  background: "#F9FAFB",
                  color: saveResult === "Saved." ? BRAND.dark : "#b42318",
                  fontWeight: 800,
                }}
              >
                {saveResult}
              </div>
            ) : null}
          </div>
        </div>

            {/* Participants */}
            <div
          style={{
            marginTop: 16,
            background: BRAND.card,
            border: `1px solid ${BRAND.border}`,
            borderRadius: 16,
            padding: 20,
            boxShadow: "0 8px 30px rgba(15, 23, 42, 0.06)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontSize: 18, fontWeight: 900, color: BRAND.dark }}>
                Participants
              </div>
              <div style={{ marginTop: 6, color: BRAND.muted, fontSize: 13 }}>
                Add emails here to generate invite links (email delivery later can be automated).
              </div>
            </div>

            <span
              style={{
                fontSize: 12,
                fontWeight: 900,
                color: BRAND.dark,
                background: "#F3F4F6",
                border: `1px solid ${BRAND.border}`,
                padding: "4px 10px",
                borderRadius: 999,
              }}
            >
              {participantsCompleted}/{participantsTotal} completed
            </span>
          </div>

          {/* Add participants */}
          <div
            style={{
              marginTop: 12,
              border: `1px solid ${BRAND.border}`,
              borderRadius: 14,
              padding: 14,
              background: "#FFFFFF",
              opacity: isLocked ? 0.6 : 1,
            }}
          >
            <div style={{ fontWeight: 900, color: BRAND.dark }}>
              Add participant emails
            </div>
            <div style={{ marginTop: 6, color: BRAND.muted, fontSize: 13 }}>
              Paste one per line (or comma-separated). Invites are blocked once locked.
            </div>

            <textarea
              value={inviteEmailsText}
              onChange={(e) => setInviteEmailsText(e.target.value)}
              disabled={isLocked || inviting}
              rows={3}
              placeholder={"sarah@client.com\njohn@client.com"}
              style={{
                width: "100%",
                marginTop: 10,
                borderRadius: 12,
                border: `1px solid ${BRAND.border}`,
                padding: "10px 12px",
                fontSize: 14,
                fontFamily: "inherit",
                outline: "none",
                background: isLocked ? "#F3F4F6" : "#FFFFFF",
                resize: "vertical",
              }}
            />

            <div
              style={{
                marginTop: 10,
                display: "flex",
                gap: 10,
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
              }}
            >
              <div style={{ color: BRAND.muted, fontSize: 12 }}>
                {isLocked ? "Locked: cannot add/invite participants." : "Invites expire in 7 days."}
              </div>

              <button
                onClick={sendInvites}
                disabled={isLocked || inviting}
                style={{
                  background: isLocked || inviting ? "#98a2b3" : BRAND.dark,
                  color: "white",
                  border: "none",
                  padding: "10px 14px",
                  borderRadius: 12,
                  fontWeight: 900,
                  cursor: isLocked || inviting ? "not-allowed" : "pointer",
                }}
              >
                {inviting ? "Sending…" : "Send Invites"}
              </button>
            </div>
            {deleteResult ? (
              <div
                style={{
                  marginTop: 10,
                  padding: 10,
                  borderRadius: 12,
                  border: `1px solid ${BRAND.border}`,
                  background: "#F9FAFB",
                  color: deleteResult === "Deleted." ? BRAND.dark : "#b42318",
                  fontWeight: 800,
                }}
              >
                {deleteResult}
              </div>
            ) : null}

{resendResult ? (
              <div
                style={{
                  marginTop: 10,
                  padding: 10,
                  borderRadius: 12,
                  border: `1px solid ${BRAND.border}`,
                  background: "#F9FAFB",
                  color: resendResult.startsWith("Error") || resendResult.startsWith("Cannot")
                    ? "#b42318"
                    : BRAND.dark,
                  fontWeight: 800,
                }}
              >
                {resendResult}
              </div>
            ) : null}

            {inviteResult ? (
              <div
                style={{
                  marginTop: 10,
                  padding: 10,
                  borderRadius: 12,
                  border: `1px solid ${BRAND.border}`,
                  background: "#F9FAFB",
                  color: inviteResult.startsWith("Error") ? "#b42318" : BRAND.dark,
                  fontWeight: 800,
                }}
              >
                {inviteResult}
              </div>
            ) : null}
          </div>

          {/* Participants table */}
          {participantsLoading ? (
            <div style={{ marginTop: 12, color: BRAND.muted }}>Loading participants…</div>
          ) : participantsError ? (
            <div style={{ marginTop: 12, color: "#b42318", fontWeight: 800 }}>
              {participantsError}
            </div>
          ) : participants.length === 0 ? (
            <div style={{ marginTop: 12, color: BRAND.muted }}>No participants yet.</div>
          ) : (
            <div style={{ marginTop: 14, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                <tr style={{ background: "#F6F8FC" }}>
                    <th style={{ textAlign: "left", padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>Email</th>
                    <th style={{ textAlign: "left", padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>Department</th>
                    <th style={{ textAlign: "left", padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>Invite</th>
                    <th style={{ textAlign: "left", padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>Completed</th>
                    <th style={{ textAlign: "left", padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>Created</th>
                    <th style={{ textAlign: "left", padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {participants.map((p) => {
                    const inviteState = p.invite_accepted_at
                      ? "Accepted"
                      : p.invite_sent_at
                      ? "Sent"
                      : "—";

                    const completedState = p.completed_at ? "Yes" : "No";

                    return (
                      <tr key={p.id}>
                        <td style={{ padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>
                          <div style={{ fontWeight: 800, color: BRAND.dark }}>{p.email ?? "—"}</div>
                          <div style={{ color: BRAND.muted, fontSize: 12 }}>{p.id}</div>
                        </td>
                        <td style={{ padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>
                          {p.department ?? "—"}
                        </td>
                        <td style={{ padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>
                          <div style={{ fontWeight: 800 }}>{inviteState}</div>
                          <div style={{ color: BRAND.muted, fontSize: 12 }}>
                            Sent: {fmtDate(p.invite_sent_at)} • Accepted: {fmtDate(p.invite_accepted_at)}
                          </div>
                        </td>
                        <td style={{ padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>
                          <div style={{ fontWeight: 800 }}>{completedState}</div>
                          <div style={{ color: BRAND.muted, fontSize: 12 }}>
                            {p.completed_at ? fmtDate(p.completed_at) : "—"}
                          </div>
                        </td>
                        <td style={{ padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>
                          {fmtDate(p.created_at)}
                        </td>

                        <td style={{ padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <button
                              onClick={() => resendInvite(p.email)}
                              disabled={isLocked || !p.email || resendingEmail === (p.email ?? "").trim().toLowerCase()}
                              style={{
                                background:
                                  isLocked || !p.email || resendingEmail === (p.email ?? "").trim().toLowerCase()
                                    ? "#98a2b3"
                                    : BRAND.dark,
                                color: "white",
                                border: "none",
                                padding: "8px 10px",
                                borderRadius: 10,
                                fontWeight: 900,
                                cursor:
                                  isLocked || !p.email || resendingEmail === (p.email ?? "").trim().toLowerCase()
                                    ? "not-allowed"
                                    : "pointer",
                              }}
                              title={
                                isLocked
                                  ? "Locked: cannot resend invites."
                                  : !p.email
                                  ? "No email on this participant."
                                  : "Resend invite"
                              }
                            >
                              {resendingEmail === (p.email ?? "").trim().toLowerCase() ? "Resending…" : "Resend"}
                            </button>

                            <button
                              onClick={() => deleteParticipant(p.id)}
                              disabled={isLocked || Boolean(p.completed_at) || deletingParticipantId === p.id}
                              style={{
                                background:
                                  isLocked || Boolean(p.completed_at) || deletingParticipantId === p.id
                                    ? "#98a2b3"
                                    : "#b42318",
                                color: "white",
                                border: "none",
                                padding: "8px 10px",
                                borderRadius: 10,
                                fontWeight: 900,
                                cursor:
                                  isLocked || Boolean(p.completed_at) || deletingParticipantId === p.id
                                    ? "not-allowed"
                                    : "pointer",
                              }}
                              title={
                                isLocked
                                  ? "Locked: cannot delete participants."
                                  : p.completed_at
                                  ? "Cannot delete a completed participant."
                                  : "Delete participant"
                              }
                            >
                              {deletingParticipantId === p.id ? "Deleting…" : "Delete"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div
          style={{
            marginTop: 16,
            color: BRAND.muted,
            fontSize: 12,
            textAlign: "center",
          }}
        >
          Org ID: {org?.id ?? "unknown"}
        </div>
      </div>
    </main>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  placeholder: string;
}) {
  return (
    <div
      style={{
        border: `1px solid ${BRAND.border}`,
        borderRadius: 14,
        padding: 14,
        background: "#FFFFFF",
      }}
    >
      <div style={{ fontWeight: 900, color: BRAND.dark, marginBottom: 8 }}>
        {props.label}
      </div>
      <input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
        placeholder={props.placeholder}
        style={{
          width: "100%",
          borderRadius: 12,
          border: `1px solid ${BRAND.border}`,
          padding: "10px 12px",
          fontSize: 14,
          fontFamily: "inherit",
          outline: "none",
          background: props.disabled ? "#F3F4F6" : "#FFFFFF",
        }}
      />
    </div>
  );
}

function TextArea(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  placeholder: string;
}) {
  return (
    <div
      style={{
        border: `1px solid ${BRAND.border}`,
        borderRadius: 14,
        padding: 14,
        background: "#FFFFFF",
      }}
    >
      <div style={{ fontWeight: 900, color: BRAND.dark, marginBottom: 8 }}>
        {props.label}
      </div>
      <textarea
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
        placeholder={props.placeholder}
        rows={5}
        style={{
          width: "100%",
          borderRadius: 12,
          border: `1px solid ${BRAND.border}`,
          padding: "10px 12px",
          fontSize: 14,
          fontFamily: "inherit",
          outline: "none",
          background: props.disabled ? "#F3F4F6" : "#FFFFFF",
          resize: "vertical",
        }}
      />
    </div>
  );
}