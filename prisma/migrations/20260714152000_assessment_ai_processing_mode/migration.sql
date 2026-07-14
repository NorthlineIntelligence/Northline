CREATE TYPE "AssessmentAiProcessingMode" AS ENUM ('fast', 'executive');

ALTER TABLE "Assessment"
  ADD COLUMN "aiProcessingMode" "AssessmentAiProcessingMode" NOT NULL DEFAULT 'executive';
