import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getInviteOrigin,
  processAssessmentInvites,
  type PortalRole,
} from "@/lib/assessmentInvites";
import { isValidTimezone, zonedLocalToUtc } from "@/lib/scheduleTimezone";

export type CreateScheduledInviteInput = {
  assessmentId: string;
  organizationId: string;
  emails: string[];
  portalRoleByEmail?: Record<string, PortalRole>;
  expiresInHours?: number;
  localDate: string;
  localTime: string;
  timezone: string;
  createdByEmail?: string | null;
};

export function toClientInviteSchedule(schedule: {
  id: string;
  emails_json: Prisma.JsonValue;
  portal_role_by_email_json: Prisma.JsonValue | null;
  scheduled_at_utc: Date;
  timezone: string;
  local_date: string;
  local_time: string;
  status: string;
  sent_count: number;
  failed_count: number;
  portal_sent_count: number;
  portal_failed_count: number;
  last_error: string | null;
  created_by_email: string | null;
  created_at: Date;
  processed_at: Date | null;
}) {
  return {
    id: schedule.id,
    emails: Array.isArray(schedule.emails_json) ? schedule.emails_json.map(String) : [],
    portalRoleByEmail:
      schedule.portal_role_by_email_json &&
      typeof schedule.portal_role_by_email_json === "object" &&
      !Array.isArray(schedule.portal_role_by_email_json)
        ? (schedule.portal_role_by_email_json as Record<string, PortalRole>)
        : {},
    scheduledAtUtc: schedule.scheduled_at_utc.toISOString(),
    timezone: schedule.timezone,
    localDate: schedule.local_date,
    localTime: schedule.local_time,
    status: schedule.status,
    sentCount: schedule.sent_count,
    failedCount: schedule.failed_count,
    portalSentCount: schedule.portal_sent_count,
    portalFailedCount: schedule.portal_failed_count,
    lastError: schedule.last_error,
    createdByEmail: schedule.created_by_email,
    createdAt: schedule.created_at.toISOString(),
    processedAt: schedule.processed_at?.toISOString() ?? null,
  };
}

export async function createScheduledInvite(input: CreateScheduledInviteInput) {
  if (!isValidTimezone(input.timezone)) {
    throw new Error("Invalid timezone.");
  }

  const scheduledAtUtc = zonedLocalToUtc(input.localDate, input.localTime, input.timezone);
  if (scheduledAtUtc.getTime() <= Date.now()) {
    throw new Error("Scheduled send time must be in the future.");
  }

  const normalizedEmails = Array.from(
    new Set(input.emails.map((email) => email.trim().toLowerCase()).filter(Boolean))
  );
  if (normalizedEmails.length === 0) {
    throw new Error("At least one email is required.");
  }

  const schedule = await prisma.assessmentInviteSchedule.create({
    data: {
      assessment_id: input.assessmentId,
      organization_id: input.organizationId,
      emails_json: normalizedEmails,
      portal_role_by_email_json: (input.portalRoleByEmail ?? {}) as Prisma.InputJsonValue,
      scheduled_at_utc: scheduledAtUtc,
      timezone: input.timezone,
      local_date: input.localDate,
      local_time: input.localTime,
      expires_in_hours: input.expiresInHours ?? 168,
      created_by_email: input.createdByEmail ?? null,
    },
  });

  return toClientInviteSchedule(schedule);
}

export async function processDueScheduledInvites(originFallback: string) {
  const origin = getInviteOrigin(originFallback);
  const due = await prisma.assessmentInviteSchedule.findMany({
    where: {
      status: "PENDING",
      scheduled_at_utc: { lte: new Date() },
    },
    orderBy: { scheduled_at_utc: "asc" },
    take: 25,
  });

  const results: Array<{ scheduleId: string; status: string; sent: number; failed: number }> = [];

  for (const schedule of due) {
    const claimed = await prisma.assessmentInviteSchedule.updateMany({
      where: { id: schedule.id, status: "PENDING" },
      data: { status: "PROCESSING" },
    });
    if (claimed.count === 0) continue;

    try {
      const emails = Array.isArray(schedule.emails_json)
        ? schedule.emails_json.map(String)
        : [];
      const portalRoleByEmail =
        schedule.portal_role_by_email_json &&
        typeof schedule.portal_role_by_email_json === "object" &&
        !Array.isArray(schedule.portal_role_by_email_json)
          ? (schedule.portal_role_by_email_json as Record<string, PortalRole>)
          : {};

      const result = await processAssessmentInvites({
        assessmentId: schedule.assessment_id,
        emails,
        origin,
        expiresInHours: schedule.expires_in_hours,
        portalRoleByEmail,
      });

      const status =
        result.failed === 0 && result.portalFailed === 0
          ? "SENT"
          : result.sent === 0 && result.portalSent === 0
            ? "FAILED"
            : "PARTIAL";

      await prisma.assessmentInviteSchedule.update({
        where: { id: schedule.id },
        data: {
          status,
          sent_count: result.sent,
          failed_count: result.failed,
          portal_sent_count: result.portalSent,
          portal_failed_count: result.portalFailed,
          processed_at: new Date(),
          last_error:
            result.failed > 0 || result.portalFailed > 0
              ? `Assessment invites failed: ${result.failed}. Portal invites failed: ${result.portalFailed}.`
              : null,
        },
      });

      results.push({
        scheduleId: schedule.id,
        status,
        sent: result.sent,
        failed: result.failed,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.assessmentInviteSchedule.update({
        where: { id: schedule.id },
        data: {
          status: "FAILED",
          processed_at: new Date(),
          last_error: message,
        },
      });
      results.push({ scheduleId: schedule.id, status: "FAILED", sent: 0, failed: 0 });
    }
  }

  return { processed: results.length, results };
}

export async function cancelScheduledInvite(scheduleId: string, assessmentId: string) {
  const updated = await prisma.assessmentInviteSchedule.updateMany({
    where: {
      id: scheduleId,
      assessment_id: assessmentId,
      status: "PENDING",
    },
    data: { status: "CANCELLED" },
  });

  return updated.count > 0;
}
