CREATE TYPE "AssessmentKind" AS ENUM ('readiness', 'priority_discovery');
CREATE TYPE "PriorityResponseType" AS ENUM (
  'FREE_TEXT',
  'LIKERT',
  'RANKING',
  'MULTI_SELECT',
  'FORCED_CHOICE',
  'DEPARTMENT',
  'CONFIDENCE',
  'URGENCY'
);
CREATE TYPE "PriorityScoringDimension" AS ENUM (
  'URGENCY',
  'BUSINESS_IMPACT',
  'FREQUENCY',
  'MANUAL_EFFORT',
  'CUSTOMER_IMPACT',
  'EMPLOYEE_IMPACT',
  'DATA_READINESS',
  'OWNERSHIP_CLARITY',
  'RISK_LEVEL',
  'AI_APPLICABILITY',
  'AUTOMATION_APPLICABILITY',
  'STRATEGIC_ALIGNMENT',
  'CONFIDENCE',
  'RESPONDENT_ALIGNMENT'
);
CREATE TYPE "PriorityEstimatedEffort" AS ENUM ('low', 'medium', 'high');
CREATE TYPE "PriorityTimeHorizon" AS ENUM ('0-30 days', '30-90 days', '90-180 days', '6-12 months');
CREATE TYPE "PriorityConfidenceLevel" AS ENUM ('low', 'medium', 'high');

ALTER TABLE "Assessment"
  ADD COLUMN "assessment_type" "AssessmentKind" NOT NULL DEFAULT 'readiness',
  ADD COLUMN "question_set_version" TEXT NOT NULL DEFAULT '1';

CREATE TABLE "PriorityQuestion" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assessmentType" "AssessmentKind" NOT NULL DEFAULT 'priority_discovery',
  "question_set_version" TEXT NOT NULL DEFAULT '1',
  "section" TEXT NOT NULL,
  "questionText" TEXT NOT NULL,
  "questionHelpText" TEXT,
  "responseType" "PriorityResponseType" NOT NULL,
  "options" JSONB,
  "scaleMin" INTEGER,
  "scaleMax" INTEGER,
  "scaleLabels" JSONB,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "order" INTEGER NOT NULL,
  "tags" JSONB,
  "scoringDimension" "PriorityScoringDimension",
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PriorityQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PriorityResponse" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assessmentId" UUID NOT NULL,
  "participantId" UUID NOT NULL,
  "questionId" UUID NOT NULL,
  "answerText" TEXT,
  "answerNumber" INTEGER,
  "answerJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PriorityResponse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PriorityAnalysis" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assessmentId" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "aiModelUsed" TEXT,
  "inputHash" TEXT NOT NULL,
  "outputJson" JSONB NOT NULL,
  "executiveSummary" TEXT,
  "overallSynergyScore" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PriorityAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PriorityProject" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "priorityAnalysisId" UUID NOT NULL,
  "rank" INTEGER NOT NULL,
  "projectName" TEXT NOT NULL,
  "problemStatement" TEXT,
  "recommendedSolution" TEXT,
  "shortTermImpact" TEXT,
  "longTermImpact" TEXT,
  "implementationRisk" TEXT,
  "readinessDependency" TEXT,
  "firstStep" TEXT,
  "estimatedEffort" "PriorityEstimatedEffort",
  "estimatedTimeHorizon" "PriorityTimeHorizon",
  "aiSuitabilityScore" INTEGER,
  "automationSuitabilityScore" INTEGER,
  "businessImpactScore" INTEGER,
  "urgencyScore" INTEGER,
  "synergyScore" INTEGER,
  "riskScore" INTEGER,
  "priorityScore" INTEGER,
  "confidenceLevel" "PriorityConfidenceLevel",
  "evidenceJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PriorityProject_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Assessment_assessment_type_idx" ON "Assessment"("assessment_type");
CREATE INDEX "PriorityQuestion_assessmentType_question_set_version_isActive_order_idx"
  ON "PriorityQuestion"("assessmentType", "question_set_version", "isActive", "order");
CREATE INDEX "PriorityQuestion_assessmentType_section_idx"
  ON "PriorityQuestion"("assessmentType", "section");
CREATE UNIQUE INDEX "priority_response_unique_per_participant_question"
  ON "PriorityResponse"("assessmentId", "participantId", "questionId");
CREATE INDEX "PriorityResponse_assessmentId_participantId_idx"
  ON "PriorityResponse"("assessmentId", "participantId");
CREATE INDEX "PriorityResponse_assessmentId_questionId_idx"
  ON "PriorityResponse"("assessmentId", "questionId");
CREATE INDEX "PriorityAnalysis_assessmentId_createdAt_idx"
  ON "PriorityAnalysis"("assessmentId", "createdAt");
CREATE INDEX "PriorityAnalysis_organizationId_createdAt_idx"
  ON "PriorityAnalysis"("organizationId", "createdAt");
CREATE INDEX "PriorityProject_priorityAnalysisId_rank_idx"
  ON "PriorityProject"("priorityAnalysisId", "rank");

ALTER TABLE "PriorityResponse"
  ADD CONSTRAINT "PriorityResponse_assessmentId_fkey"
  FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PriorityResponse"
  ADD CONSTRAINT "PriorityResponse_participantId_fkey"
  FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PriorityResponse"
  ADD CONSTRAINT "PriorityResponse_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "PriorityQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PriorityAnalysis"
  ADD CONSTRAINT "PriorityAnalysis_assessmentId_fkey"
  FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PriorityAnalysis"
  ADD CONSTRAINT "PriorityAnalysis_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PriorityProject"
  ADD CONSTRAINT "PriorityProject_priorityAnalysisId_fkey"
  FOREIGN KEY ("priorityAnalysisId") REFERENCES "PriorityAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
