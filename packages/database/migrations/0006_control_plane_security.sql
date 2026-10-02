-- Tenant isolation, append-only guarantees and grants for the control-plane tables of 0005.
ALTER TABLE topic_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE topic_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE config_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE config_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_snapshots FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY topic_versions_read ON topic_versions
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY topic_versions_append ON topic_versions
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
CREATE POLICY config_assignments_read ON config_assignments
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY config_assignments_append ON config_assignments
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
CREATE POLICY config_snapshots_read ON config_snapshots
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY config_snapshots_append ON config_snapshots
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
--> statement-breakpoint
-- A version row must belong to a topic of the same workspace.
ALTER TABLE topic_versions
  ADD CONSTRAINT topic_versions_topic_workspace_fk
  FOREIGN KEY (topic_id, workspace_id)
  REFERENCES topics (id, workspace_id)
  ON DELETE CASCADE;
ALTER TABLE config_assignments
  ADD CONSTRAINT config_assignments_sequence_positive CHECK (sequence > 0);
ALTER TABLE config_assignments
  ADD CONSTRAINT config_assignments_cleared_value CHECK (
    (cleared AND value IS NULL) OR (NOT cleared AND value IS NOT NULL)
  );
ALTER TABLE config_assignments
  ADD CONSTRAINT config_assignments_reason_present CHECK (length(btrim(reason)) > 0);
ALTER TABLE projects
  ADD CONSTRAINT projects_previous_status_not_deleted CHECK (previous_status IS DISTINCT FROM 'deleted');
--> statement-breakpoint
-- History is append-only. The retention purge of a soft-deleted, expired subject may delete
-- its history inside one transaction that sets app.retention_purge = 'on' (FR-AUD-005).
CREATE OR REPLACE FUNCTION app.reject_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.retention_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END
$$;
CREATE TRIGGER topic_versions_append_only
  BEFORE UPDATE OR DELETE ON topic_versions
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER config_assignments_append_only
  BEFORE UPDATE OR DELETE ON config_assignments
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER config_snapshots_append_only
  BEFORE UPDATE OR DELETE ON config_snapshots
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
--> statement-breakpoint
-- Existing topics get their first version so history starts complete.
INSERT INTO topic_versions (workspace_id, topic_id, version, code, title, description, language, created_by, created_at)
SELECT workspace_id, id, version, code, title, description, language, created_by, created_at
  FROM topics;
--> statement-breakpoint
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
  ('workflow.max_attempts_per_stage', '{"type":"integer","minimum":1,"maximum":10}', '3',
   '{workspace,topic,project}', false,
   'حداکثر تلاش هر مرحله پیش از توقف و ارجاع به ادمین',
   'Maximum attempts per stage before pausing for the administrator'),
  ('workflow.require_human_approval', '{"type":"boolean"}', 'true',
   '{workspace,project}', false,
   'نیاز به تأیید انسانی پیش از عبور از gate مراحل',
   'Require human approval before passing stage gates'),
  ('ai.max_cost_usd_per_run', '{"type":"number","minimum":0,"maximum":1000}', '20',
   '{workspace,project}', false,
   'سقف هزینهٔ provider برای هر اجرای پروژه به دلار',
   'Provider cost ceiling per project run in USD'),
  ('research.max_sources', '{"type":"integer","minimum":1,"maximum":200}', '30',
   '{workspace,topic,project}', false,
   'حداکثر تعداد منبع در تحقیق هر پروژه',
   'Maximum number of research sources per project'),
  ('knowledge.min_audit_score', '{"type":"number","minimum":0,"maximum":1}', '0.7',
   '{workspace,topic,project}', false,
   'حداقل امتیاز ممیزی Brain برای استفادهٔ دانش در بازیابی',
   'Minimum Brain audit score for knowledge to be retrievable'),
  ('document.default_template', '{"type":"string","enum":["brief","standard","detailed"]}', '"standard"',
   '{workspace,topic,project}', false,
   'قالب پیش‌فرض اسناد خروجی',
   'Default template for output documents');
--> statement-breakpoint
REVOKE ALL ON password_reset_tokens, setting_definitions, topic_versions, config_assignments, config_snapshots FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT, UPDATE ON password_reset_tokens TO docoo_app;
GRANT SELECT ON setting_definitions TO docoo_app;
GRANT SELECT, INSERT ON topic_versions, config_assignments, config_snapshots TO docoo_app;
