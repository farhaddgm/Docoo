CREATE TYPE "public"."audit_decision" AS ENUM('approved', 'needs_revision', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."confidentiality" AS ENUM('internal', 'confidential', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."conflict_severity" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."conflict_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."knowledge_source_type" AS ENUM('admin_provided', 'clue_guided', 'autonomous_research');--> statement-breakpoint
CREATE TYPE "public"."knowledge_status" AS ENUM('draft', 'pending', 'in_review', 'approved', 'rejected', 'needs_revision', 'expired', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."override_decision" AS ENUM('approve', 'reject');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('file', 'url', 'text');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('uploaded', 'quarantined', 'scanning', 'accepted', 'extracting', 'indexed', 'rejected', 'failed', 'partial');--> statement-breakpoint
CREATE TABLE "audit_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"knowledge_version_id" uuid NOT NULL,
	"decision" "override_decision" NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"knowledge_version_id" uuid NOT NULL,
	"rubric_version" text NOT NULL,
	"auditor" text NOT NULL,
	"scores" jsonb NOT NULL,
	"overall" real NOT NULL,
	"decision" "audit_decision" NOT NULL,
	"reasons" jsonb NOT NULL,
	"claim_results" jsonb NOT NULL,
	"critical_flags" text[] NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"source_ref" text,
	"title" text,
	"publisher" text,
	"author" text,
	"published_at" timestamp with time zone,
	"accessed_at" timestamp with time zone,
	"locator" text,
	"quote_digest" text,
	"complete" boolean NOT NULL,
	"missing_fields" text[] NOT NULL,
	"verification_status" text DEFAULT 'unverified' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"knowledge_version_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"normalized_text" text NOT NULL,
	"kind" text NOT NULL,
	"locator" jsonb NOT NULL,
	"source_segment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"knowledge_version_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"search_text" text NOT NULL,
	"embedding_model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"claim_a_id" uuid NOT NULL,
	"claim_b_id" uuid NOT NULL,
	"conflict_type" text NOT NULL,
	"severity" "conflict_severity" NOT NULL,
	"analysis" text NOT NULL,
	"status" "conflict_status" DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source_type" "knowledge_source_type" NOT NULL,
	"confidentiality" "confidentiality" DEFAULT 'internal' NOT NULL,
	"language" "locale" DEFAULT 'fa' NOT NULL,
	"current_version_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"scope_type" "config_scope" NOT NULL,
	"scope_id" uuid NOT NULL,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"status" "knowledge_status" DEFAULT 'draft' NOT NULL,
	"content" text NOT NULL,
	"content_sha256" text NOT NULL,
	"language" "locale" NOT NULL,
	"source_version_id" uuid,
	"provenance" jsonb NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"stale_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieval_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"topic_id" uuid,
	"role" text,
	"query" text NOT NULL,
	"filters" jsonb NOT NULL,
	"results" jsonb NOT NULL,
	"embedding_model" text NOT NULL,
	"hash" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "source_kind" NOT NULL,
	"title" text NOT NULL,
	"scope_type" "config_scope" NOT NULL,
	"scope_id" uuid NOT NULL,
	"current_version_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_version_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"locator" jsonb NOT NULL,
	"text" text NOT NULL,
	"confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"status" "source_status" DEFAULT 'uploaded' NOT NULL,
	"object_key" text,
	"filename" text,
	"declared_mime" text,
	"sniffed_mime" text,
	"declared_size" bigint,
	"size_bytes" bigint,
	"declared_sha256" text,
	"sha256" text,
	"origin_url" text,
	"scan" jsonb,
	"extraction" jsonb,
	"failure_code" text,
	"supersedes_version_id" uuid,
	"upload_expires_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_overrides" ADD CONSTRAINT "audit_overrides_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_overrides" ADD CONSTRAINT "audit_overrides_review_id_audit_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."audit_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_overrides" ADD CONSTRAINT "audit_overrides_knowledge_version_id_knowledge_versions_id_fk" FOREIGN KEY ("knowledge_version_id") REFERENCES "public"."knowledge_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_overrides" ADD CONSTRAINT "audit_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_reviews" ADD CONSTRAINT "audit_reviews_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_reviews" ADD CONSTRAINT "audit_reviews_knowledge_version_id_knowledge_versions_id_fk" FOREIGN KEY ("knowledge_version_id") REFERENCES "public"."knowledge_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_reviews" ADD CONSTRAINT "audit_reviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_knowledge_version_id_knowledge_versions_id_fk" FOREIGN KEY ("knowledge_version_id") REFERENCES "public"."knowledge_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_source_segment_id_source_segments_id_fk" FOREIGN KEY ("source_segment_id") REFERENCES "public"."source_segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_knowledge_version_id_knowledge_versions_id_fk" FOREIGN KEY ("knowledge_version_id") REFERENCES "public"."knowledge_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_conflicts" ADD CONSTRAINT "knowledge_conflicts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_conflicts" ADD CONSTRAINT "knowledge_conflicts_claim_a_id_claims_id_fk" FOREIGN KEY ("claim_a_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_conflicts" ADD CONSTRAINT "knowledge_conflicts_claim_b_id_claims_id_fk" FOREIGN KEY ("claim_b_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_conflicts" ADD CONSTRAINT "knowledge_conflicts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_scopes" ADD CONSTRAINT "knowledge_scopes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_scopes" ADD CONSTRAINT "knowledge_scopes_item_id_knowledge_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_versions" ADD CONSTRAINT "knowledge_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_versions" ADD CONSTRAINT "knowledge_versions_item_id_knowledge_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_versions" ADD CONSTRAINT "knowledge_versions_source_version_id_source_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."source_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_versions" ADD CONSTRAINT "knowledge_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_snapshots" ADD CONSTRAINT "retrieval_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_snapshots" ADD CONSTRAINT "retrieval_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_assets" ADD CONSTRAINT "source_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_assets" ADD CONSTRAINT "source_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_segments" ADD CONSTRAINT "source_segments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_segments" ADD CONSTRAINT "source_segments_source_version_id_source_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."source_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_versions" ADD CONSTRAINT "source_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_versions" ADD CONSTRAINT "source_versions_asset_id_source_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."source_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_versions" ADD CONSTRAINT "source_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_overrides_version_idx" ON "audit_overrides" USING btree ("knowledge_version_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_reviews_version_idx" ON "audit_reviews" USING btree ("knowledge_version_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_reviews_workspace_idx" ON "audit_reviews" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "citations_claim_idx" ON "citations" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "citations_workspace_idx" ON "citations" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_version_ordinal_uq" ON "claims" USING btree ("knowledge_version_id","ordinal");--> statement-breakpoint
CREATE INDEX "claims_workspace_idx" ON "claims" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_version_ordinal_uq" ON "knowledge_chunks" USING btree ("knowledge_version_id","ordinal");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_workspace_idx" ON "knowledge_chunks" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_conflicts_pair_uq" ON "knowledge_conflicts" USING btree ("claim_a_id","claim_b_id");--> statement-breakpoint
CREATE INDEX "knowledge_conflicts_workspace_status_idx" ON "knowledge_conflicts" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_items_workspace_idx" ON "knowledge_items" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_scopes_uq" ON "knowledge_scopes" USING btree ("item_id","scope_type","scope_id",coalesce("role", ''));--> statement-breakpoint
CREATE INDEX "knowledge_scopes_lookup_idx" ON "knowledge_scopes" USING btree ("workspace_id","scope_type","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_versions_item_version_uq" ON "knowledge_versions" USING btree ("item_id","version_no");--> statement-breakpoint
CREATE INDEX "knowledge_versions_workspace_status_idx" ON "knowledge_versions" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_versions_source_idx" ON "knowledge_versions" USING btree ("source_version_id");--> statement-breakpoint
CREATE INDEX "retrieval_snapshots_workspace_idx" ON "retrieval_snapshots" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "source_assets_workspace_idx" ON "source_assets" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "source_assets_scope_idx" ON "source_assets" USING btree ("workspace_id","scope_type","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_segments_version_ordinal_uq" ON "source_segments" USING btree ("source_version_id","ordinal");--> statement-breakpoint
CREATE INDEX "source_segments_workspace_idx" ON "source_segments" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_versions_asset_version_uq" ON "source_versions" USING btree ("asset_id","version_no");--> statement-breakpoint
CREATE INDEX "source_versions_workspace_status_idx" ON "source_versions" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "source_versions_sha_idx" ON "source_versions" USING btree ("workspace_id","sha256");