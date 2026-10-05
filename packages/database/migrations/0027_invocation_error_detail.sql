ALTER TABLE "model_invocations" ADD COLUMN "error_detail" text;
--> statement-breakpoint
ALTER TABLE "model_invocations" ADD CONSTRAINT "model_invocations_error_detail_len"
  CHECK ("error_detail" IS NULL OR char_length("error_detail") <= 300);
