"use client";

import { useState } from "react";
import {
  AssessmentInviteSchedulerFields,
  type InviteSendMode,
} from "@/components/assessments/AssessmentInviteSchedulerFields";

export function OnboardInviteSchedulerSection() {
  const [mode, setMode] = useState<InviteSendMode>("later");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("09:00");
  const [timezone, setTimezone] = useState("America/New_York");

  return (
    <div className="rounded-2xl border border-[#cdd8df] bg-[#f9fafb] p-4">
      <AssessmentInviteSchedulerFields
        mode={mode}
        onModeChange={setMode}
        scheduledDate={scheduledDate}
        onScheduledDateChange={setScheduledDate}
        scheduledTime={scheduledTime}
        onScheduledTimeChange={setScheduledTime}
        timezone={timezone}
        onTimezoneChange={setTimezone}
        includeFormFields
      />
    </div>
  );
}
