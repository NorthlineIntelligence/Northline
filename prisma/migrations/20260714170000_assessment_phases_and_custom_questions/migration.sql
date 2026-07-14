ALTER TABLE "Assessment"
  ADD COLUMN "parentAssessmentId" UUID;

ALTER TABLE "PriorityQuestion"
  ADD COLUMN "assessmentId" UUID;

CREATE INDEX "PriorityQuestion_assessmentId_isActive_order_idx"
  ON "PriorityQuestion"("assessmentId", "isActive", "order");

ALTER TABLE "Assessment"
  ADD CONSTRAINT "Assessment_parentAssessmentId_fkey"
  FOREIGN KEY ("parentAssessmentId") REFERENCES "Assessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PriorityQuestion"
  ADD CONSTRAINT "PriorityQuestion_assessmentId_fkey"
  FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
