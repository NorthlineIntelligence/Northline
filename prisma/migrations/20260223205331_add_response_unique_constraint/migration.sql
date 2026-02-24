-- Add unique constraint to prevent duplicate submissions
ALTER TABLE "public"."Response"
ADD CONSTRAINT "response_unique_per_participant_question"
UNIQUE ("assessment_id", "participant_id", "question_id");
