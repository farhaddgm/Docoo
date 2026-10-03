-- Tenant isolation, append-only history, link integrity, settings and grants for the
-- solution, document and evaluation tables of 0011 (SOL-*, DOC-*, EVA-*).
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
ALTER TABLE evaluation_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_findings FORCE ROW LEVEL SECURITY;
ALTER TABLE solution_criteria_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE solution_criteria_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE solution_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE solution_sets FORCE ROW LEVEL SECURITY;
ALTER TABLE solutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE solutions FORCE ROW LEVEL SECURITY;
ALTER TABLE solution_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE solution_selections FORCE ROW LEVEL SECURITY;
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE document_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_artifacts FORCE ROW LEVEL SECURITY;
ALTER TABLE rubric_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rubric_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluations FORCE ROW LEVEL SECURITY;
ALTER TABLE evaluation_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_exceptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY documents_tenant_isolation ON documents
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY evaluation_findings_tenant_isolation ON evaluation_findings
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY solution_criteria_versions_read ON solution_criteria_versions
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY solution_criteria_versions_append ON solution_criteria_versions
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
CREATE POLICY solution_sets_read ON solution_sets
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY solution_sets_append ON solution_sets
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
CREATE POLICY solutions_read ON solutions
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY solutions_append ON solutions
  FOR INSERT WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY solution_selections_read ON solution_selections
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY solution_selections_append ON solution_selections
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
CREATE POLICY document_versions_read ON document_versions
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY document_versions_append ON document_versions
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
CREATE POLICY document_artifacts_read ON document_artifacts
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY document_artifacts_append ON document_artifacts
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
CREATE POLICY rubric_versions_read ON rubric_versions
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY rubric_versions_append ON rubric_versions
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
CREATE POLICY evaluations_read ON evaluations
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY evaluations_append ON evaluations
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
CREATE POLICY evaluation_exceptions_read ON evaluation_exceptions
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY evaluation_exceptions_append ON evaluation_exceptions
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
--> statement-breakpoint
ALTER TABLE solution_sets ADD CONSTRAINT solution_sets_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE solutions ADD CONSTRAINT solutions_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE documents ADD CONSTRAINT documents_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE document_versions ADD CONSTRAINT document_versions_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE evaluations ADD CONSTRAINT evaluations_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE solution_criteria_versions
  ADD CONSTRAINT solution_criteria_versions_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE solution_sets
  ADD CONSTRAINT solution_sets_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE solutions
  ADD CONSTRAINT solutions_set_workspace_fk
  FOREIGN KEY (set_id, workspace_id) REFERENCES solution_sets (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE solutions
  ADD CONSTRAINT solutions_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE solution_selections
  ADD CONSTRAINT solution_selections_set_workspace_fk
  FOREIGN KEY (set_id, workspace_id) REFERENCES solution_sets (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE documents
  ADD CONSTRAINT documents_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE document_versions
  ADD CONSTRAINT document_versions_document_workspace_fk
  FOREIGN KEY (document_id, workspace_id) REFERENCES documents (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE document_artifacts
  ADD CONSTRAINT document_artifacts_document_workspace_fk
  FOREIGN KEY (document_id, workspace_id) REFERENCES documents (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE document_artifacts
  ADD CONSTRAINT document_artifacts_document_version_workspace_fk
  FOREIGN KEY (document_version_id, workspace_id) REFERENCES document_versions (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE evaluations
  ADD CONSTRAINT evaluations_document_workspace_fk
  FOREIGN KEY (document_id, workspace_id) REFERENCES documents (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE evaluations
  ADD CONSTRAINT evaluations_document_version_workspace_fk
  FOREIGN KEY (document_version_id, workspace_id) REFERENCES document_versions (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE evaluation_findings
  ADD CONSTRAINT evaluation_findings_evaluation_workspace_fk
  FOREIGN KEY (evaluation_id, workspace_id) REFERENCES evaluations (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE evaluation_exceptions
  ADD CONSTRAINT evaluation_exceptions_evaluation_workspace_fk
  FOREIGN KEY (evaluation_id, workspace_id) REFERENCES evaluations (id, workspace_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE documents ADD CONSTRAINT documents_level CHECK (level BETWEEN 1 AND 5);
ALTER TABLE document_versions ADD CONSTRAINT document_versions_level CHECK (level BETWEEN 1 AND 5);
ALTER TABLE document_versions ADD CONSTRAINT document_versions_origin CHECK (origin IN ('model', 'edit', 'restore', 'supersede'));
ALTER TABLE document_artifacts ADD CONSTRAINT document_artifacts_format CHECK (format IN ('docx', 'pdf', 'pptx'));
ALTER TABLE document_artifacts ADD CONSTRAINT document_artifacts_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE documents ADD CONSTRAINT documents_approval_kind CHECK (approval_kind IS NULL OR approval_kind IN ('approved', 'accepted_with_exception'));
ALTER TABLE solution_sets ADD CONSTRAINT solution_sets_count CHECK (requested_count BETWEEN 2 AND 20);
ALTER TABLE evaluation_exceptions ADD CONSTRAINT evaluation_exceptions_reason CHECK (char_length(btrim(reason)) >= 10);
-- A locked version cannot change silently: locked documents only move by supersede.
CREATE OR REPLACE FUNCTION app.reject_locked_document_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'locked' AND NEW.status = 'locked'
     AND (NEW.current_version_id IS DISTINCT FROM OLD.current_version_id
          OR NEW.approved_version_id IS DISTINCT FROM OLD.approved_version_id
          OR NEW.title IS DISTINCT FROM OLD.title OR NEW.level IS DISTINCT FROM OLD.level) THEN
    RAISE EXCEPTION 'locked document % cannot change; supersede it instead', OLD.id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER documents_locked_guard BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION app.reject_locked_document_change();
CREATE TRIGGER documents_touch_updated_at BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER evaluation_findings_touch_updated_at BEFORE UPDATE ON evaluation_findings
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER solution_criteria_versions_append_only
  BEFORE UPDATE OR DELETE ON solution_criteria_versions
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER solution_sets_append_only
  BEFORE UPDATE OR DELETE ON solution_sets
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER solutions_append_only
  BEFORE UPDATE OR DELETE ON solutions
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER solution_selections_append_only
  BEFORE UPDATE OR DELETE ON solution_selections
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER document_versions_append_only
  BEFORE UPDATE OR DELETE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER document_artifacts_append_only
  BEFORE UPDATE OR DELETE ON document_artifacts
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER rubric_versions_append_only
  BEFORE UPDATE OR DELETE ON rubric_versions
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER evaluations_append_only
  BEFORE UPDATE OR DELETE ON evaluations
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER evaluation_exceptions_append_only
  BEFORE UPDATE OR DELETE ON evaluation_exceptions
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
--> statement-breakpoint
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
  ('solution.count', '{"type":"integer","minimum":2,"maximum":20}', '5',
   '{workspace,topic,project}', false,
   'تعداد راه‌حل‌های تولیدی',
   'Number of solutions to generate'),
  ('document.level', '{"type":"integer","minimum":1,"maximum":5}', '3',
   '{workspace,topic,project}', false,
   'سطح طول پیش‌فرض اسناد خروجی',
   'Default length level of output documents'),
  ('document.level_bounds', '{"type":"array","items":{"type":"integer","minimum":0,"maximum":500000},"maxItems":10}',
   '[1000,3000,5000,7000,9000,11000,13000,17000,22000,28000]',
   '{workspace}', false,
   'حداقل و حداکثر نویسهٔ سطح ۱ تا ۵ (ده عدد پشت سر هم)',
   'Minimum and maximum characters of levels 1-5 (ten numbers in order)');
--> statement-breakpoint
REVOKE ALL ON documents, evaluation_findings, solution_criteria_versions, solution_sets, solutions, solution_selections, document_versions, document_artifacts, rubric_versions, evaluations, evaluation_exceptions FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT, UPDATE ON documents, evaluation_findings TO docoo_app;
GRANT SELECT, INSERT ON solution_criteria_versions, solution_sets, solutions, solution_selections, document_versions, document_artifacts, rubric_versions, evaluations, evaluation_exceptions TO docoo_app;
