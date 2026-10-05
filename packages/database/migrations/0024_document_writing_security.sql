-- Tenant isolation, link integrity, state rules, grants and settings for the documenter's
-- writing runs of 0023 (ADR-0019).
ALTER TABLE document_writings ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_writings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_writings_tenant_isolation ON document_writings
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
--> statement-breakpoint
ALTER TABLE document_writings ADD CONSTRAINT document_writings_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE document_writings
  ADD CONSTRAINT document_writings_document_workspace_fk
  FOREIGN KEY (document_id, workspace_id) REFERENCES documents (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE document_writings
  ADD CONSTRAINT document_writings_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE document_writings
  ADD CONSTRAINT document_writings_result_version_workspace_fk
  FOREIGN KEY (result_version_id, workspace_id) REFERENCES document_versions (id, workspace_id);
ALTER TABLE document_writings
  ADD CONSTRAINT document_writings_base_version_workspace_fk
  FOREIGN KEY (base_version_id, workspace_id) REFERENCES document_versions (id, workspace_id);
ALTER TABLE document_writings
  ADD CONSTRAINT document_writings_agent_version_workspace_fk
  FOREIGN KEY (agent_definition_version_id, workspace_id) REFERENCES agent_definition_versions (id, workspace_id);
-- A version names the writing that produced it. Both rows go away with the document, so the
-- reference needs no ON DELETE action (versions are append-only and cannot be set to null).
ALTER TABLE document_versions
  ADD CONSTRAINT document_versions_writing_workspace_fk
  FOREIGN KEY (writing_id, workspace_id) REFERENCES document_writings (id, workspace_id);
--> statement-breakpoint
ALTER TABLE document_writings ADD CONSTRAINT document_writings_values CHECK (
  status IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled')
  AND phase IN ('preparing', 'outlining', 'writing', 'fitting', 'saving', 'done')
  AND level BETWEEN 1 AND 5
  AND jsonb_typeof(parts) = 'object'
  AND jsonb_typeof(bibliography) = 'object'
  AND jsonb_typeof(settings) = 'object'
  AND (plan IS NULL OR jsonb_typeof(plan) = 'object')
  AND (report IS NULL OR jsonb_typeof(report) = 'object')
  AND (notes IS NULL OR char_length(notes) <= 2000)
  -- A finished writing says what it produced (or why it did not).
  AND (status <> 'succeeded' OR (result_version_id IS NOT NULL AND report IS NOT NULL))
  AND (status <> 'failed' OR error_code IS NOT NULL)
);
--> statement-breakpoint
-- Only one writing at a time per document: two would race to create the next version.
CREATE UNIQUE INDEX document_writings_one_live ON document_writings (document_id)
  WHERE status IN ('queued', 'running', 'paused');
--> statement-breakpoint
-- A finished writing is a record: it never moves again, and what it belongs to never changes.
CREATE OR REPLACE FUNCTION app.guard_document_writing()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('succeeded', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'writing % is finished and cannot change', OLD.id;
  END IF;
  IF NEW.document_id <> OLD.document_id OR NEW.project_id <> OLD.project_id
     OR NEW.workspace_id <> OLD.workspace_id OR NEW.level <> OLD.level
     OR NEW.template_version <> OLD.template_version OR NEW.language <> OLD.language THEN
    RAISE EXCEPTION 'writing % keeps its document, level, template and language', OLD.id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER document_writings_guard BEFORE UPDATE ON document_writings
  FOR EACH ROW EXECUTE FUNCTION app.guard_document_writing();
CREATE TRIGGER document_writings_touch_updated_at BEFORE UPDATE ON document_writings
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER document_writings_no_delete BEFORE DELETE ON document_writings
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION app.reject_history_mutation();
--> statement-breakpoint
REVOKE ALL ON document_writings FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT, UPDATE ON document_writings TO docoo_app;
--> statement-breakpoint
-- Finding what a writing used.
CREATE INDEX model_invocations_writing_idx ON model_invocations (writing_id) WHERE writing_id IS NOT NULL;
CREATE INDEX agent_tool_calls_writing_idx ON agent_tool_calls (writing_id, created_at) WHERE writing_id IS NOT NULL;
--> statement-breakpoint
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
  ('document.writing.knowledge_limit', '{"type":"integer","minimum":0,"maximum":30}', '12',
   '{workspace,topic,project}', false,
   'حداکثر قطعهٔ دانش تأییدشده در نگارش سند توسط مستندساز؛ صفر یعنی بدون دانش و بدون ارجاع',
   'Maximum approved knowledge passages when the documenter writes a document; zero means no knowledge and no citations'),
  ('document.writing.fit_rounds', '{"type":"integer","minimum":0,"maximum":3}', '3',
   '{workspace,topic,project}', false,
   'تعداد دورهای تنظیم طول سند پس از نگارش (افزایش یا کاهش زیربخش‌ها)؛ صفر یعنی بدون تنظیم',
   'Rounds of expanding or condensing subsections after writing to bring the length into the level''s bounds; zero means none');
