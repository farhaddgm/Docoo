-- Tenant isolation, append-only history and link integrity for Brain reports (REP-002).
ALTER TABLE brain_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_reports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY brain_reports_read ON brain_reports
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY brain_reports_append ON brain_reports
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
--> statement-breakpoint
ALTER TABLE brain_reports
  ADD CONSTRAINT brain_reports_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE brain_reports
  ADD CONSTRAINT brain_reports_scope_project CHECK ((scope = 'project') = (project_id IS NOT NULL));
CREATE TRIGGER brain_reports_append_only
  BEFORE UPDATE OR DELETE ON brain_reports
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
--> statement-breakpoint
REVOKE ALL ON brain_reports FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT ON brain_reports TO docoo_app;
