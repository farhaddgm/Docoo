-- ADR-0044 P2: a project can come from a candidate problem of an exploration. The pair is set when
-- the project is created and never changes; one candidate can give more than one project.
ALTER TABLE projects
  ADD COLUMN origin_exploration_id uuid,
  ADD COLUMN origin_candidate_key uuid,
  ADD CONSTRAINT projects_origin_candidate_pair
    CHECK ((origin_exploration_id IS NULL) = (origin_candidate_key IS NULL)),
  ADD CONSTRAINT projects_origin_exploration_fk
    FOREIGN KEY (origin_exploration_id, workspace_id) REFERENCES explorations(id, workspace_id);
CREATE INDEX projects_origin_candidate_idx ON projects (origin_candidate_key)
  WHERE origin_candidate_key IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_project_exploration_origin() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, app AS $$
BEGIN
  IF NEW.origin_exploration_id IS DISTINCT FROM OLD.origin_exploration_id
     OR NEW.origin_candidate_key IS DISTINCT FROM OLD.origin_candidate_key THEN
    RAISE EXCEPTION 'The exploration a project came from does not change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER projects_exploration_origin_guard BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION app.guard_project_exploration_origin();
REVOKE ALL ON FUNCTION app.guard_project_exploration_origin() FROM PUBLIC;
