CREATE TYPE "public"."app_error_category" AS ENUM('database', 'validation', 'permission', 'network', 'provider', 'not_found', 'ui', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."app_error_source" AS ENUM('server', 'client');--> statement-breakpoint
CREATE TYPE "public"."app_error_status" AS ENUM('new', 'seen', 'fixed', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."smart_conversation_kind" AS ENUM('walker', 'error');--> statement-breakpoint
CREATE TYPE "public"."smart_message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."smart_message_status" AS ENUM('done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."walker_issue_status" AS ENUM('open', 'in_progress', 'fixed', 'wont_fix');--> statement-breakpoint
CREATE TABLE "app_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source" "app_error_source" NOT NULL,
	"category" "app_error_category" NOT NULL,
	"fingerprint" text NOT NULL,
	"message" text NOT NULL,
	"status" "app_error_status" DEFAULT 'new' NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"http_method" text,
	"route" text,
	"http_status" integer,
	"page" text,
	"project_id" uuid,
	"correlation_id" uuid,
	"stack" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smart_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "smart_conversation_kind" NOT NULL,
	"project_id" uuid,
	"error_id" uuid,
	"route" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smart_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "smart_message_role" NOT NULL,
	"content" text NOT NULL,
	"status" "smart_message_status" DEFAULT 'done' NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"invocation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "walker_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" "walker_issue_status" DEFAULT 'open' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_message_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_errors" ADD CONSTRAINT "app_errors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_conversations" ADD CONSTRAINT "smart_conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_conversations" ADD CONSTRAINT "smart_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_messages" ADD CONSTRAINT "smart_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_messages" ADD CONSTRAINT "smart_messages_conversation_id_smart_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."smart_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_messages" ADD CONSTRAINT "smart_messages_invocation_id_model_invocations_id_fk" FOREIGN KEY ("invocation_id") REFERENCES "public"."model_invocations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walker_issues" ADD CONSTRAINT "walker_issues_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walker_issues" ADD CONSTRAINT "walker_issues_source_message_id_smart_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."smart_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walker_issues" ADD CONSTRAINT "walker_issues_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_errors_fingerprint_uq" ON "app_errors" USING btree ("workspace_id","fingerprint");--> statement-breakpoint
CREATE INDEX "app_errors_status_seen_idx" ON "app_errors" USING btree ("workspace_id","status","last_seen_at");--> statement-breakpoint
CREATE INDEX "app_errors_seen_idx" ON "app_errors" USING btree ("workspace_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "smart_conversations_user_idx" ON "smart_conversations" USING btree ("workspace_id","user_id","updated_at");--> statement-breakpoint
CREATE INDEX "smart_messages_conversation_idx" ON "smart_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "walker_issues_message_uq" ON "walker_issues" USING btree ("workspace_id","source_message_id");--> statement-breakpoint
CREATE INDEX "walker_issues_status_idx" ON "walker_issues" USING btree ("workspace_id","status","created_at");