CREATE TYPE "public"."agent_tool_decision" AS ENUM('allowed', 'denied');--> statement-breakpoint
CREATE TABLE "agent_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"stage_run_id" uuid,
	"attempt_id" uuid,
	"role" "agent_role" NOT NULL,
	"agent_definition_version_id" uuid,
	"tool" text NOT NULL,
	"decision" "agent_tool_decision" NOT NULL,
	"input_sha256" text NOT NULL,
	"output_ref" jsonb,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"latency_ms" integer,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brain_reports" ADD COLUMN "evaluations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_tool_calls_attempt_idx" ON "agent_tool_calls" USING btree ("attempt_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_tool_calls_workspace_idx" ON "agent_tool_calls" USING btree ("workspace_id","tool","created_at");