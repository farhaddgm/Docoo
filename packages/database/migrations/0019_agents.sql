CREATE TYPE "public"."agent_role" AS ENUM('analyst', 'researcher', 'ideator', 'documenter', 'evaluator', 'brain');--> statement-breakpoint
CREATE TABLE "agent_definition_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"role" "agent_role" NOT NULL,
	"sequence" integer NOT NULL,
	"principles" jsonb NOT NULL,
	"duties" jsonb NOT NULL,
	"prompt_template" text NOT NULL,
	"tools" jsonb NOT NULL,
	"model_policy" jsonb,
	"output_schema_id" text NOT NULL,
	"changed_sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"base_version_id" uuid,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_roles" (
	"workspace_id" uuid NOT NULL,
	"role" "agent_role" NOT NULL,
	"active_version_id" uuid NOT NULL,
	"activated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_roles_workspace_id_role_pk" PRIMARY KEY("workspace_id","role")
);
--> statement-breakpoint
CREATE TABLE "project_agent_profiles" (
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"role" "agent_role" NOT NULL,
	"definition_version_id" uuid NOT NULL,
	"customized" boolean DEFAULT false NOT NULL,
	"pinned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_agent_profiles_project_id_role_pk" PRIMARY KEY("project_id","role")
);
--> statement-breakpoint
ALTER TABLE "model_invocations" ADD COLUMN "agent_definition_version_id" uuid;--> statement-breakpoint
ALTER TABLE "model_invocations" ADD COLUMN "prompt_sha256" text;--> statement-breakpoint
ALTER TABLE "stage_attempts" ADD COLUMN "agent_definition_version_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_definition_versions" ADD CONSTRAINT "agent_definition_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_definition_versions" ADD CONSTRAINT "agent_definition_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_definition_versions" ADD CONSTRAINT "agent_definition_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_activated_by_users_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_agent_profiles" ADD CONSTRAINT "project_agent_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_agent_profiles" ADD CONSTRAINT "project_agent_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_agent_profiles" ADD CONSTRAINT "project_agent_profiles_pinned_by_users_id_fk" FOREIGN KEY ("pinned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_definition_versions_default_uq" ON "agent_definition_versions" USING btree ("workspace_id","role","sequence") WHERE "agent_definition_versions"."project_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_definition_versions_project_uq" ON "agent_definition_versions" USING btree ("project_id","role","sequence") WHERE "agent_definition_versions"."project_id" is not null;--> statement-breakpoint
CREATE INDEX "agent_definition_versions_role_idx" ON "agent_definition_versions" USING btree ("workspace_id","role","created_at");