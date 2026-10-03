CREATE TYPE "public"."brain_report_scope" AS ENUM('project', 'workspace');--> statement-breakpoint
CREATE TABLE "brain_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scope" "brain_report_scope" NOT NULL,
	"project_id" uuid,
	"charter_version" text NOT NULL,
	"period_from" timestamp with time zone,
	"period_to" timestamp with time zone NOT NULL,
	"summary" jsonb NOT NULL,
	"deviations" jsonb NOT NULL,
	"recommendations" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brain_reports" ADD CONSTRAINT "brain_reports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_reports" ADD CONSTRAINT "brain_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_reports" ADD CONSTRAINT "brain_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brain_reports_latest_idx" ON "brain_reports" USING btree ("workspace_id","scope","created_at");--> statement-breakpoint
CREATE INDEX "brain_reports_project_idx" ON "brain_reports" USING btree ("project_id","created_at");