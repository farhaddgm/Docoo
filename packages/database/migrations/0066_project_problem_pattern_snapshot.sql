ALTER TABLE public.projects
  ADD COLUMN problem_pattern_snapshot jsonb;
--> statement-breakpoint
CREATE FUNCTION app.guard_project_problem_pattern_snapshot() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, app AS $$
DECLARE published public.problem_pattern_versions;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.problem_pattern_snapshot IS DISTINCT FROM OLD.problem_pattern_snapshot THEN
      RAISE EXCEPTION 'Project problem pattern snapshots are immutable' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.problem_pattern_snapshot IS NULL THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.problem_pattern_snapshot) <> 'object'
    OR NEW.problem_pattern_snapshot->>'lifecycle' <> 'published'
    OR (NEW.problem_pattern_snapshot->>'workspaceId')::uuid IS DISTINCT FROM NEW.workspace_id
    OR (NEW.problem_pattern_snapshot->>'patternId') IS NULL
    OR (NEW.problem_pattern_snapshot->>'version') !~ '^[1-9][0-9]*$'
    OR jsonb_typeof(NEW.problem_pattern_snapshot->'definition') <> 'object'
  THEN
    RAISE EXCEPTION 'Invalid project problem pattern snapshot' USING ERRCODE = '23514';
  END IF;

  SELECT v.* INTO published
    FROM public.problem_pattern_versions v
   WHERE v.pattern_id = (NEW.problem_pattern_snapshot->>'patternId')::uuid
     AND v.workspace_id = NEW.workspace_id
     AND v.version = (NEW.problem_pattern_snapshot->>'version')::integer
     AND v.definition = NEW.problem_pattern_snapshot->'definition'
     AND v.published_at = (NEW.problem_pattern_snapshot->>'publishedAt')::timestamptz;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project problem pattern must match a published workspace version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER projects_problem_pattern_snapshot_guard
  BEFORE INSERT OR UPDATE OF problem_pattern_snapshot ON public.projects
  FOR EACH ROW EXECUTE FUNCTION app.guard_project_problem_pattern_snapshot();
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.guard_project_problem_pattern_snapshot() FROM PUBLIC;
