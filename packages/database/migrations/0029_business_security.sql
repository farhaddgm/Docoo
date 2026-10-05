-- Tenant isolation, link integrity, append-only snapshots, value rules, grants and settings for
-- the Contenter connection, the business snapshots and the project links of 0028 (ADR-0021).
ALTER TABLE contenter_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE contenter_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE business_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE project_businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_businesses FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY contenter_connections_tenant_isolation ON contenter_connections
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY business_snapshots_read ON business_snapshots
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY business_snapshots_append ON business_snapshots
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (fetched_by IS NULL OR fetched_by = app.current_actor_id())
  );
CREATE POLICY project_businesses_tenant_isolation ON project_businesses
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
--> statement-breakpoint
ALTER TABLE business_snapshots ADD CONSTRAINT business_snapshots_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE project_businesses
  ADD CONSTRAINT project_businesses_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE project_businesses
  ADD CONSTRAINT project_businesses_snapshot_workspace_fk
  FOREIGN KEY (snapshot_id, workspace_id) REFERENCES business_snapshots (id, workspace_id);
-- What a run, a writing or a call read: snapshots are never deleted, so these never dangle.
ALTER TABLE workflow_runs
  ADD CONSTRAINT workflow_runs_business_snapshot_workspace_fk
  FOREIGN KEY (business_snapshot_id, workspace_id) REFERENCES business_snapshots (id, workspace_id);
ALTER TABLE document_writings
  ADD CONSTRAINT document_writings_business_snapshot_workspace_fk
  FOREIGN KEY (business_snapshot_id, workspace_id) REFERENCES business_snapshots (id, workspace_id);
ALTER TABLE model_invocations
  ADD CONSTRAINT model_invocations_business_snapshot_workspace_fk
  FOREIGN KEY (business_snapshot_id, workspace_id) REFERENCES business_snapshots (id, workspace_id);
--> statement-breakpoint
ALTER TABLE contenter_connections ADD CONSTRAINT contenter_connections_values CHECK (
  status IN ('unconfigured', 'healthy', 'unreachable', 'invalid')
  AND api_url ~ '^https?://[^[:space:]]+$' AND char_length(api_url) <= 500
  AND (web_url IS NULL OR (web_url ~ '^https?://[^[:space:]]+$' AND char_length(web_url) <= 500))
  AND secret_version >= 0
  -- A token is either completely sealed or completely absent.
  AND ((secret_version = 0 AND ciphertext IS NULL AND iv IS NULL AND tag IS NULL
        AND wrapped_key IS NULL AND wrap_iv IS NULL AND wrap_tag IS NULL AND key_id IS NULL
        AND fingerprint IS NULL)
    OR (secret_version > 0 AND ciphertext IS NOT NULL AND iv IS NOT NULL AND tag IS NOT NULL
        AND wrapped_key IS NOT NULL AND wrap_iv IS NOT NULL AND wrap_tag IS NOT NULL
        AND key_id IS NOT NULL AND fingerprint IS NOT NULL))
  AND (last_error IS NULL OR char_length(last_error) <= 300)
);
ALTER TABLE business_snapshots ADD CONSTRAINT business_snapshots_values CHECK (
  version_no >= 1
  AND content_sha256 ~ '^[0-9a-f]{64}$'
  AND jsonb_typeof(content) = 'object'
  AND jsonb_typeof(changes) = 'object'
  AND char_length(external_business_id) BETWEEN 1 AND 100
  AND char_length(name) <= 300
);
ALTER TABLE project_businesses ADD CONSTRAINT project_businesses_values CHECK (
  char_length(external_business_id) BETWEEN 1 AND 100
  AND char_length(name) <= 300
  AND (sync_error IS NULL OR char_length(sync_error) <= 300)
);
--> statement-breakpoint
-- A snapshot is a record of what Contenter said at that moment.
CREATE TRIGGER business_snapshots_append_only
  BEFORE UPDATE OR DELETE ON business_snapshots
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER contenter_connections_touch_updated_at BEFORE UPDATE ON contenter_connections
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER project_businesses_touch_updated_at BEFORE UPDATE ON project_businesses
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
--> statement-breakpoint
REVOKE ALL ON contenter_connections, business_snapshots, project_businesses FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON contenter_connections TO docoo_app;
GRANT SELECT, INSERT ON business_snapshots TO docoo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_businesses TO docoo_app;
--> statement-breakpoint
CREATE INDEX workflow_runs_business_snapshot_idx ON workflow_runs (business_snapshot_id)
  WHERE business_snapshot_id IS NOT NULL;
CREATE INDEX model_invocations_business_snapshot_idx ON model_invocations (business_snapshot_id)
  WHERE business_snapshot_id IS NOT NULL;
CREATE INDEX project_businesses_business_idx ON project_businesses (workspace_id, external_business_id);
--> statement-breakpoint
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
  ('business.prompt_budget_chars', '{"type":"integer","minimum":2000,"maximum":30000}', '12000',
   '{workspace,topic,project}', false,
   'سقف نویسهٔ اطلاعات کسب‌وکار در هر فراخوانی AI؛ هر ایجنت فقط بخش‌های لازم برای نقش خود را می‌گیرد و بخشی که جا نشود کنار می‌ماند',
   'Character budget of the business profile in each AI call; every agent gets only the sections its role needs, and what does not fit is left out'),
  ('business.sync_on_start', '{"type":"boolean"}', 'true',
   '{workspace,topic,project}', false,
   'پیش از شروع هر اجرا و هر نگارش سند، آخرین نسخهٔ کسب‌وکار از Contenter گرفته شود (اگر Contenter در دسترس نبود، آخرین نسخهٔ ذخیره‌شده به کار می‌رود)',
   'Fetch the latest version of the business from Contenter before every run and every document writing (when Contenter is unreachable the last saved version is used)'),
  ('business.required', '{"type":"boolean"}', 'false',
   '{workspace,topic,project}', false,
   'فعال‌سازی پروژه فقط وقتی ممکن باشد که به یک کسب‌وکار وصل شده باشد',
   'A project can only be activated when it is linked to a business');
