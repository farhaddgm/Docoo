DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'docoo_app') THEN
    CREATE ROLE docoo_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_workspace_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.workspace_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_actor_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.actor_id', true), '')::uuid
$$;
--> statement-breakpoint
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics FORCE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
ALTER TABLE project_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_topics FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspaces_tenant_isolation ON workspaces
  USING (id = app.current_workspace_id())
  WITH CHECK (id = app.current_workspace_id());
CREATE POLICY memberships_tenant_isolation ON memberships
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY topics_tenant_isolation ON topics
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY projects_tenant_isolation ON projects
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY project_topics_tenant_isolation ON project_topics
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY audit_events_read ON audit_events
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY audit_events_append ON audit_events
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (actor_id IS NULL OR actor_id = app.current_actor_id())
  );
--> statement-breakpoint
ALTER TABLE topics ADD CONSTRAINT topics_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE projects ADD CONSTRAINT projects_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE project_topics
  ADD CONSTRAINT project_topics_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id)
  REFERENCES projects (id, workspace_id)
  ON DELETE CASCADE;
ALTER TABLE project_topics
  ADD CONSTRAINT project_topics_topic_workspace_fk
  FOREIGN KEY (topic_id, workspace_id)
  REFERENCES topics (id, workspace_id)
  ON DELETE RESTRICT;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END
$$;
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION app.reject_audit_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;
CREATE TRIGGER workspaces_touch_updated_at BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER users_touch_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER topics_touch_updated_at BEFORE UPDATE ON topics
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER projects_touch_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public, app TO docoo_app;
GRANT EXECUTE ON FUNCTION app.current_workspace_id() TO docoo_app;
GRANT EXECUTE ON FUNCTION app.current_actor_id() TO docoo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions TO docoo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON workspaces, memberships, topics, projects, project_topics TO docoo_app;
GRANT SELECT, INSERT ON audit_events TO docoo_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO docoo_app;
