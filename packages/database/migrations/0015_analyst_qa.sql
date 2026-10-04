CREATE TABLE "analysis_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"status" text NOT NULL,
	"text" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submission_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_contradictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"question_a_id" uuid NOT NULL,
	"question_b_id" uuid NOT NULL,
	"key" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"detected_round_id" uuid NOT NULL,
	"resolved_round_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"category" text NOT NULL,
	"text" text NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"follow_up_of_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"current_answer_id" uuid,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"round_no" integer NOT NULL,
	"based_on_batch_id" uuid,
	"outcome" text NOT NULL,
	"reason" text NOT NULL,
	"understood" text,
	"next_ambiguity" text,
	"sufficient" boolean,
	"sufficiency_reason" text,
	"category_notes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"invocation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"stage_run_id" uuid NOT NULL,
	"minimum_questions" integer DEFAULT 30 NOT NULL,
	"maximum_questions" integer DEFAULT 300 NOT NULL,
	"batch_size" integer DEFAULT 40 NOT NULL,
	"finish_requested_at" timestamp with time zone,
	"finish_requested_by" uuid,
	"finish_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"stage_run_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"batch_no" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "approved_problem_version_id" uuid;--> statement-breakpoint
ALTER TABLE "analysis_answers" ADD CONSTRAINT "analysis_answers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_answers" ADD CONSTRAINT "analysis_answers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_answers" ADD CONSTRAINT "analysis_answers_question_id_analysis_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."analysis_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_answers" ADD CONSTRAINT "analysis_answers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_contradictions" ADD CONSTRAINT "analysis_contradictions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_contradictions" ADD CONSTRAINT "analysis_contradictions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_contradictions" ADD CONSTRAINT "analysis_contradictions_session_id_analysis_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_contradictions" ADD CONSTRAINT "analysis_contradictions_question_a_id_analysis_questions_id_fk" FOREIGN KEY ("question_a_id") REFERENCES "public"."analysis_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_contradictions" ADD CONSTRAINT "analysis_contradictions_question_b_id_analysis_questions_id_fk" FOREIGN KEY ("question_b_id") REFERENCES "public"."analysis_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_questions" ADD CONSTRAINT "analysis_questions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_questions" ADD CONSTRAINT "analysis_questions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_questions" ADD CONSTRAINT "analysis_questions_session_id_analysis_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_questions" ADD CONSTRAINT "analysis_questions_batch_id_question_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."question_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_rounds" ADD CONSTRAINT "analysis_rounds_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_rounds" ADD CONSTRAINT "analysis_rounds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_rounds" ADD CONSTRAINT "analysis_rounds_session_id_analysis_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_sessions" ADD CONSTRAINT "analysis_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_sessions" ADD CONSTRAINT "analysis_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_sessions" ADD CONSTRAINT "analysis_sessions_stage_run_id_stage_runs_id_fk" FOREIGN KEY ("stage_run_id") REFERENCES "public"."stage_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_sessions" ADD CONSTRAINT "analysis_sessions_finish_requested_by_users_id_fk" FOREIGN KEY ("finish_requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_batches" ADD CONSTRAINT "question_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_batches" ADD CONSTRAINT "question_batches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_batches" ADD CONSTRAINT "question_batches_session_id_analysis_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_batches" ADD CONSTRAINT "question_batches_stage_run_id_stage_runs_id_fk" FOREIGN KEY ("stage_run_id") REFERENCES "public"."stage_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_batches" ADD CONSTRAINT "question_batches_round_id_analysis_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."analysis_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_answers_revision_uq" ON "analysis_answers" USING btree ("question_id","revision_no");--> statement-breakpoint
CREATE INDEX "analysis_answers_submission_idx" ON "analysis_answers" USING btree ("submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_contradictions_key_uq" ON "analysis_contradictions" USING btree ("session_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_questions_ordinal_uq" ON "analysis_questions" USING btree ("session_id","ordinal");--> statement-breakpoint
CREATE INDEX "analysis_questions_batch_idx" ON "analysis_questions" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "analysis_questions_status_idx" ON "analysis_questions" USING btree ("session_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_rounds_number_uq" ON "analysis_rounds" USING btree ("session_id","round_no");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_sessions_stage_uq" ON "analysis_sessions" USING btree ("stage_run_id");--> statement-breakpoint
CREATE INDEX "analysis_sessions_project_idx" ON "analysis_sessions" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "question_batches_number_uq" ON "question_batches" USING btree ("session_id","batch_no");--> statement-breakpoint
CREATE UNIQUE INDEX "question_batches_round_uq" ON "question_batches" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "question_batches_project_idx" ON "question_batches" USING btree ("workspace_id","project_id");