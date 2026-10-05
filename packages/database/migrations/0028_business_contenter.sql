CREATE TABLE "business_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"external_business_id" text NOT NULL,
	"version_no" integer NOT NULL,
	"name" text NOT NULL,
	"content_sha256" text NOT NULL,
	"content" jsonb NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"exported_at" timestamp with time zone,
	"fetched_by" uuid,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contenter_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"api_url" text NOT NULL,
	"web_url" text,
	"status" text DEFAULT 'unconfigured' NOT NULL,
	"secret_version" integer DEFAULT 0 NOT NULL,
	"ciphertext" text,
	"iv" text,
	"tag" text,
	"wrapped_key" text,
	"wrap_iv" text,
	"wrap_tag" text,
	"key_id" text,
	"fingerprint" text,
	"last_checked_at" timestamp with time zone,
	"last_latency_ms" integer,
	"last_error" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_businesses" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"external_business_id" text NOT NULL,
	"name" text NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"linked_by" uuid,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone,
	"sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_writings" ADD COLUMN "business_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "model_invocations" ADD COLUMN "business_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "business_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "business_snapshots" ADD CONSTRAINT "business_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_snapshots" ADD CONSTRAINT "business_snapshots_fetched_by_users_id_fk" FOREIGN KEY ("fetched_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contenter_connections" ADD CONSTRAINT "contenter_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contenter_connections" ADD CONSTRAINT "contenter_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_businesses" ADD CONSTRAINT "project_businesses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_businesses" ADD CONSTRAINT "project_businesses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_businesses" ADD CONSTRAINT "project_businesses_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_snapshots_version_uq" ON "business_snapshots" USING btree ("workspace_id","external_business_id","version_no");--> statement-breakpoint
CREATE INDEX "business_snapshots_business_idx" ON "business_snapshots" USING btree ("workspace_id","external_business_id","fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contenter_connections_workspace_uq" ON "contenter_connections" USING btree ("workspace_id");