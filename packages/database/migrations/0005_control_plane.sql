CREATE TYPE "public"."audit_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."config_scope" AS ENUM('workspace', 'topic', 'project');--> statement-breakpoint
ALTER TYPE "public"."auth_event_action" ADD VALUE 'login.locked';--> statement-breakpoint
ALTER TYPE "public"."auth_event_action" ADD VALUE 'password.changed';--> statement-breakpoint
ALTER TYPE "public"."auth_event_action" ADD VALUE 'password.reset_requested';--> statement-breakpoint
ALTER TYPE "public"."auth_event_action" ADD VALUE 'password.reset_completed';--> statement-breakpoint
ALTER TYPE "public"."auth_event_action" ADD VALUE 'sessions.revoked';--> statement-breakpoint
CREATE TABLE "config_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"setting_key" text NOT NULL,
	"scope_type" "config_scope" NOT NULL,
	"scope_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"value" jsonb,
	"cleared" boolean DEFAULT false NOT NULL,
	"reason" text NOT NULL,
	"restored_from_sequence" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"subject_type" "config_scope" NOT NULL,
	"subject_id" uuid NOT NULL,
	"resolved" jsonb NOT NULL,
	"source_map" jsonb NOT NULL,
	"hash" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "setting_definitions" (
	"key" text PRIMARY KEY NOT NULL,
	"value_schema" jsonb NOT NULL,
	"default_value" jsonb NOT NULL,
	"allowed_scopes" "config_scope"[] NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"description_fa" text NOT NULL,
	"description_en" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"language" "locale" NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "severity" "audit_severity" DEFAULT 'info' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_topics" ADD COLUMN "conflict_instruction" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "previous_status" "project_status";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "config_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "cloned_from_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_login_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "config_assignments" ADD CONSTRAINT "config_assignments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_assignments" ADD CONSTRAINT "config_assignments_setting_key_setting_definitions_key_fk" FOREIGN KEY ("setting_key") REFERENCES "public"."setting_definitions"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_assignments" ADD CONSTRAINT "config_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_snapshots" ADD CONSTRAINT "config_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_snapshots" ADD CONSTRAINT "config_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_versions" ADD CONSTRAINT "topic_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_versions" ADD CONSTRAINT "topic_versions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_versions" ADD CONSTRAINT "topic_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "config_assignments_sequence_uq" ON "config_assignments" USING btree ("workspace_id","setting_key","scope_type","scope_id","sequence");--> statement-breakpoint
CREATE INDEX "config_assignments_scope_idx" ON "config_assignments" USING btree ("workspace_id","scope_type","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "config_snapshots_subject_hash_uq" ON "config_snapshots" USING btree ("workspace_id","subject_type","subject_id","hash");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_digest_uq" ON "password_reset_tokens" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id","consumed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_versions_topic_version_uq" ON "topic_versions" USING btree ("topic_id","version");--> statement-breakpoint
CREATE INDEX "topic_versions_workspace_idx" ON "topic_versions" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_project_time_idx" ON "audit_events" USING btree ("workspace_id","project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("workspace_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "project_topics_topic_idx" ON "project_topics" USING btree ("topic_id");