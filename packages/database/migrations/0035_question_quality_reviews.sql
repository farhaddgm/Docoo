CREATE TABLE "question_quality_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"criteria" jsonb NOT NULL,
	"question_count" integer NOT NULL,
	"judge_version_id" uuid,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"score" integer,
	"summary" text,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"discarded" integer DEFAULT 0 NOT NULL,
	"invocation_id" uuid,
	"error_code" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "question_quality_reviews" ADD CONSTRAINT "question_quality_reviews_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_quality_reviews" ADD CONSTRAINT "question_quality_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_quality_reviews" ADD CONSTRAINT "question_quality_reviews_session_id_analysis_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_quality_reviews" ADD CONSTRAINT "question_quality_reviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "question_quality_reviews_project_idx" ON "question_quality_reviews" USING btree ("project_id","created_at");