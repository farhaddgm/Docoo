CREATE TABLE "document_writings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"phase" text DEFAULT 'preparing' NOT NULL,
	"level" integer NOT NULL,
	"template_version" text NOT NULL,
	"language" "locale" NOT NULL,
	"notes" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"base_version_id" uuid,
	"result_version_id" uuid,
	"agent_definition_version_id" uuid,
	"temporal_workflow_id" text NOT NULL,
	"plan" jsonb,
	"parts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"bibliography" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"report" jsonb,
	"block_code" text,
	"error_code" text,
	"requested_by" uuid,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD COLUMN "writing_id" uuid;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "writing_id" uuid;--> statement-breakpoint
ALTER TABLE "model_invocations" ADD COLUMN "writing_id" uuid;--> statement-breakpoint
ALTER TABLE "document_writings" ADD CONSTRAINT "document_writings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_writings" ADD CONSTRAINT "document_writings_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_writings" ADD CONSTRAINT "document_writings_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_writings_document_idx" ON "document_writings" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "document_writings_project_idx" ON "document_writings" USING btree ("workspace_id","project_id","created_at");