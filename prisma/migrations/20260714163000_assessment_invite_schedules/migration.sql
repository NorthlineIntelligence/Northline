CREATE TYPE "AssessmentInviteScheduleStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'PARTIAL', 'FAILED', 'CANCELLED');

CREATE TABLE "AssessmentInviteSchedule" (
  "id" UUID NOT NULL,
  "assessmentId" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "emailsJson" JSONB NOT NULL,
  "portalRoleByEmailJson" JSONB,
  "scheduledAtUtc" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT NOT NULL,
  "localDate" TEXT NOT NULL,
  "localTime" TEXT NOT NULL,
  "status" "AssessmentInviteScheduleStatus" NOT NULL DEFAULT 'PENDING',
  "expiresInHours" INTEGER NOT NULL DEFAULT 168,
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "portalSentCount" INTEGER NOT NULL DEFAULT 0,
  "portalFailedCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdByEmail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),

  CONSTRAINT "AssessmentInviteSchedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssessmentInviteSchedule_status_scheduledAtUtc_idx"
  ON "AssessmentInviteSchedule"("status", "scheduledAtUtc");
CREATE INDEX "AssessmentInviteSchedule_assessmentId_createdAt_idx"
  ON "AssessmentInviteSchedule"("assessmentId", "createdAt");

ALTER TABLE "AssessmentInviteSchedule"
  ADD CONSTRAINT "AssessmentInviteSchedule_assessmentId_fkey"
  FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssessmentInviteSchedule"
  ADD CONSTRAINT "AssessmentInviteSchedule_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
