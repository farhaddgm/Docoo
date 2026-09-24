CREATE TYPE "public"."locale" AS ENUM('fa', 'en');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('super_admin');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'active', 'paused', 'completed', 'archived', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'locked', 'disabled');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"reason" text,
	"before" jsonb,
	"after" jsonb,
	"correlation_id" uuid NOT NULL,
	"security_relevant" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" DEFAULT 'super_admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project_topics" (
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"priority" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_topics_project_id_topic_id_pk" PRIMARY KEY("project_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"initial_problem" text NOT NULL,
	"output_language" "locale" DEFAULT 'fa' NOT NULL,
	"status" "project_status" DEFAULT 'draft' NOT NULL,
	"current_stage" text DEFAULT 'analysis' NOT NULL,
	"pause_reason" text,
	"deleted_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	"version" text DEFAULT '1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_hash" text,
	"user_agent_hash" text
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"language" "locale" DEFAULT 'fa' NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"default_locale" "locale" DEFAULT 'fa' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_topics" ADD CONSTRAINT "project_topics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_topics" ADD CONSTRAINT "project_topics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_topics" ADD CONSTRAINT "project_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_workspace_time_idx" ON "audit_events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_correlation_idx" ON "audit_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_topics_priority_uq" ON "project_topics" USING btree ("project_id","priority");--> statement-breakpoint
CREATE INDEX "project_topics_workspace_idx" ON "project_topics" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workspace_code_uq" ON "projects" USING btree ("workspace_id",lower("code"));--> statement-breakpoint
CREATE INDEX "projects_workspace_status_idx" ON "projects" USING btree ("workspace_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_digest_uq" ON "sessions" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "sessions_user_active_idx" ON "sessions" USING btree ("user_id","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "topics_workspace_code_uq" ON "topics" USING btree ("workspace_id",lower("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "topics_workspace_title_uq" ON "topics" USING btree ("workspace_id",lower("title"));--> statement-breakpoint
CREATE INDEX "topics_workspace_state_idx" ON "topics" USING btree ("workspace_id","archived_at","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_code_uq" ON "workspaces" USING btree (lower("code"));