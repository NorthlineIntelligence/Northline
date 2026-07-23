"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { NORTHLINE_BRAND as BRAND, NORTHLINE_SHELL_BG as shellBackground } from "@/lib/northlineBrand";
import { AiProcessingModeToggle, type AiProcessingMode } from "@/components/priority-discovery/AiProcessingModeToggle";
import { INVITE_TIMEZONE_OPTIONS } from "@/lib/scheduleTimezone";
import { AssessmentPriorityQuestionsEditor } from "@/components/assessments/AssessmentPriorityQuestionsEditor";

type OrgPayload = {
  id: string;
  name: string;
  industry: string | null;
  size: string | null;
  growth_stage: string | null;
  primary_pressures: string | null;
  website: string | null;
  context_notes: string | null;
  legal_name: string | null;
  legal_entity_type: string | null;
  ein: string | null;
  legal_address: string | null;
  state_of_incorporation: string | null;
  primary_contact_name: string | null;
  primary_contact_title: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  billing_contact_name: string | null;
  billing_email: string | null;
  payment_method: string | null;
  show_admin_controls: boolean;
};

type OrganizationDocumentRow = {
  id: string;
  title: string;
  source_type: string;
  source_url: string | null;
  mime_type: string | null;
  created_at: string;
  has_extracted_text: boolean;
  text_extracted_chars: number;
};

type LoadResponse = {
  ok: boolean;
  isLocked: boolean;
  participantsTotal: number;
  participantsCompleted: number;
  assessment: {
    id: string;
    name: string | null;
    assessment_type: "READINESS" | "PRIORITY_DISCOVERY";
    question_set_version: string;
    ai_processing_mode?: AiProcessingMode;
  };
  organization: OrgPayload;
};

type ParticipantRow = {
  id: string;
  email: string | null;
  can_view_executive_insights: boolean;
  portal_role: "NONE" | "PORTAL_USER" | "ORG_ADMIN";
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

type InviteScheduleRow = {
  id: string;
  emails: string[];
  scheduledAtUtc: string;
  timezone: string;
  localDate: string;
  localTime: string;
  status: string;
  sentCount: number;
  failedCount: number;
  lastError: string | null;
  createdAt: string;
  processedAt: string | null;
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
  const [assessmentType, setAssessmentType] = useState<"READINESS" | "PRIORITY_DISCOVERY">("READINESS");
  const [aiProcessingMode, setAiProcessingMode] = useState<AiProcessingMode>("executive");
  const [savingAiMode, setSavingAiMode] = useState(false);
  const [aiModeResult, setAiModeResult] = useState<string | null>(null);

  const [org, setOrg] = useState<OrgPayload | null>(null);

  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [size, setSize] = useState("");
  const [growthStage, setGrowthStage] = useState("");
  const [primaryPressures, setPrimaryPressures] = useState("");
  const [website, setWebsite] = useState("");
  const [contextNotes, setContextNotes] = useState("");
  const [legalName, setLegalName] = useState("");
  const [legalEntityType, setLegalEntityType] = useState("");
  const [ein, setEin] = useState("");
  const [legalAddress, setLegalAddress] = useState("");
  const [stateOfIncorporation, setStateOfIncorporation] = useState("");
  const [primaryContactName, setPrimaryContactName] = useState("");
  const [primaryContactTitle, setPrimaryContactTitle] = useState("");
  const [primaryContactEmail, setPrimaryContactEmail] = useState("");
  const [primaryContactPhone, setPrimaryContactPhone] = useState("");
  const [billingContactName, setBillingContactName] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [showAdminControls, setShowAdminControls] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);

  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [participantsError, setParticipantsError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [docsResult, setDocsResult] = useState<string | null>(null);
  const [orgDocs, setOrgDocs] = useState<OrganizationDocumentRow[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<File[]>([]);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);

  const [inviteEmailsText, setInviteEmailsText] = useState("");
const [inviteSendMode, setInviteSendMode] = useState<"immediate" | "scheduled">("immediate");
const [inviteScheduledDate, setInviteScheduledDate] = useState("");
const [inviteScheduledTime, setInviteScheduledTime] = useState("09:00");
const [inviteTimezone, setInviteTimezone] = useState("America/New_York");
const [inviteSchedules, setInviteSchedules] = useState<InviteScheduleRow[]>([]);
const [inviteSchedulesLoading, setInviteSchedulesLoading] = useState(false);
const [cancellingScheduleId, setCancellingScheduleId] = useState<string | null>(null);
const [inviting, setInviting] = useState(false);
const [inviteResult, setInviteResult] = useState<string | null>(null);
const [newInvitePortalAdmin, setNewInvitePortalAdmin] = useState(false);

const [resendingEmail, setResendingEmail] = useState<string | null>(null);
const [resendResult, setResendResult] = useState<string | null>(null);

const [deletingParticipantId, setDeletingParticipantId] = useState<string | null>(null);
const [deleteResult, setDeleteResult] = useState<string | null>(null);
const [updatingVisibilityId, setUpdatingVisibilityId] = useState<string | null>(null);

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

async function setParticipantExecutiveInsightsVisibility(
  participantId: string,
  canViewExecutiveInsights: boolean
) {
  if (!assessmentId) return;
  setUpdatingVisibilityId(participantId);
  setDeleteResult(null);

  const res = await fetch(`/api/admin/assessments/${assessmentId}/participants`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      participantId,
      can_view_executive_insights: canViewExecutiveInsights,
    }),
  });
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    setDeleteResult(`Error (${res.status}): ${json?.error ?? "Update failed."}`);
    setUpdatingVisibilityId(null);
    return;
  }
  setUpdatingVisibilityId(null);
  await refreshParticipants();
}

async function setParticipantPortalRole(
  participantId: string,
  portalRole: "NONE" | "PORTAL_USER" | "ORG_ADMIN"
) {
  if (!assessmentId) return;
  setUpdatingVisibilityId(participantId);
  setDeleteResult(null);

  const res = await fetch(`/api/admin/assessments/${assessmentId}/participants`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      participantId,
      portal_role: portalRole,
    }),
  });
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    setDeleteResult(`Error (${res.status}): ${json?.error ?? "Update failed."}`);
    setUpdatingVisibilityId(null);
    return;
  }
  setUpdatingVisibilityId(null);
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

  async function refreshDocuments(organizationId: string) {
    setDocsLoading(true);
    setDocsError(null);
    try {
      const res = await fetch(`/api/admin/organizations/${organizationId}/documents`, {
        method: "GET",
        credentials: "include",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Failed to load documents (${res.status}).`);
      }
      const rows = Array.isArray(json.documents) ? (json.documents as OrganizationDocumentRow[]) : [];
      setOrgDocs(rows);
    } catch (e: any) {
      setDocsError(e?.message ?? "Failed to load documents.");
      setOrgDocs([]);
    } finally {
      setDocsLoading(false);
    }
  }

  async function uploadDocuments() {
    if (!org?.id) return;
    if (selectedDocs.length === 0) {
      setDocsResult("Choose at least one document first.");
      return;
    }
    setUploadingDocs(true);
    setDocsError(null);
    setDocsResult(null);
    try {
      const form = new FormData();
      for (const f of selectedDocs) form.append("files", f);
      const res = await fetch(`/api/admin/organizations/${org.id}/documents`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Upload failed (${res.status}).`);
      }
      setSelectedDocs([]);
      setDocsResult(`Uploaded ${Number(json.uploaded ?? selectedDocs.length)} document(s).`);
      await refreshDocuments(org.id);
    } catch (e: any) {
      setDocsError(e?.message ?? "Upload failed.");
    } finally {
      setUploadingDocs(false);
    }
  }

  async function deleteDocument(docId: string) {
    if (!org?.id) return;
    if (!window.confirm("Delete this uploaded document?")) return;
    setDeletingDocId(docId);
    setDocsError(null);
    setDocsResult(null);
    try {
      const res = await fetch(
        `/api/admin/organizations/${org.id}/documents?docId=${encodeURIComponent(docId)}`,
        {
          method: "DELETE",
          credentials: "include",
        }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Delete failed (${res.status}).`);
      }
      setDocsResult("Document deleted.");
      await refreshDocuments(org.id);
    } catch (e: any) {
      setDocsError(e?.message ?? "Delete failed.");
    } finally {
      setDeletingDocId(null);
    }
  }

  async function refreshInviteSchedules() {
    if (!assessmentId) return;
    setInviteSchedulesLoading(true);
    try {
      const res = await fetch(`/api/admin/assessments/${assessmentId}/participants/invite-schedules`, {
        credentials: "include",
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.ok) {
        setInviteSchedules(json.schedules ?? []);
      }
    } finally {
      setInviteSchedulesLoading(false);
    }
  }

  async function cancelInviteSchedule(scheduleId: string) {
    if (!assessmentId) return;
    const ok = window.confirm("Cancel this scheduled invite send?");
    if (!ok) return;

    setCancellingScheduleId(scheduleId);
    const res = await fetch(
      `/api/admin/assessments/${assessmentId}/participants/invite-schedules?scheduleId=${encodeURIComponent(scheduleId)}`,
      { method: "DELETE", credentials: "include" }
    );
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setInviteResult(json?.error ?? `Cancel failed (${res.status}).`);
      setCancellingScheduleId(null);
      return;
    }
    setInviteResult("Scheduled invite cancelled.");
    setCancellingScheduleId(null);
    await refreshInviteSchedules();
  }

  async function sendInvites() {
    if (!assessmentId) return;
    if (isLocked && !newInvitePortalAdmin) {
      setInviteResult(
        "Assessment is locked. Enable User Admin Rights to send portal-access invites after completion."
      );
      return;
    }

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

    if (inviteSendMode === "scheduled") {
      if (!inviteScheduledDate || !inviteScheduledTime || !inviteTimezone) {
        setInviteResult("Choose a date, time, and timezone for scheduled send.");
        return;
      }
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
        sendMode: inviteSendMode,
        scheduledLocalDate: inviteSendMode === "scheduled" ? inviteScheduledDate : undefined,
        scheduledLocalTime: inviteSendMode === "scheduled" ? inviteScheduledTime : undefined,
        timezone: inviteSendMode === "scheduled" ? inviteTimezone : undefined,
        portalRoleByEmail: Object.fromEntries(
          emails.map((email) => [email, newInvitePortalAdmin ? "ORG_ADMIN" : "NONE"])
        ),
      }),
    });

    const json = await res.json().catch(() => ({} as any));

    if (!res.ok) {
      setInviteResult(`Error (${res.status}): ${json?.error ?? "Invite failed."}`);
      setInviting(false);
      return;
    }

    const invited = Number(json?.invited ?? emails.length);
    if (json?.scheduled) {
      setInviteResult(
        `Scheduled ${invited} invite${invited === 1 ? "" : "s"} for ${inviteScheduledDate} ${inviteScheduledTime} (${inviteTimezone}).`
      );
    } else {
      const sent = Number(json?.sent ?? 0);
      const failed = Number(json?.failed ?? 0);
      setInviteResult(
        failed > 0
          ? `Invited ${invited}. Sent ${sent}, failed ${failed}.`
          : `Invited ${invited}. Sent ${sent}.`
      );
      await refreshParticipants();
    }

    setInviteEmailsText("");
    setInviting(false);
    await refreshInviteSchedules();
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
          setAssessmentType(json.assessment?.assessment_type ?? "READINESS");
          setAiProcessingMode(json.assessment?.ai_processing_mode ?? "executive");

          setOrg(json.organization);

          setName(json.organization.name ?? "");
          setIndustry(json.organization.industry ?? "");
          setSize(json.organization.size ?? "");
          setGrowthStage(json.organization.growth_stage ?? "");
          setPrimaryPressures(json.organization.primary_pressures ?? "");
          setWebsite(json.organization.website ?? "");
          setContextNotes(json.organization.context_notes ?? "");
          setLegalName(json.organization.legal_name ?? "");
          setLegalEntityType(json.organization.legal_entity_type ?? "");
          setEin(json.organization.ein ?? "");
          setLegalAddress(json.organization.legal_address ?? "");
          setStateOfIncorporation(json.organization.state_of_incorporation ?? "");
          setPrimaryContactName(json.organization.primary_contact_name ?? "");
          setPrimaryContactTitle(json.organization.primary_contact_title ?? "");
          setPrimaryContactEmail(json.organization.primary_contact_email ?? "");
          setPrimaryContactPhone(json.organization.primary_contact_phone ?? "");
          setBillingContactName(json.organization.billing_contact_name ?? "");
          setBillingEmail(json.organization.billing_email ?? "");
          setPaymentMethod(json.organization.payment_method ?? "");
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
          setParticipants(pJson.participants);
          setParticipantsLoading(false);
          await refreshInviteSchedules();
        }

        if (!cancelled) {
          await refreshDocuments(json.organization.id);
        }
      } catch (e: any) {
        if (!cancelled) {
          setLoadError(e?.message ?? String(e));
          setLoading(false);
          setParticipantsError(e?.message ?? String(e));
          setParticipantsLoading(false);
          setDocsError(e?.message ?? String(e));
          setDocsLoading(false);
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
        legal_name: legalName,
        legal_entity_type: legalEntityType,
        ein,
        legal_address: legalAddress,
        state_of_incorporation: stateOfIncorporation,
        primary_contact_name: primaryContactName,
        primary_contact_title: primaryContactTitle,
        primary_contact_email: primaryContactEmail,
        primary_contact_phone: primaryContactPhone,
        billing_contact_name: billingContactName,
        billing_email: billingEmail,
        payment_method: paymentMethod,
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
      setLegalName(updated.legal_name ?? "");
      setLegalEntityType(updated.legal_entity_type ?? "");
      setEin(updated.ein ?? "");
      setLegalAddress(updated.legal_address ?? "");
      setStateOfIncorporation(updated.state_of_incorporation ?? "");
      setPrimaryContactName(updated.primary_contact_name ?? "");
      setPrimaryContactTitle(updated.primary_contact_title ?? "");
      setPrimaryContactEmail(updated.primary_contact_email ?? "");
      setPrimaryContactPhone(updated.primary_contact_phone ?? "");
      setBillingContactName(updated.billing_contact_name ?? "");
      setBillingEmail(updated.billing_email ?? "");
      setPaymentMethod(updated.payment_method ?? "");
      setShowAdminControls(Boolean(updated.show_admin_controls));
    }
  }

  async function saveAiProcessingMode() {
    if (!assessmentId) return;

    setSavingAiMode(true);
    setAiModeResult(null);

    const res = await fetch(`/api/admin/assessments/${assessmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ai_processing_mode: aiProcessingMode }),
    });

    const json = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      setAiModeResult(`Error (${res.status}): ${json?.error ?? "Save failed."}`);
      setSavingAiMode(false);
      return;
    }

    setAiModeResult("AI processing mode saved.");
    setSavingAiMode(false);
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
  const topActionButtonStyle: React.CSSProperties = {
    background: "linear-gradient(180deg, #FFFFFF 0%, #F7FAFF 100%)",
    color: BRAND.dark,
    border: `1px solid ${BRAND.border}`,
    padding: "10px 14px",
    borderRadius: 16,
    fontWeight: 900,
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05), 0 6px 16px rgba(15, 23, 42, 0.06)",
    cursor: "pointer",
  };

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

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
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
    style={topActionButtonStyle}
  >
    Admin Dashboard
  </button>

  <button
    onClick={() => router.push(`/admin/crm/organizations/${org?.id}`)}
    disabled={!org?.id}
    style={{
      ...topActionButtonStyle,
      cursor: !org?.id ? "not-allowed" : "pointer",
      opacity: !org?.id ? 0.6 : 1,
    }}
  >
    Organization Account
  </button>

  <button
    onClick={() => router.push(`/admin/assessments/${assessmentId}/dashboard`)}
    disabled={!assessmentId}
    style={{
      ...topActionButtonStyle,
      cursor: !assessmentId ? "not-allowed" : "pointer",
      opacity: !assessmentId ? 0.6 : 1,
    }}
  >
    Reporting Dashboard
  </button>

  <button
    onClick={() =>
      router.push(
        assessmentType === "PRIORITY_DISCOVERY"
          ? `/admin/assessments/${assessmentId}/priority-results`
          : `/assessments/${assessmentId}/narrative`
      )
    }
    style={topActionButtonStyle}
  >
    {assessmentType === "PRIORITY_DISCOVERY"
      ? "Open Priority Discovery Readout"
      : "View Executive Insights"}
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
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 14,
              }}
            >
              <Field
                label="Client Legal Name"
                value={legalName}
                onChange={setLegalName}
                disabled={disableEdits}
                placeholder="Acme, Inc."
              />
              <Field
                label="Legal Entity Type"
                value={legalEntityType}
                onChange={setLegalEntityType}
                disabled={disableEdits}
                placeholder="LLC / Inc / LP"
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
                label="EIN / Tax ID"
                value={ein}
                onChange={setEin}
                disabled={disableEdits}
                placeholder="12-3456789"
              />
              <Field
                label="Billing Email"
                value={billingEmail}
                onChange={setBillingEmail}
                disabled={disableEdits}
                placeholder="ap@client.com"
              />
            </div>
            <TextArea
              label="Legal Address"
              value={legalAddress}
              onChange={setLegalAddress}
              disabled={disableEdits}
              placeholder="Street, city, state, zip"
            />
            <Field
              label="State of Incorporation"
              value={stateOfIncorporation}
              onChange={setStateOfIncorporation}
              disabled={disableEdits}
              placeholder="Delaware (optional)"
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 14,
              }}
            >
              <Field
                label="Primary Contact Name"
                value={primaryContactName}
                onChange={setPrimaryContactName}
                disabled={disableEdits}
                placeholder="Jane Doe"
              />
              <Field
                label="Primary Contact Title"
                value={primaryContactTitle}
                onChange={setPrimaryContactTitle}
                disabled={disableEdits}
                placeholder="VP Operations"
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
                label="Primary Contact Email"
                value={primaryContactEmail}
                onChange={setPrimaryContactEmail}
                disabled={disableEdits}
                placeholder="jane@client.com"
              />
              <Field
                label="Primary Contact Phone"
                value={primaryContactPhone}
                onChange={setPrimaryContactPhone}
                disabled={disableEdits}
                placeholder="(optional)"
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
                label="Billing Contact Name"
                value={billingContactName}
                onChange={setBillingContactName}
                disabled={disableEdits}
                placeholder="Can be different from primary contact"
              />
              <Field
                label="Payment Method"
                value={paymentMethod}
                onChange={setPaymentMethod}
                disabled={disableEdits}
                placeholder="ACH / Wire / Card (optional pre-contract)"
              />
            </div>

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

        {assessmentType === "PRIORITY_DISCOVERY" ? (
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
            <div style={{ fontSize: 18, fontWeight: 900, color: BRAND.dark }}>
              Priority Discovery AI Processing
            </div>
            <div style={{ marginTop: 6, color: BRAND.muted, fontSize: 13 }}>
              Choose which private Northline model runs when you generate or regenerate the executive readout. Use client-specific generation when the default readout feels too generic.
            </div>
            <div style={{ marginTop: 16 }}>
              <AiProcessingModeToggle
                value={aiProcessingMode}
                onChange={setAiProcessingMode}
                disabled={savingAiMode}
              />
            </div>
            <div
              style={{
                marginTop: 16,
                display: "flex",
                gap: 10,
                alignItems: "center",
                justifyContent: "flex-end",
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={saveAiProcessingMode}
                disabled={savingAiMode}
                style={{
                  background: savingAiMode ? "#98a2b3" : BRAND.dark,
                  color: "white",
                  border: "none",
                  padding: "10px 14px",
                  borderRadius: 12,
                  fontWeight: 900,
                  cursor: savingAiMode ? "not-allowed" : "pointer",
                }}
              >
                {savingAiMode ? "Saving…" : "Save AI Mode"}
              </button>
              <button
                type="button"
                onClick={() => router.push(`/admin/assessments/${assessmentId}/priority-client-readout`)}
                style={{
                  background: BRAND.cyan,
                  color: "white",
                  border: "none",
                  padding: "10px 14px",
                  borderRadius: 12,
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Open Client-Specific Readout →
              </button>
            </div>
            {aiModeResult ? (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 12,
                  border: `1px solid ${BRAND.border}`,
                  background: "#F9FAFB",
                  color: aiModeResult.includes("Error") ? "#b42318" : BRAND.dark,
                  fontWeight: 800,
                }}
              >
                {aiModeResult}
              </div>
            ) : null}
          </div>
        ) : null}

        {assessmentType === "PRIORITY_DISCOVERY" && assessmentId ? (
          <div style={{ marginTop: 16 }}>
            <AssessmentPriorityQuestionsEditor assessmentId={assessmentId} />
          </div>
        ) : null}

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
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 900, color: BRAND.dark }}>
                Organization Documents for AI Grounding
              </div>
              <div style={{ marginTop: 6, color: BRAND.muted, fontSize: 13 }}>
                Upload multiple docs (text/markdown/csv/json recommended). These are used during Executive Insights
                generation for memo, risks, and pilot starting points.
              </div>
              <div style={{ marginTop: 6, color: BRAND.muted, fontSize: 12 }}>
                Uploaded/context text is automatically scrubbed to remove organization name references before AI use.
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: 12,
              border: `1px solid ${BRAND.border}`,
              borderRadius: 14,
              padding: 14,
              background: dragActive ? "#EEF4FF" : "#FFFFFF",
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              const dropped = Array.from(e.dataTransfer.files ?? []);
              if (!dropped.length) return;
              setSelectedDocs((prev) => [...prev, ...dropped]);
              setDocsResult(null);
              setDocsError(null);
            }}
          >
            <input
              type="file"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                setSelectedDocs((prev) => [...prev, ...files]);
                setDocsResult(null);
                setDocsError(null);
              }}
              disabled={uploadingDocs}
            />
            <div style={{ marginTop: 8, color: BRAND.muted, fontSize: 12 }}>
              Drag/drop supported. Max 10 files/upload, 2MB each. PDF text extraction is enabled.
            </div>
            {selectedDocs.length > 0 ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, color: BRAND.dark, fontWeight: 700, marginBottom: 8 }}>
                  Selected: {selectedDocs.length} file(s)
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {selectedDocs.map((f, idx) => (
                    <button
                      key={`${f.name}-${idx}-${f.size}`}
                      onClick={() => {
                        setSelectedDocs((prev) => prev.filter((_, i) => i !== idx));
                      }}
                      style={{
                        border: `1px solid ${BRAND.border}`,
                        borderRadius: 999,
                        background: "#FFFFFF",
                        padding: "4px 10px",
                        fontSize: 12,
                        cursor: "pointer",
                        color: BRAND.dark,
                      }}
                      title="Remove selected file"
                    >
                      {f.name} ×
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
              <button
                onClick={uploadDocuments}
                disabled={uploadingDocs || selectedDocs.length === 0}
                style={{
                  background: uploadingDocs || selectedDocs.length === 0 ? "#98a2b3" : BRAND.dark,
                  color: "white",
                  border: "none",
                  padding: "10px 14px",
                  borderRadius: 12,
                  fontWeight: 900,
                  cursor: uploadingDocs || selectedDocs.length === 0 ? "not-allowed" : "pointer",
                }}
              >
                {uploadingDocs ? "Uploading…" : "Upload Documents"}
              </button>
            </div>
            {docsResult ? (
              <div style={{ marginTop: 10, color: BRAND.dark, fontWeight: 800, fontSize: 13 }}>{docsResult}</div>
            ) : null}
            {docsError ? (
              <div style={{ marginTop: 10, color: "#b42318", fontWeight: 800, fontSize: 13 }}>{docsError}</div>
            ) : null}
          </div>

          <div style={{ marginTop: 14 }}>
            {docsLoading ? (
              <div style={{ color: BRAND.muted }}>Loading documents…</div>
            ) : orgDocs.length === 0 ? (
              <div style={{ color: BRAND.muted, fontSize: 13 }}>No documents uploaded yet.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#F6F8FC" }}>
                      <th style={{ textAlign: "left", padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>Title</th>
                      <th style={{ textAlign: "left", padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>Type</th>
                      <th style={{ textAlign: "left", padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>Extracted Text</th>
                      <th style={{ textAlign: "left", padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>Uploaded</th>
                      <th style={{ textAlign: "left", padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orgDocs.map((d) => (
                      <tr key={d.id}>
                        <td style={{ padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>
                          <div style={{ fontWeight: 800 }}>{d.title}</div>
                          <div style={{ color: BRAND.muted, fontSize: 12 }}>{d.id}</div>
                        </td>
                        <td style={{ padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>
                          {d.mime_type ?? d.source_type}
                        </td>
                        <td style={{ padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>
                          {d.has_extracted_text ? `${d.text_extracted_chars} chars` : "No extracted text"}
                        </td>
                        <td style={{ padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>
                          {fmtDate(d.created_at)}
                        </td>
                        <td style={{ padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>
                          <button
                            onClick={() => deleteDocument(d.id)}
                            disabled={deletingDocId === d.id}
                            style={{
                              background: deletingDocId === d.id ? "#98a2b3" : "#b42318",
                              color: "white",
                              border: "none",
                              padding: "8px 10px",
                              borderRadius: 10,
                              fontWeight: 900,
                              cursor: deletingDocId === d.id ? "not-allowed" : "pointer",
                            }}
                          >
                            {deletingDocId === d.id ? "Deleting…" : "Delete"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
                Add emails and send immediately, or schedule delivery for a specific date and time.
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
              Paste one per line (or comma-separated). Invites are blocked once locked unless User Admin Rights is enabled.
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setInviteSendMode("immediate")}
                disabled={inviting}
                style={{
                  border: `1px solid ${inviteSendMode === "immediate" ? BRAND.dark : BRAND.border}`,
                  background: inviteSendMode === "immediate" ? "#E8F7F8" : "#FFFFFF",
                  color: BRAND.dark,
                  padding: "8px 12px",
                  borderRadius: 10,
                  fontWeight: 900,
                  cursor: inviting ? "not-allowed" : "pointer",
                }}
              >
                Immediate Send
              </button>
              <button
                type="button"
                onClick={() => setInviteSendMode("scheduled")}
                disabled={inviting}
                style={{
                  border: `1px solid ${inviteSendMode === "scheduled" ? BRAND.dark : BRAND.border}`,
                  background: inviteSendMode === "scheduled" ? "#E8F7F8" : "#FFFFFF",
                  color: BRAND.dark,
                  padding: "8px 12px",
                  borderRadius: 10,
                  fontWeight: 900,
                  cursor: inviting ? "not-allowed" : "pointer",
                }}
              >
                Scheduled Send
              </button>
            </div>

            {inviteSendMode === "scheduled" ? (
              <div
                style={{
                  marginTop: 12,
                  display: "grid",
                  gap: 10,
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                }}
              >
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 900, color: BRAND.dark }}>Date</span>
                  <input
                    type="date"
                    value={inviteScheduledDate}
                    onChange={(e) => setInviteScheduledDate(e.target.value)}
                    disabled={inviting}
                    style={{
                      borderRadius: 12,
                      border: `1px solid ${BRAND.border}`,
                      padding: "10px 12px",
                      fontSize: 14,
                    }}
                  />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 900, color: BRAND.dark }}>Time</span>
                  <input
                    type="time"
                    value={inviteScheduledTime}
                    onChange={(e) => setInviteScheduledTime(e.target.value)}
                    disabled={inviting}
                    style={{
                      borderRadius: 12,
                      border: `1px solid ${BRAND.border}`,
                      padding: "10px 12px",
                      fontSize: 14,
                    }}
                  />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 900, color: BRAND.dark }}>Timezone</span>
                  <select
                    value={inviteTimezone}
                    onChange={(e) => setInviteTimezone(e.target.value)}
                    disabled={inviting}
                    style={{
                      borderRadius: 12,
                      border: `1px solid ${BRAND.border}`,
                      padding: "10px 12px",
                      fontSize: 14,
                    }}
                  >
                    {INVITE_TIMEZONE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}

            <textarea
              value={inviteEmailsText}
              onChange={(e) => setInviteEmailsText(e.target.value)}
              disabled={inviting}
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
                  {isLocked
                    ? "Assessment is locked for responses. Portal-access invites remain available."
                    : inviteSendMode === "scheduled"
                      ? "Invites will send automatically at the scheduled date and time."
                      : "Invites expire in 7 days."}
              </div>
                <label style={{ display: "inline-flex", gap: 8, alignItems: "center", color: BRAND.dark, fontWeight: 800 }}>
                  <input
                    type="checkbox"
                    checked={newInvitePortalAdmin}
                    onChange={(e) => setNewInvitePortalAdmin(e.target.checked)}
                    disabled={inviting}
                  />
                  User Admin Rights
                </label>

              <button
                onClick={sendInvites}
                disabled={inviting}
                style={{
                  background: inviting ? "#98a2b3" : BRAND.dark,
                  color: "white",
                  border: "none",
                  padding: "10px 14px",
                  borderRadius: 12,
                  fontWeight: 900,
                  cursor: inviting ? "not-allowed" : "pointer",
                }}
              >
                {inviting
                  ? inviteSendMode === "scheduled"
                    ? "Scheduling…"
                    : "Sending…"
                  : inviteSendMode === "scheduled"
                    ? "Schedule Invites"
                    : "Send Invites"}
              </button>
            </div>

            {inviteSchedules.length > 0 ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 900, color: BRAND.dark }}>Scheduled invite sends</div>
                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  {inviteSchedules.map((schedule) => (
                    <div
                      key={schedule.id}
                      style={{
                        border: `1px solid ${BRAND.border}`,
                        borderRadius: 12,
                        padding: 12,
                        background: "#F9FAFB",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontWeight: 800, color: BRAND.dark }}>
                            {schedule.localDate} {schedule.localTime} ({schedule.timezone})
                          </div>
                          <div style={{ marginTop: 4, fontSize: 12, color: BRAND.muted }}>
                            {schedule.emails.length} email{schedule.emails.length === 1 ? "" : "s"} • Status: {schedule.status}
                          </div>
                          <div style={{ marginTop: 4, fontSize: 12, color: BRAND.muted }}>
                            {schedule.emails.join(", ")}
                          </div>
                        </div>
                        {schedule.status === "PENDING" ? (
                          <button
                            onClick={() => cancelInviteSchedule(schedule.id)}
                            disabled={cancellingScheduleId === schedule.id}
                            style={{
                              background: "#FFFFFF",
                              color: "#b42318",
                              border: "1px solid #FECDCA",
                              padding: "8px 10px",
                              borderRadius: 10,
                              fontWeight: 900,
                              cursor: cancellingScheduleId === schedule.id ? "not-allowed" : "pointer",
                            }}
                          >
                            {cancellingScheduleId === schedule.id ? "Cancelling…" : "Cancel"}
                          </button>
                        ) : null}
                      </div>
                      {schedule.lastError ? (
                        <div style={{ marginTop: 8, fontSize: 12, color: "#b42318" }}>{schedule.lastError}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : inviteSchedulesLoading ? (
              <div style={{ marginTop: 12, fontSize: 12, color: BRAND.muted }}>Loading scheduled sends…</div>
            ) : null}
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
                    <th
                      style={{ textAlign: "left", padding: 10, borderBottom: `1px solid ${BRAND.border}` }}
                      title="Admins can change this anytime, including after the assessment is complete, to allow running or exposing Executive Insights."
                    >
                      Exec Insights
                    </th>
                    <th
                      style={{ textAlign: "left", padding: 10, borderBottom: `1px solid ${BRAND.border}` }}
                      title="Customer portal access and org-level dashboard rights."
                    >
                      User Admin Rights
                    </th>
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
                          <label
                            style={{ display: "inline-flex", gap: 8, alignItems: "center", fontWeight: 800 }}
                            title="Works even when the assessment is locked. Turn on to let this participant open Executive Insights."
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(p.can_view_executive_insights)}
                              disabled={updatingVisibilityId === p.id}
                              onChange={(e) =>
                                setParticipantExecutiveInsightsVisibility(
                                  p.id,
                                  e.target.checked
                                )
                              }
                            />
                            {p.can_view_executive_insights ? "Allowed" : "Hidden"}
                          </label>
                        </td>
                        <td style={{ padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>
                          <label
                            style={{ display: "inline-flex", gap: 8, alignItems: "center", fontWeight: 800 }}
                            title="When enabled, this participant can access the customer portal as an Org Admin."
                          >
                            <input
                              type="checkbox"
                              checked={p.portal_role === "ORG_ADMIN"}
                              disabled={updatingVisibilityId === p.id}
                              onChange={(e) =>
                                setParticipantPortalRole(
                                  p.id,
                                  e.target.checked ? "ORG_ADMIN" : "NONE"
                                )
                              }
                            />
                            {p.portal_role === "ORG_ADMIN" ? "Allowed" : "Hidden"}
                          </label>
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
                              disabled={!p.email || resendingEmail === (p.email ?? "").trim().toLowerCase()}
                              style={{
                                background:
                                  !p.email || resendingEmail === (p.email ?? "").trim().toLowerCase()
                                    ? "#98a2b3"
                                    : BRAND.dark,
                                color: "white",
                                border: "none",
                                padding: "8px 10px",
                                borderRadius: 10,
                                fontWeight: 900,
                                cursor:
                                  !p.email || resendingEmail === (p.email ?? "").trim().toLowerCase()
                                    ? "not-allowed"
                                    : "pointer",
                              }}
                              title={
                                !p.email
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