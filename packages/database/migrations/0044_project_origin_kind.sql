-- How a project built on another one began: a plain copy, a continuation or a pivot.
ALTER TABLE "projects" ADD COLUMN "origin_kind" text;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_origin_kind_check" CHECK ("origin_kind" IS NULL OR "origin_kind" IN ('copy', 'continuation', 'pivot'));
