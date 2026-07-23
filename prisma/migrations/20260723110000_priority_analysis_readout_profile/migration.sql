-- CreateEnum
CREATE TYPE "PriorityReadoutProfile" AS ENUM ('STANDARD', 'CLIENT_SPECIFIC');

-- AlterTable
ALTER TABLE "PriorityAnalysis" ADD COLUMN "readoutProfile" "PriorityReadoutProfile" NOT NULL DEFAULT 'STANDARD';

-- Backfill any client-specific rows created before the dedicated column existed.
UPDATE "PriorityAnalysis"
SET "readoutProfile" = 'CLIENT_SPECIFIC'
WHERE "outputJson"->>'readoutProfile' = 'client_specific';

-- CreateIndex
CREATE INDEX "PriorityAnalysis_assessmentId_readoutProfile_createdAt_idx" ON "PriorityAnalysis"("assessmentId", "readoutProfile", "createdAt");
