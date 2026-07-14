"use client";

import { INVITE_TIMEZONE_OPTIONS } from "@/lib/scheduleTimezone";

export type InviteSendMode = "later" | "immediate" | "scheduled";

type AssessmentInviteSchedulerFieldsProps = {
  mode: InviteSendMode;
  onModeChange: (mode: InviteSendMode) => void;
  scheduledDate: string;
  onScheduledDateChange: (value: string) => void;
  scheduledTime: string;
  onScheduledTimeChange: (value: string) => void;
  timezone: string;
  onTimezoneChange: (value: string) => void;
  disabled?: boolean;
  /** Include hidden inputs for multipart form POST (onboard). */
  includeFormFields?: boolean;
  compact?: boolean;
  showLaterOption?: boolean;
};

export function AssessmentInviteSchedulerFields(props: AssessmentInviteSchedulerFieldsProps) {
  const buttonClass = (active: boolean) =>
    `rounded-lg border px-3 py-2 text-xs font-semibold ${
      active ? "border-[#173464] bg-[#E8F7F8] text-[#173464]" : "border-[#cdd8df] bg-white text-[#173464]"
    } ${props.disabled ? "opacity-60 cursor-not-allowed" : ""}`;

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium text-[#173464]">Assessment invite delivery</div>
        <p className="mt-1 text-xs text-[#66819e]">
          Choose whether to send assessment invites now, schedule them for later, or save participants and send manually from the assessment page.
        </p>
      </div>

      {props.includeFormFields ? (
        <>
          <input type="hidden" name="invite_send_mode" value={props.mode} />
          {props.mode === "scheduled" ? (
            <>
              <input type="hidden" name="invite_scheduled_date" value={props.scheduledDate} />
              <input type="hidden" name="invite_scheduled_time" value={props.scheduledTime} />
              <input type="hidden" name="invite_timezone" value={props.timezone} />
            </>
          ) : null}
        </>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(props.showLaterOption ?? true) ? (
          <button type="button" disabled={props.disabled} className={buttonClass(props.mode === "later")} onClick={() => props.onModeChange("later")}>
            Send Later
          </button>
        ) : null}
        <button type="button" disabled={props.disabled} className={buttonClass(props.mode === "immediate")} onClick={() => props.onModeChange("immediate")}>
          Send Immediately
        </button>
        <button type="button" disabled={props.disabled} className={buttonClass(props.mode === "scheduled")} onClick={() => props.onModeChange("scheduled")}>
          Schedule Send
        </button>
      </div>

      {props.mode === "scheduled" ? (
        <div className={`grid gap-3 ${props.compact ? "sm:grid-cols-3" : "md:grid-cols-3"}`}>
          <label className="grid gap-1 text-xs font-semibold text-[#173464]">
            Date
            <input
              type="date"
              value={props.scheduledDate}
              onChange={(e) => props.onScheduledDateChange(e.target.value)}
              disabled={props.disabled}
              className="rounded-lg border border-[#cdd8df] px-3 py-2 text-sm"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-[#173464]">
            Time
            <input
              type="time"
              value={props.scheduledTime}
              onChange={(e) => props.onScheduledTimeChange(e.target.value)}
              disabled={props.disabled}
              className="rounded-lg border border-[#cdd8df] px-3 py-2 text-sm"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-[#173464]">
            Timezone
            <select
              value={props.timezone}
              onChange={(e) => props.onTimezoneChange(e.target.value)}
              disabled={props.disabled}
              className="rounded-lg border border-[#cdd8df] px-3 py-2 text-sm"
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

      {props.mode === "immediate" ? (
        <p className="text-xs text-[#66819e]">Invites will be emailed as soon as the organization is created.</p>
      ) : null}
      {props.mode === "scheduled" ? (
        <p className="text-xs text-[#66819e]">Invites will send automatically at the scheduled date and time.</p>
      ) : null}
      {props.mode === "later" ? (
        <p className="text-xs text-[#66819e]">Participant emails will be saved. Send or schedule invites from the CRM or assessment page when ready.</p>
      ) : null}
    </div>
  );
}
