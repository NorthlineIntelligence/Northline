import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { isAdminEmail } from "@/lib/admin";
import { getReportingParticipantCompletionStats } from "@/lib/assessmentParticipantCompletion";
import {
  EXECUTIVE_INSIGHTS_GENERATE_INSTRUCTIONS,
  EXECUTIVE_INSIGHTS_SHARED_READOUT_NOTE,
  executiveInsightsEmailIntro,
} from "@/lib/executiveInsightsCopy";
import { getInviteOrigin, sendInviteEmail } from "@/lib/assessmentInvites";

const INVITE_EXPIRES_HOURS = 24 * 14;

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function makeRawToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function executiveInsightsPath(assessmentType: "READINESS" | "PRIORITY_DISCOVERY", assessmentId: string) {
  if (assessmentType === "PRIORITY_DISCOVERY") {
    return `/assessments/${assessmentId}/executive-insights`;
  }
  return `/assessments/${assessmentId}/narrative`;
}

function assessmentLabel(assessmentType: "READINESS" | "PRIORITY_DISCOVERY") {
  return assessmentType === "PRIORITY_DISCOVERY"
    ? "AI Priority Discovery Assessment"
    : "AI Readiness Assessment";
}

export function buildExecutiveInsightsReadyEmailHtml(args: {
  insightsUrl: string;
  assessmentLabel: string;
}) {
  const steps = EXECUTIVE_INSIGHTS_GENERATE_INSTRUCTIONS.map(
    (step, index) => `<li>${index + 1}. ${step}</li>`
  ).join("");

  return `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; color:#0B1220; line-height:1.45">
      <div style="max-width: 640px; margin: 0 auto; padding: 24px;">
        <div style="font-size: 18px; font-weight: 800; color:#173464;">Northline Executive Insights</div>
        <div style="margin-top: 14px; font-size: 14px;">
          ${executiveInsightsEmailIntro(args.assessmentLabel)}
        </div>
        <div style="margin-top: 14px; font-size: 14px; font-weight: 700; color:#173464;">Instructions</div>
        <ol style="margin-top: 8px; padding-left: 20px; font-size: 14px; line-height: 1.55;">
          ${steps}
        </ol>
        <div style="margin-top: 12px; font-size: 13px; color:#4B5565;">
          ${EXECUTIVE_INSIGHTS_SHARED_READOUT_NOTE}
        </div>
        <div style="margin-top: 16px;">
          <a href="${args.insightsUrl}"
             style="display:inline-block; background:#173464; color:#ffffff; text-decoration:none; font-weight:800; padding:12px 16px; border-radius:12px;">
            Open Executive Insights
          </a>
        </div>
        <div style="margin-top: 12px; font-size: 12px; color:#4B5565;">
          If the button does not work, copy and paste this link:
          <div style="margin-top: 8px; padding: 10px; background:#F6F8FC; border:1px solid #E6EAF2; border-radius: 10px; word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">
            ${args.insightsUrl}
          </div>
        </div>
      </div>
    </div>
  `;
}

async function getExecutiveInsightsRecipients(assessmentId: string) {
  const participants = await prisma.participant.findMany({
    where: {
      assessment_id: assessmentId,
      can_view_executive_insights: true,
      email: { not: null },
    },
    select: {
      id: true,
      email: true,
      user_id: true,
    },
  });

  return participants.filter((participant) => {
    const email = (participant.email ?? "").trim().toLowerCase();
    if (!email) return false;
    const isOwnerAdmin = Boolean(participant.user_id) && isAdminEmail(email);
    return !isOwnerAdmin;
  });
}

async function refreshParticipantInviteToken(participantId: string) {
  const rawToken = makeRawToken();
  const expiresAt = new Date(Date.now() + INVITE_EXPIRES_HOURS * 60 * 60 * 1000);
  await prisma.participant.update({
    where: { id: participantId },
    data: {
      invite_token_hash: sha256Hex(rawToken),
      invite_token_expires_at: expiresAt,
    },
  });
  return rawToken;
}

export async function maybeNotifyExecutiveInsightsViewers(args: {
  assessmentId: string;
  originFallback?: string;
}) {
  const stats = await getReportingParticipantCompletionStats(args.assessmentId);
  if (!stats.all_participants_completed) {
    return { notified: false, reason: "not_all_complete" as const };
  }

  const claimed = await prisma.assessment.updateMany({
    where: {
      id: args.assessmentId,
      executive_insights_notified_at: null,
    },
    data: { executive_insights_notified_at: new Date() },
  });
  if (claimed.count === 0) {
    return { notified: false, reason: "already_notified" as const };
  }

  const assessment = await prisma.assessment.findUnique({
    where: { id: args.assessmentId },
    select: { id: true, assessment_type: true, name: true },
  });
  if (!assessment) {
    return { notified: false, reason: "assessment_missing" as const };
  }

  const recipients = await getExecutiveInsightsRecipients(args.assessmentId);
  if (recipients.length === 0) {
    return { notified: false, reason: "no_recipients" as const, sent: 0, failed: 0 };
  }

  const origin = getInviteOrigin(args.originFallback ?? "http://localhost:3000");
  const path = executiveInsightsPath(assessment.assessment_type, assessment.id);
  const label = assessmentLabel(assessment.assessment_type);
  const subject = "Northline Executive Insights are ready";

  let sent = 0;
  let failed = 0;

  await Promise.all(
    recipients.map(async (recipient) => {
      const email = (recipient.email ?? "").trim().toLowerCase();
      try {
        const rawToken = await refreshParticipantInviteToken(recipient.id);
        const insightsUrl =
          `${origin}${path}` +
          `?email=${encodeURIComponent(email)}` +
          `&token=${encodeURIComponent(rawToken)}`;
        const html = buildExecutiveInsightsReadyEmailHtml({
          insightsUrl,
          assessmentLabel: label,
        });
        await sendInviteEmail({ to: email, subject, html });
        sent += 1;
      } catch (err: unknown) {
        failed += 1;
        console.error("[executive-insights-notify] email failed:", email, err);
      }
    })
  );

  return { notified: true, sent, failed, recipients: recipients.length };
}
