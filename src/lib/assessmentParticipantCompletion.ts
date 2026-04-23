import { prisma } from "@/lib/prisma";
import { isAdminEmail } from "@/lib/admin";

export { ASSESSMENTS_IN_PROGRESS_MESSAGE } from "@/lib/assessmentParticipantMessages";

export type ReportingParticipantCompletion = {
  participants_total: number;
  participants_completed: number;
  all_participants_completed: boolean;
};

/**
 * Counts invited assessment participants only — excludes the org admin “owner” row
 * (user-linked + admin email), matching /api/assessments/[id]/results.
 */
export async function getReportingParticipantCompletionStats(
  assessmentId: string
): Promise<ReportingParticipantCompletion> {
  const participantsRaw = await prisma.participant.findMany({
    where: { assessment_id: assessmentId },
    select: {
      user_id: true,
      email: true,
      completed_at: true,
    },
  });

  const reportingParticipants = participantsRaw.filter((p) => {
    const email = (p.email ?? "").trim().toLowerCase();
    const isOwnerAdmin = Boolean(p.user_id) && isAdminEmail(email);
    return !isOwnerAdmin;
  });

  const participantsTotal = reportingParticipants.length;
  const participantsCompleted = reportingParticipants.filter((p) => p.completed_at != null).length;

  const allParticipantsCompleted =
    participantsTotal > 0 && participantsCompleted >= participantsTotal;

  return {
    participants_total: participantsTotal,
    participants_completed: participantsCompleted,
    all_participants_completed: allParticipantsCompleted,
  };
}
