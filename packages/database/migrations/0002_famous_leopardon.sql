ALTER TABLE "project_topics" ALTER COLUMN "priority" SET DATA TYPE integer USING "priority"::integer;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "version" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "version" SET DATA TYPE integer USING "version"::integer;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "version" SET DEFAULT 1;
