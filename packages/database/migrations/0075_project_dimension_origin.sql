-- ADR-0045 step E: a project can come from a selected dimension of an exploration project. The pair
-- is set when the project is created and never changes; one dimension can give more than one
-- project. A project has one kind of origin: a candidate of the old explorations or a dimension.
ALTER TABLE projects
  ADD COLUMN origin_project_id uuid,
  ADD COLUMN origin_solution_id uuid,
  ADD CONSTRAINT projects_origin_dimension_pair
    CHECK ((origin_project_id IS NULL) = (origin_solution_id IS NULL)),
  ADD CONSTRAINT projects_origin_one_kind
    CHECK (origin_project_id IS NULL OR origin_candidate_key IS NULL),
  ADD CONSTRAINT projects_origin_project_fk
    FOREIGN KEY (origin_project_id, workspace_id) REFERENCES projects(id, workspace_id),
  ADD CONSTRAINT projects_origin_solution_fk
    FOREIGN KEY (origin_solution_id, workspace_id) REFERENCES solutions(id, workspace_id);
CREATE INDEX projects_origin_solution_idx ON projects (origin_solution_id)
  WHERE origin_solution_id IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_project_exploration_origin() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, app AS $$
BEGIN
  IF NEW.origin_exploration_id IS DISTINCT FROM OLD.origin_exploration_id
     OR NEW.origin_candidate_key IS DISTINCT FROM OLD.origin_candidate_key
     OR NEW.origin_project_id IS DISTINCT FROM OLD.origin_project_id
     OR NEW.origin_solution_id IS DISTINCT FROM OLD.origin_solution_id THEN
    RAISE EXCEPTION 'Where a project came from does not change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
