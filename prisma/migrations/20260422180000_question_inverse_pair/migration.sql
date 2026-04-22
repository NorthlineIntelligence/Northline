-- Optional inverse pair for perception / consistency checks on narrative diagnostics.
ALTER TABLE "Question" ADD COLUMN "inverse_question_id" UUID;

ALTER TABLE "Question"
  ADD CONSTRAINT "Question_inverse_question_id_fkey"
  FOREIGN KEY ("inverse_question_id") REFERENCES "Question"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Question_inverse_question_id_idx" ON "Question" ("inverse_question_id");
