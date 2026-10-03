CREATE TYPE "public"."attempt_status" AS ENUM('created', 'dispatched', 'executing', 'succeeded', 'incomplete', 'transient_failed', 'scheduled_retry', 'permanent_failed');--> statement-breakpoint
CREATE TYPE "public"."gate_status" AS ENUM('not_required', 'pending', 'approved', 'rejected', 'overridden', 'expired');--> statement-breakpoint
CREATE TYPE "public"."human_task_status" AS ENUM('pending', 'resolved', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."invocation_status" AS ENUM('succeeded', 'transient_failed', 'permanent_failed');--> statement-breakpoint
CREATE TYPE "public"."provider_kind" AS ENUM('openai', 'gemini', 'anthropic', 'fake');--> statement-breakpoint
CREATE TYPE "public"."provider_status" AS ENUM('unconfigured', 'configured', 'checking', 'healthy', 'invalid', 'degraded', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."review_action" AS ENUM('approve', 'reject', 'edit', 'comment');--> statement-breakpoint
CREATE TYPE "public"."stage_kind" AS ENUM('analysis', 'research', 'ideation', 'documentation', 'evaluation');--> statement-breakpoint
CREATE TYPE "public"."stage_status" AS ENUM('pending', 'ready', 'running', 'waiting_for_human', 'retrying', 'completed', 'rejected', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workflow_status" AS ENUM('starting', 'running', 'paused', 'waiting_for_human', 'completed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TABLE "command_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"command" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gate_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"stage_run_id" uuid NOT NULL,
	"output_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"status" "gate_status" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "human_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"stage_run_id" uuid,
	"kind" text NOT NULL,
	"status" "human_task_status" DEFAULT 'pending' NOT NULL,
	"title" text NOT NULL,
	"payload" jsonb NOT NULL,
	"resolution" jsonb,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_catalog_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"models" jsonb NOT NULL,
	"model_count" integer NOT NULL,
	"hash" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid,
	"project_id" uuid,
	"stage_run_id" uuid,
	"attempt_id" uuid,
	"provider" "provider_kind" NOT NULL,
	"model" text NOT NULL,
	"purpose" text NOT NULL,
	"status" "invocation_status" NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer,
	"cached_input_tokens" integer,
	"latency_ms" integer,
	"finish_reason" text,
	"raw_finish_reason" text,
	"cost_usd" real,
	"price_id" uuid,
	"provider_request_id" text,
	"error_code" text,
	"retry_no" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" "provider_kind" NOT NULL,
	"model" text NOT NULL,
	"input_per_million" real NOT NULL,
	"output_per_million" real NOT NULL,
	"cached_input_per_million" real,
	"reasoning_per_million" real,
	"effective_from" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" "provider_kind" NOT NULL,
	"name" text NOT NULL,
	"base_url" text,
	"status" "provider_status" DEFAULT 'unconfigured' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_latency_ms" integer,
	"last_error" text,
	"current_secret_version" integer DEFAULT 0 NOT NULL,
	"store_content" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"secret_version" integer NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"tag" text NOT NULL,
	"wrapped_key" text NOT NULL,
	"wrap_iv" text NOT NULL,
	"wrap_tag" text NOT NULL,
	"key_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"stage_run_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "attempt_status" DEFAULT 'created' NOT NULL,
	"retry_of" uuid,
	"provider_retries" integer DEFAULT 0 NOT NULL,
	"output_id" uuid,
	"feedback" text,
	"error_code" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"stage_run_id" uuid NOT NULL,
	"attempt_id" uuid,
	"version_no" integer NOT NULL,
	"content" jsonb NOT NULL,
	"content_sha256" text NOT NULL,
	"origin" text NOT NULL,
	"edited_from_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"stage_run_id" uuid NOT NULL,
	"output_id" uuid NOT NULL,
	"action" "review_action" NOT NULL,
	"comment" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"stage" "stage_kind" NOT NULL,
	"sequence" integer NOT NULL,
	"status" "stage_status" DEFAULT 'pending' NOT NULL,
	"gate_mode" text DEFAULT 'manual' NOT NULL,
	"attempt_limit" integer DEFAULT 10 NOT NULL,
	"attempts_used" integer DEFAULT 0 NOT NULL,
	"latest_output_id" uuid,
	"passed_by_decision" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"run_no" integer NOT NULL,
	"temporal_workflow_id" text NOT NULL,
	"status" "workflow_status" DEFAULT 'starting' NOT NULL,
	"current_stage" "stage_kind",
	"config_snapshot_id" uuid,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "command_receipts" ADD CONSTRAINT "command_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_receipts" ADD CONSTRAINT "command_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_decisions" ADD CONSTRAINT "gate_decisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_decisions" ADD CONSTRAINT "gate_decisions_stage_run_id_stage_runs_id_fk" FOREIGN KEY ("stage_run_id") REFERENCES "public"."stage_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_decisions" ADD CONSTRAINT "gate_decisions_output_id_stage_outputs_id_fk" FOREIGN KEY ("output_id") REFERENCES "public"."stage_outputs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_decisions" ADD CONSTRAINT "gate_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_tasks" ADD CONSTRAINT "human_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_tasks" ADD CONSTRAINT "human_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_tasks" ADD CONSTRAINT "human_tasks_stage_run_id_stage_runs_id_fk" FOREIGN KEY ("stage_run_id") REFERENCES "public"."stage_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_tasks" ADD CONSTRAINT "human_tasks_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_catalog_snapshots" ADD CONSTRAINT "model_catalog_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_catalog_snapshots" ADD CONSTRAINT "model_catalog_snapshots_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_catalog_snapshots" ADD CONSTRAINT "model_catalog_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_invocations" ADD CONSTRAINT "model_invocations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_invocations" ADD CONSTRAINT "model_invocations_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_prices" ADD CONSTRAINT "model_prices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_prices" ADD CONSTRAINT "model_prices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_secrets" ADD CONSTRAINT "provider_secrets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_secrets" ADD CONSTRAINT "provider_secrets_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_secrets" ADD CONSTRAINT "provider_secrets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_attempts" ADD CONSTRAINT "stage_attempts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_attempts" ADD CONSTRAINT "stage_attempts_stage_run_id_stage_runs_id_fk" FOREIGN KEY ("stage_run_id") REFERENCES "public"."stage_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_outputs" ADD CONSTRAINT "stage_outputs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_outputs" ADD CONSTRAINT "stage_outputs_stage_run_id_stage_runs_id_fk" FOREIGN KEY ("stage_run_id") REFERENCES "public"."stage_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_outputs" ADD CONSTRAINT "stage_outputs_attempt_id_stage_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."stage_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_outputs" ADD CONSTRAINT "stage_outputs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_reviews" ADD CONSTRAINT "stage_reviews_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_reviews" ADD CONSTRAINT "stage_reviews_stage_run_id_stage_runs_id_fk" FOREIGN KEY ("stage_run_id") REFERENCES "public"."stage_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_reviews" ADD CONSTRAINT "stage_reviews_output_id_stage_outputs_id_fk" FOREIGN KEY ("output_id") REFERENCES "public"."stage_outputs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_reviews" ADD CONSTRAINT "stage_reviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_runs" ADD CONSTRAINT "stage_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_runs" ADD CONSTRAINT "stage_runs_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_runs" ADD CONSTRAINT "stage_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "command_receipts_key_uq" ON "command_receipts" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "gate_decisions_stage_idx" ON "gate_decisions" USING btree ("stage_run_id","status");--> statement-breakpoint
CREATE INDEX "human_tasks_workspace_status_idx" ON "human_tasks" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX "model_catalog_snapshots_connection_idx" ON "model_catalog_snapshots" USING btree ("connection_id","created_at");--> statement-breakpoint
CREATE INDEX "model_invocations_project_idx" ON "model_invocations" USING btree ("workspace_id","project_id","created_at");--> statement-breakpoint
CREATE INDEX "model_invocations_connection_idx" ON "model_invocations" USING btree ("connection_id","created_at");--> statement-breakpoint
CREATE INDEX "model_prices_lookup_idx" ON "model_prices" USING btree ("workspace_id","provider","model","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_connections_name_uq" ON "provider_connections" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "provider_secrets_version_uq" ON "provider_secrets" USING btree ("connection_id","secret_version");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_attempts_number_uq" ON "stage_attempts" USING btree ("stage_run_id","attempt_no");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_attempts_idempotency_uq" ON "stage_attempts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_outputs_version_uq" ON "stage_outputs" USING btree ("stage_run_id","version_no");--> statement-breakpoint
CREATE INDEX "stage_reviews_stage_idx" ON "stage_reviews" USING btree ("stage_run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_runs_run_stage_uq" ON "stage_runs" USING btree ("run_id","stage");--> statement-breakpoint
CREATE INDEX "stage_runs_project_idx" ON "stage_runs" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_project_run_uq" ON "workflow_runs" USING btree ("project_id","run_no");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_temporal_uq" ON "workflow_runs" USING btree ("temporal_workflow_id");