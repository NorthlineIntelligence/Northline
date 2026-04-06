-- AlterTable
ALTER TABLE "public"."PriceBook" ADD COLUMN "storage_bucket" TEXT;
ALTER TABLE "public"."PriceBook" ADD COLUMN "storage_path" TEXT;
ALTER TABLE "public"."PriceBook" ADD COLUMN "mime_type" TEXT;
