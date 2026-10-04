-- Tenant isolation, append-only versions, link integrity and grants for the agent tables of
-- 0019 (AGT-*).
ALTER TABLE agent_definition_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_definition_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE project_agent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_agent_profiles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agent_definition_versions_read ON agent_definition_versions
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY agent_definition_versions_append ON agent_definition_versions
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
CREATE POLICY agent_roles_tenant_isolation ON agent_roles
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY project_agent_profiles_tenant_isolation ON project_agent_profiles
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
--> statement-breakpoint
ALTER TABLE agent_definition_versions
  ADD CONSTRAINT agent_definition_versions_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE agent_definition_versions
  ADD CONSTRAINT agent_definition_versions_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE agent_definition_versions
  ADD CONSTRAINT agent_definition_versions_base_workspace_fk
  FOREIGN KEY (base_version_id, workspace_id) REFERENCES agent_definition_versions (id, workspace_id);
ALTER TABLE agent_roles
  ADD CONSTRAINT agent_roles_version_workspace_fk
  FOREIGN KEY (active_version_id, workspace_id) REFERENCES agent_definition_versions (id, workspace_id);
ALTER TABLE project_agent_profiles
  ADD CONSTRAINT project_agent_profiles_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE project_agent_profiles
  ADD CONSTRAINT project_agent_profiles_version_workspace_fk
  FOREIGN KEY (definition_version_id, workspace_id) REFERENCES agent_definition_versions (id, workspace_id);
-- An attempt keeps the exact definition it ran with. Invocations only carry the id: they
-- outlive a purged project, like their project id.
ALTER TABLE stage_attempts
  ADD CONSTRAINT stage_attempts_agent_version_workspace_fk
  FOREIGN KEY (agent_definition_version_id, workspace_id) REFERENCES agent_definition_versions (id, workspace_id);
--> statement-breakpoint
-- A faulty writer cannot store a malformed definition (FR-AGT-001, FR-AGT-002) or give a role a
-- tool outside its ceiling (FR-AGT-005); the ceilings mirror ROLE_TOOL_CEILING in @docoo/domain.
ALTER TABLE agent_definition_versions ADD CONSTRAINT agent_definition_versions_values CHECK (
  sequence > 0
  AND jsonb_typeof(principles) = 'array' AND jsonb_array_length(principles) BETWEEN 1 AND 30
  AND jsonb_typeof(duties) = 'array' AND jsonb_array_length(duties) BETWEEN 1 AND 30
  AND jsonb_typeof(tools) = 'array'
  AND jsonb_typeof(changed_sections) = 'array'
  AND char_length(btrim(prompt_template)) BETWEEN 10 AND 8000
  AND char_length(btrim(reason)) BETWEEN 1 AND 1000
  AND char_length(btrim(output_schema_id)) > 0
  AND (model_policy IS NULL OR (
    jsonb_typeof(model_policy) = 'object'
    AND jsonb_typeof(model_policy -> 'connectionId') = 'string'
    AND jsonb_typeof(model_policy -> 'model') = 'string'
  ))
  AND changed_sections <@ '["principles", "duties", "prompt", "tools", "model"]'::jsonb
  AND CASE role
    WHEN 'analyst' THEN tools <@ '["request_human_input", "project_documents_read", "knowledge_retrieve", "web_search", "web_read", "calculator"]'::jsonb
    WHEN 'researcher' THEN tools <@ '["web_search", "web_read", "knowledge_retrieve", "project_documents_read", "citation_verifier", "calculator"]'::jsonb
    WHEN 'ideator' THEN tools <@ '["knowledge_retrieve", "project_documents_read", "calculator", "table_chart_spec", "request_human_input"]'::jsonb
    WHEN 'documenter' THEN tools <@ '["project_documents_read", "knowledge_retrieve", "table_chart_spec", "citation_verifier", "document_renderer", "calculator"]'::jsonb
    WHEN 'evaluator' THEN tools <@ '["project_documents_read", "knowledge_retrieve", "citation_verifier", "calculator", "request_human_input"]'::jsonb
    WHEN 'brain' THEN tools <@ '["knowledge_retrieve", "project_documents_read", "citation_verifier", "calculator"]'::jsonb
  END
);
--> statement-breakpoint
-- The default of a role is a workspace version of that role; a project runs either such a
-- default (customized = false) or a copy that belongs to that very project (customized = true).
CREATE FUNCTION app.check_agent_active_version() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM agent_definition_versions v
     WHERE v.id = NEW.active_version_id AND v.workspace_id = NEW.workspace_id
       AND v.role = NEW.role AND v.project_id IS NULL
  ) THEN
    RAISE EXCEPTION 'the active version of % must be a workspace version of that role', NEW.role;
  END IF;
  RETURN NEW;
END
$$;
CREATE FUNCTION app.check_agent_profile() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM agent_definition_versions v
     WHERE v.id = NEW.definition_version_id AND v.workspace_id = NEW.workspace_id
       AND v.role = NEW.role
       AND ((NOT NEW.customized AND v.project_id IS NULL)
            OR (NEW.customized AND v.project_id = NEW.project_id))
  ) THEN
    RAISE EXCEPTION 'the pinned % definition does not fit this project', NEW.role;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER agent_roles_check_version
  BEFORE INSERT OR UPDATE OF active_version_id, role ON agent_roles
  FOR EACH ROW EXECUTE FUNCTION app.check_agent_active_version();
CREATE TRIGGER project_agent_profiles_check_version
  BEFORE INSERT OR UPDATE OF definition_version_id, customized, role ON project_agent_profiles
  FOR EACH ROW EXECUTE FUNCTION app.check_agent_profile();
--> statement-breakpoint
CREATE TRIGGER agent_definition_versions_append_only
  BEFORE UPDATE OR DELETE ON agent_definition_versions
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER agent_roles_touch_updated_at BEFORE UPDATE ON agent_roles
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER project_agent_profiles_touch_updated_at BEFORE UPDATE ON project_agent_profiles
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
--> statement-breakpoint
REVOKE ALL ON agent_definition_versions, agent_roles, project_agent_profiles FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT ON agent_definition_versions TO docoo_app;
GRANT SELECT, INSERT, UPDATE ON agent_roles, project_agent_profiles TO docoo_app;
