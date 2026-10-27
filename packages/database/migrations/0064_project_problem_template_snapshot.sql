ALTER TABLE public.projects
  ADD COLUMN problem_template_snapshot jsonb;
--> statement-breakpoint
ALTER TABLE public.projects
  ADD CONSTRAINT projects_problem_template_snapshot_check
  CHECK (
    problem_template_snapshot IS NULL
    OR (
      jsonb_typeof(problem_template_snapshot) = 'object'
      AND problem_template_snapshot ?& ARRAY[
        'id', 'version', 'lifecycle', 'name', 'description', 'prompts', 'rubric', 'suggestedSections'
      ]::text[]
      AND (problem_template_snapshot - ARRAY[
        'id', 'version', 'lifecycle', 'name', 'description', 'prompts', 'rubric', 'suggestedSections'
      ]::text[]) = '{}'::jsonb
      AND problem_template_snapshot->>'id' IN ('business-plan', 'go-to-market', 'product-redesign')
      AND problem_template_snapshot->>'lifecycle' = 'candidate'
      AND jsonb_typeof(problem_template_snapshot->'version') = 'number'
      AND (problem_template_snapshot->>'version') ~ '^[1-9][0-9]*$'
      AND jsonb_typeof(problem_template_snapshot->'name') = 'object'
      AND jsonb_typeof(problem_template_snapshot->'description') = 'object'
      AND jsonb_typeof(problem_template_snapshot->'rubric') = 'object'
      AND problem_template_snapshot->'rubric' ?& ARRAY['criteria', 'passThreshold', 'minimums']::text[]
      AND ((problem_template_snapshot->'rubric') - ARRAY['criteria', 'passThreshold', 'minimums']::text[]) = '{}'::jsonb
      AND CASE
        WHEN jsonb_typeof(problem_template_snapshot->'rubric'->'criteria') = 'array'
        THEN jsonb_array_length(problem_template_snapshot->'rubric'->'criteria') BETWEEN 3 AND 12
        ELSE false
      END
      AND jsonb_typeof(problem_template_snapshot->'rubric'->'minimums') = 'object'
      AND jsonb_typeof(problem_template_snapshot->'rubric'->'passThreshold') = 'number'
      AND (problem_template_snapshot->'rubric'->>'passThreshold') ~ '^[1-9][0-9]?$|^100$'
      AND CASE
        WHEN jsonb_typeof(problem_template_snapshot->'prompts') = 'array'
        THEN jsonb_array_length(problem_template_snapshot->'prompts') BETWEEN 3 AND 12
        ELSE false
      END
      AND CASE
        WHEN jsonb_typeof(problem_template_snapshot->'suggestedSections') = 'array'
        THEN jsonb_array_length(problem_template_snapshot->'suggestedSections') BETWEEN 1 AND 12
        ELSE false
      END
      AND octet_length(problem_template_snapshot::text) <= 65536
    )
  );
--> statement-breakpoint
CREATE FUNCTION app.guard_project_problem_template_snapshot()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.problem_template_snapshot IS DISTINCT FROM OLD.problem_template_snapshot THEN
    RAISE EXCEPTION 'project problem template snapshots are immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER projects_problem_template_snapshot_guard
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION app.guard_project_problem_template_snapshot();
