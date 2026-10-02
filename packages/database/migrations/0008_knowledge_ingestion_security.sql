-- Tenant isolation, append-only history, search columns and grants for the knowledge and
-- ingestion tables of 0007 (ING-*, KNO-*).
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
ALTER TABLE source_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_assets FORCE ROW LEVEL SECURITY;
ALTER TABLE source_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE source_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_segments FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_items FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_scopes FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims FORCE ROW LEVEL SECURITY;
ALTER TABLE citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE citations FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_overrides FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_conflicts FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks FORCE ROW LEVEL SECURITY;
ALTER TABLE retrieval_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE retrieval_snapshots FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Mutable tenant tables.
CREATE POLICY source_assets_tenant_isolation ON source_assets
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY source_versions_tenant_isolation ON source_versions
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY knowledge_items_tenant_isolation ON knowledge_items
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY knowledge_scopes_tenant_isolation ON knowledge_scopes
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY knowledge_versions_tenant_isolation ON knowledge_versions
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY knowledge_conflicts_tenant_isolation ON knowledge_conflicts
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
--> statement-breakpoint
-- Append-only tenant tables: read and insert within the workspace only.
CREATE POLICY source_segments_read ON source_segments
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY source_segments_append ON source_segments
  FOR INSERT WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY claims_read ON claims
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY claims_append ON claims
  FOR INSERT WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY citations_read ON citations
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY citations_append ON citations
  FOR INSERT WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY knowledge_chunks_read ON knowledge_chunks
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY knowledge_chunks_append ON knowledge_chunks
  FOR INSERT WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY audit_reviews_read ON audit_reviews
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY audit_reviews_append ON audit_reviews
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
CREATE POLICY audit_overrides_read ON audit_overrides
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY audit_overrides_append ON audit_overrides
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND created_by = app.current_actor_id()
  );
CREATE POLICY retrieval_snapshots_read ON retrieval_snapshots
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY retrieval_snapshots_append ON retrieval_snapshots
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
--> statement-breakpoint
-- Every child row must belong to a parent in the same workspace.
ALTER TABLE source_assets ADD CONSTRAINT source_assets_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE source_versions ADD CONSTRAINT source_versions_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE knowledge_items ADD CONSTRAINT knowledge_items_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE knowledge_versions ADD CONSTRAINT knowledge_versions_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE claims ADD CONSTRAINT claims_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE audit_reviews ADD CONSTRAINT audit_reviews_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE source_versions
  ADD CONSTRAINT source_versions_asset_workspace_fk
  FOREIGN KEY (asset_id, workspace_id) REFERENCES source_assets (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE source_segments
  ADD CONSTRAINT source_segments_version_workspace_fk
  FOREIGN KEY (source_version_id, workspace_id) REFERENCES source_versions (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE knowledge_scopes
  ADD CONSTRAINT knowledge_scopes_item_workspace_fk
  FOREIGN KEY (item_id, workspace_id) REFERENCES knowledge_items (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE knowledge_versions
  ADD CONSTRAINT knowledge_versions_item_workspace_fk
  FOREIGN KEY (item_id, workspace_id) REFERENCES knowledge_items (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE claims
  ADD CONSTRAINT claims_version_workspace_fk
  FOREIGN KEY (knowledge_version_id, workspace_id) REFERENCES knowledge_versions (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE citations
  ADD CONSTRAINT citations_claim_workspace_fk
  FOREIGN KEY (claim_id, workspace_id) REFERENCES claims (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE audit_reviews
  ADD CONSTRAINT audit_reviews_version_workspace_fk
  FOREIGN KEY (knowledge_version_id, workspace_id) REFERENCES knowledge_versions (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE audit_overrides
  ADD CONSTRAINT audit_overrides_review_workspace_fk
  FOREIGN KEY (review_id, workspace_id) REFERENCES audit_reviews (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE audit_overrides
  ADD CONSTRAINT audit_overrides_version_workspace_fk
  FOREIGN KEY (knowledge_version_id, workspace_id) REFERENCES knowledge_versions (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE knowledge_conflicts
  ADD CONSTRAINT knowledge_conflicts_a_workspace_fk
  FOREIGN KEY (claim_a_id, workspace_id) REFERENCES claims (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE knowledge_conflicts
  ADD CONSTRAINT knowledge_conflicts_b_workspace_fk
  FOREIGN KEY (claim_b_id, workspace_id) REFERENCES claims (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE knowledge_chunks
  ADD CONSTRAINT knowledge_chunks_version_workspace_fk
  FOREIGN KEY (knowledge_version_id, workspace_id) REFERENCES knowledge_versions (id, workspace_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE source_versions
  ADD CONSTRAINT source_versions_sha256_format CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE source_versions
  ADD CONSTRAINT source_versions_declared_sha256_format CHECK (declared_sha256 IS NULL OR declared_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE source_versions
  ADD CONSTRAINT source_versions_positive_version CHECK (version_no > 0);
ALTER TABLE knowledge_versions
  ADD CONSTRAINT knowledge_versions_positive_version CHECK (version_no > 0);
ALTER TABLE knowledge_versions
  ADD CONSTRAINT knowledge_versions_validity CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from);
ALTER TABLE knowledge_conflicts
  ADD CONSTRAINT knowledge_conflicts_distinct CHECK (claim_a_id < claim_b_id);
ALTER TABLE knowledge_conflicts
  ADD CONSTRAINT knowledge_conflicts_resolution CHECK (
    (status = 'open' AND resolved_at IS NULL) OR (status = 'resolved' AND resolved_at IS NOT NULL AND resolution IS NOT NULL)
  );
-- An override needs a meaningful reason of at least 20 characters (03-knowledge-and-brain §10).
ALTER TABLE audit_overrides
  ADD CONSTRAINT audit_overrides_reason_length CHECK (char_length(btrim(reason)) >= 20);
ALTER TABLE audit_reviews
  ADD CONSTRAINT audit_reviews_overall_range CHECK (overall >= 0 AND overall <= 100);
--> statement-breakpoint
-- Lexical and vector search columns. The embedding dimension is pinned by the model id.
ALTER TABLE knowledge_chunks
  ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', search_text)) STORED;
ALTER TABLE knowledge_chunks ADD COLUMN embedding vector(256) NOT NULL;
CREATE INDEX knowledge_chunks_tsv_idx ON knowledge_chunks USING gin (tsv);
CREATE INDEX knowledge_chunks_embedding_idx ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
--> statement-breakpoint
CREATE TRIGGER source_segments_append_only
  BEFORE UPDATE OR DELETE ON source_segments
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER claims_append_only
  BEFORE UPDATE OR DELETE ON claims
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER citations_append_only
  BEFORE UPDATE OR DELETE ON citations
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER audit_reviews_append_only
  BEFORE UPDATE OR DELETE ON audit_reviews
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER audit_overrides_append_only
  BEFORE UPDATE OR DELETE ON audit_overrides
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER knowledge_chunks_append_only
  BEFORE UPDATE OR DELETE ON knowledge_chunks
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER retrieval_snapshots_append_only
  BEFORE UPDATE OR DELETE ON retrieval_snapshots
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER source_assets_touch_updated_at BEFORE UPDATE ON source_assets
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER source_versions_touch_updated_at BEFORE UPDATE ON source_versions
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER knowledge_items_touch_updated_at BEFORE UPDATE ON knowledge_items
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER knowledge_versions_touch_updated_at BEFORE UPDATE ON knowledge_versions
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
--> statement-breakpoint
-- Content of a knowledge version is immutable once written; a change is a new version.
CREATE OR REPLACE FUNCTION app.reject_knowledge_content_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content
     OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
     OR NEW.item_id IS DISTINCT FROM OLD.item_id
     OR NEW.version_no IS DISTINCT FROM OLD.version_no
     OR NEW.provenance IS DISTINCT FROM OLD.provenance THEN
    RAISE EXCEPTION 'knowledge version content is immutable; create a new version';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER knowledge_versions_content_immutable
  BEFORE UPDATE ON knowledge_versions
  FOR EACH ROW EXECUTE FUNCTION app.reject_knowledge_content_change();
--> statement-breakpoint
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
  ('ingestion.max_file_mb', '{"type":"integer","minimum":1,"maximum":100}', '100',
   '{workspace,topic,project}', false,
   'حداکثر حجم هر فایل ورودی به مگابایت',
   'Maximum size of one uploaded file in MB'),
  ('ingestion.url_policy', '{"type":"string","enum":["deny","allowlist","public"]}', '"allowlist"',
   '{workspace,topic,project}', false,
   'سیاست دریافت URL: ممنوع، فقط allowlist یا هر نشانی عمومی',
   'URL fetch policy: deny, allowlist only, or any public address'),
  ('ingestion.url_allowlist', '{"type":"array","items":{"type":"string","pattern":"^[a-z0-9.-]+$"},"maxItems":200}', '[]',
   '{workspace,topic,project}', false,
   'دامنه‌های مجاز برای دریافت URL (زیر‌دامنه‌ها هم مجازند)',
   'Domains allowed for URL fetch (subdomains included)');
--> statement-breakpoint
REVOKE ALL ON source_assets, source_versions, source_segments, knowledge_items, knowledge_scopes,
  knowledge_versions, claims, citations, audit_reviews, audit_overrides, knowledge_conflicts,
  knowledge_chunks, retrieval_snapshots FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT, UPDATE ON source_assets, source_versions, knowledge_items, knowledge_versions,
  knowledge_conflicts TO docoo_app;
GRANT SELECT, INSERT, DELETE ON knowledge_scopes TO docoo_app;
GRANT SELECT, INSERT ON source_segments, claims, citations, audit_reviews, audit_overrides,
  knowledge_chunks, retrieval_snapshots TO docoo_app;
