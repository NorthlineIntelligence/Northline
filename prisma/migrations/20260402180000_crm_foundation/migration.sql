-- CreateEnum
CREATE TYPE "public"."CrmPipelineStage" AS ENUM ('NEW_PROSPECT', 'CONSULTATION', 'ASSESSMENT_ACTIVE', 'ASSESSMENT_COMPLETE', 'WORKSHOP_SCHEDULED', 'WORKSHOP_CONDUCTED', 'QUOTE_DRAFTED', 'QUOTE_DELIVERED', 'QUOTE_ACCEPTED');

-- CreateEnum
CREATE TYPE "public"."CrmQuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED');

-- AlterTable
ALTER TABLE "public"."Organization" ADD COLUMN "crm_pipeline_stage" "public"."CrmPipelineStage" NOT NULL DEFAULT 'NEW_PROSPECT';
ALTER TABLE "public"."Organization" ADD COLUMN "crm_stage_updated_at" TIMESTAMP(3);
ALTER TABLE "public"."Organization" ADD COLUMN "crm_next_follow_up_at" TIMESTAMP(3);
ALTER TABLE "public"."Organization" ADD COLUMN "crm_internal_notes" TEXT;

CREATE INDEX "Organization_crm_pipeline_stage_idx" ON "public"."Organization"("crm_pipeline_stage");
CREATE INDEX "Organization_crm_next_follow_up_at_idx" ON "public"."Organization"("crm_next_follow_up_at");

-- CreateTable
CREATE TABLE "public"."OrgContact" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "title" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PriceBook" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "line_items" JSONB NOT NULL,
    "notes" TEXT,
    "source_filename" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceBook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CrmQuote" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "assessment_id" UUID,
    "project_scope_version" INTEGER,
    "project_scope_snapshot" JSONB,
    "quote_payload" JSONB NOT NULL,
    "status" "public"."CrmQuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "signee_contact_id" UUID,
    "billing_contact_id" UUID,
    "total_cents" INTEGER,
    "valid_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CrmContract" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "quote_id" UUID,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "body_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CrmInvoice" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "due_date" TIMESTAMP(3),
    "quote_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmInvoice_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."OrgContact" ADD CONSTRAINT "OrgContact_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."CrmQuote" ADD CONSTRAINT "CrmQuote_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."CrmQuote" ADD CONSTRAINT "CrmQuote_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."Assessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."CrmQuote" ADD CONSTRAINT "CrmQuote_signee_contact_id_fkey" FOREIGN KEY ("signee_contact_id") REFERENCES "public"."OrgContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."CrmQuote" ADD CONSTRAINT "CrmQuote_billing_contact_id_fkey" FOREIGN KEY ("billing_contact_id") REFERENCES "public"."OrgContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."CrmContract" ADD CONSTRAINT "CrmContract_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."CrmContract" ADD CONSTRAINT "CrmContract_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "public"."CrmQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."CrmInvoice" ADD CONSTRAINT "CrmInvoice_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."CrmInvoice" ADD CONSTRAINT "CrmInvoice_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "public"."CrmQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "OrgContact_organization_id_idx" ON "public"."OrgContact"("organization_id");
CREATE INDEX "OrgContact_organization_id_is_archived_idx" ON "public"."OrgContact"("organization_id", "is_archived");
CREATE INDEX "PriceBook_is_current_idx" ON "public"."PriceBook"("is_current");
CREATE INDEX "PriceBook_created_at_idx" ON "public"."PriceBook"("created_at");
CREATE INDEX "CrmQuote_organization_id_idx" ON "public"."CrmQuote"("organization_id");
CREATE INDEX "CrmQuote_organization_id_status_idx" ON "public"."CrmQuote"("organization_id", "status");
CREATE INDEX "CrmQuote_assessment_id_idx" ON "public"."CrmQuote"("assessment_id");
CREATE INDEX "CrmContract_organization_id_idx" ON "public"."CrmContract"("organization_id");
CREATE INDEX "CrmContract_status_idx" ON "public"."CrmContract"("status");
CREATE INDEX "CrmInvoice_organization_id_idx" ON "public"."CrmInvoice"("organization_id");
CREATE INDEX "CrmInvoice_status_idx" ON "public"."CrmInvoice"("status");
CREATE INDEX "CrmInvoice_due_date_idx" ON "public"."CrmInvoice"("due_date");
