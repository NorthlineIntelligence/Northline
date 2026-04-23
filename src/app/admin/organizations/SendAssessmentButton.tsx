"use client";

import { useMemo, useState } from "react";

type Props = {
  assessmentId: string;
  assessmentLocked: boolean;
  participantEmails: string[];
};

export default function SendAssessmentButton({
  assessmentId,
  assessmentLocked,
  participantEmails,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const cleanEmails = useMemo(
    () =>
      Array.from(
        new Set(
          participantEmails
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean)
        )
      ),
    [participantEmails]
  );

  async function sendNow() {
    if (assessmentLocked) {
      setMessage("Assessment is locked/closed, so invites cannot be sent.");
      return;
    }
    if (cleanEmails.length === 0) {
      setMessage("No participant emails found for this assessment.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/assessments/${assessmentId}/participants/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ emails: cleanEmails }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage(json?.error ? `Send failed: ${json.error}` : "Send failed.");
        return;
      }
      setMessage(
        `Assessment sent. Invited: ${json?.invited ?? cleanEmails.length}, Sent: ${json?.sent ?? 0}, Failed: ${
          json?.failed ?? 0
        }`
      );
    } catch (err: any) {
      setMessage(`Send failed: ${err?.message ?? "Unknown error"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void sendNow()}
        disabled={busy || assessmentLocked}
        className="rounded-2xl border border-[#173464] bg-[#173464] px-4 py-2 text-sm font-black tracking-tight text-white shadow-[0_1px_2px_rgba(15,23,42,0.08),0_8px_18px_rgba(23,52,100,0.24)] transition hover:-translate-y-[1px] hover:bg-[#132d59] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Sending Assessment..." : "Send Assessment"}
      </button>
      {message ? <p className="text-xs text-[#66819e]">{message}</p> : null}
    </div>
  );
}

