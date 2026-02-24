-- CreateEnum
CREATE TYPE "public"."Pillar" AS ENUM ('SYSTEM_INTEGRITY', 'HUMAN_ALIGNMENT', 'STRATEGIC_COHERENCE', 'SUSTAINABILITY_PRACTICE');

-- CreateEnum
CREATE TYPE "public"."AssessmentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateTable
CREATE TABLE "public"."Organization" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "size" TEXT,
    "growth_stage" TEXT,
    "primary_pressures" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Assessment" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "cohort_name" TEXT,
    "assessment_date" TIMESTAMP(3),
    "status" "public"."AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Participant" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role" TEXT,
    "seniority_level" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Question" (
    "id" UUID NOT NULL,
    "pillar" "public"."Pillar" NOT NULL,
    "question_text" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Response" (
    "id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "free_write" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Response_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrganizationDocument" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_url" TEXT,
    "storage_path" TEXT,
    "mime_type" TEXT,
    "text_extracted" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Organization_name_idx" ON "public"."Organization"("name");

-- CreateIndex
CREATE INDEX "Assessment_organization_id_idx" ON "public"."Assessment"("organization_id");

-- CreateIndex
CREATE INDEX "Assessment_status_idx" ON "public"."Assessment"("status");

-- CreateIndex
CREATE INDEX "Participant_organization_id_idx" ON "public"."Participant"("organization_id");

-- CreateIndex
CREATE INDEX "Question_pillar_active_idx" ON "public"."Question"("pillar", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Question_pillar_display_order_version_key" ON "public"."Question"("pillar", "display_order", "version");

-- CreateIndex
CREATE INDEX "Response_assessment_id_idx" ON "public"."Response"("assessment_id");

-- CreateIndex
CREATE INDEX "Response_participant_id_idx" ON "public"."Response"("participant_id");

-- CreateIndex
CREATE INDEX "Response_question_id_idx" ON "public"."Response"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "Response_assessment_id_participant_id_question_id_key" ON "public"."Response"("assessment_id", "participant_id", "question_id");

-- CreateIndex
CREATE INDEX "OrganizationDocument_organization_id_source_type_idx" ON "public"."OrganizationDocument"("organization_id", "source_type");

-- AddForeignKey
ALTER TABLE "public"."Assessment" ADD CONSTRAINT "Assessment_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Participant" ADD CONSTRAINT "Participant_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Response" ADD CONSTRAINT "Response_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Response" ADD CONSTRAINT "Response_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Response" ADD CONSTRAINT "Response_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrganizationDocument" ADD CONSTRAINT "OrganizationDocument_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
