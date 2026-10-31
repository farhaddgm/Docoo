-- ADR-0045: a project has a kind. Every existing project stays 'standard'; an 'exploration'
-- goes through the same stages but proposes the dimensions of a topic instead of ideas.
ALTER TABLE projects ADD COLUMN kind text NOT NULL DEFAULT 'standard';
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_kind CHECK (kind IN ('standard','exploration'));
--> statement-breakpoint
CREATE FUNCTION app.enforce_project_kind_immutable() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.kind IS DISTINCT FROM OLD.kind THEN
  RAISE EXCEPTION 'Project kind is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER projects_kind_immutable BEFORE UPDATE ON projects
 FOR EACH ROW EXECUTE FUNCTION app.enforce_project_kind_immutable();
REVOKE EXECUTE ON FUNCTION app.enforce_project_kind_immutable() FROM PUBLIC;
