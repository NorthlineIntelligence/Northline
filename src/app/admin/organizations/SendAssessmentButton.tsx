"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AssessmentInviteSchedulerFields,
} from "@/components/assessments/AssessmentInviteSchedulerFields";

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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [emailsText, setEmailsText] = useState("");
  const [sendMode, setSendMode] = useState<"immediate" | "scheduled">("immediate");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("09:00");
  const [timezone, setTimezone] = useState("America/New_York");

  const defaultEmails = useMemo(
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

  function openModal() {
    setEmailsText(defaultEmails.join("\n"));
    setMessage(null);
    setOpen(true);
  }

  function parseEmails(raw: string) {
    return Array.from(
      new Set(
        raw
          .split(/[,\n]/g)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      )
    );
  }

  async function submitInvites() {
    const emails = parseEmails(emailsText);
    if (emails.length === 0) {
      setMessage("Add at least one participant email.");
      return;
    }
    if (sendMode === "scheduled" && (!scheduledDate || !scheduledTime || !timezone)) {
      setMessage("Choose a date, time, and timezone for scheduled send.");
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/admin/assessments/${assessmentId}/participants/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          emails,
          expiresInHours: 24 * 7,
          sendMode: sendMode === "scheduled" ? "scheduled" : "immediate",
          scheduledLocalDate: sendMode === "scheduled" ? scheduledDate : undefined,
          scheduledLocalTime: sendMode === "scheduled" ? scheduledTime : undefined,
          timezone: sendMode === "scheduled" ? timezone : undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setMessage(json?.error ?? `Send failed (${res.status}).`);
        setBusy(false);
        return;
      }

      if (json.scheduled) {
        setMessage(
          `Scheduled ${json.invited ?? emails.length} invite${emails.length === 1 ? "" : "s"} for ${scheduledDate} ${scheduledTime} (${timezone}).`
        );
      } else {
        setMessage(
          `Assessment sent. Invited: ${json.invited ?? emails.length}, Sent: ${json.sent ?? 0}, Failed: ${json.failed ?? 0}`
        );
      }
      setBusy(false);
    } catch (err: unknown) {
      setMessage(`Send failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={openModal}
          disabled={assessmentLocked}
          className="rounded-2xl border border-[#173464] bg-[#173464] px-4 py-2 text-sm font-black tracking-tight text-white shadow-[0_1px_2px_rgba(15,23,42,0.08),0_8px_18px_rgba(23,52,100,0.24)] transition hover:-translate-y-[1px] hover:bg-[#132d59] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Send / Schedule Assessment
        </button>
        {!open && defaultEmails.length === 0 ? (
          <p className="text-xs text-[#66819e]">No participant emails yet. Open to add emails and send or schedule.</p>
        ) : null}
        {!open && message ? <p className="text-xs text-[#66819e]">{message}</p> : null}
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#cdd8df] bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.14em] text-[#0f6e7b]">Assessment delivery</div>
                <h2 className="mt-2 text-xl font-semibold text-[#173464]">Send or Schedule Invites</h2>
                <p className="mt-1 text-sm text-[#66819e]">
                  Add participant emails and choose immediate or scheduled delivery for this assessment phase.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-[#cdd8df] px-3 py-2 text-sm font-semibold text-[#173464]"
              >
                Close
              </button>
            </div>

            <label className="mt-5 grid gap-2">
              <span className="text-sm font-medium text-[#173464]">Participant emails</span>
              <textarea
                value={emailsText}
                onChange={(e) => setEmailsText(e.target.value)}
                rows={5}
                placeholder={"exec@client.com\nstaff@client.com"}
                className="rounded-lg border border-[#cdd8df] px-3 py-2 text-sm"
              />
            </label>

            <div className="mt-4">
              <AssessmentInviteSchedulerFields
                mode={sendMode}
                onModeChange={(mode) => {
                  if (mode === "immediate" || mode === "scheduled") setSendMode(mode);
                }}
                scheduledDate={scheduledDate}
                onScheduledDateChange={setScheduledDate}
                scheduledTime={scheduledTime}
                onScheduledTimeChange={setScheduledTime}
                timezone={timezone}
                onTimezoneChange={setTimezone}
                disabled={busy || assessmentLocked}
                showLaterOption={false}
              />
            </div>

            {message ? (
              <div className="mt-4 rounded-xl border border-[#cdd8df] px-4 py-3 text-sm font-semibold text-[#173464]">
                {message}
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <Link href={`/admin/assessments/${assessmentId}`} className="text-xs font-semibold text-[#66819e] hover:underline">
                Open full assessment setup
              </Link>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-[#cdd8df] px-4 py-2 text-sm font-semibold text-[#173464]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void submitInvites()}
                  disabled={busy || assessmentLocked}
                  className="rounded-lg bg-[#173464] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {busy ? "Saving..." : sendMode === "scheduled" ? "Schedule Invites" : "Send Invites Now"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
