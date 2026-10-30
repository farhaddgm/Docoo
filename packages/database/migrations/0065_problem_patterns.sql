CREATE TABLE public.problem_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  pattern_key text NOT NULL CHECK (pattern_key ~ '^[a-z][a-z0-9-]{1,63}$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  created_by uuid NOT NULL REFERENCES public.users(id),
  creation_key uuid NOT NULL,
  creation_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_patterns_id_workspace_uq UNIQUE (id, workspace_id),
  CONSTRAINT problem_patterns_workspace_pattern_key_uq UNIQUE (workspace_id, pattern_key),
  CONSTRAINT problem_patterns_workspace_creator_creation_uq UNIQUE (workspace_id, created_by, creation_key)
);
--> statement-breakpoint
CREATE TABLE public.problem_pattern_ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.users(id),
  kind text NOT NULL CHECK (kind IN ('chat', 'test')),
  revision integer NOT NULL CHECK (revision > 0),
  definition_hash text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
  provider_consent boolean NOT NULL CHECK (provider_consent),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'failed')),
  result jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT problem_pattern_ai_runs_id_pattern_workspace_uq UNIQUE (id, pattern_id, workspace_id),
  CONSTRAINT problem_pattern_ai_runs_workspace_actor_idempotency_uq UNIQUE (workspace_id, actor_id, idempotency_key),
  FOREIGN KEY (pattern_id, workspace_id) REFERENCES public.problem_patterns(id, workspace_id),
  CHECK ((status = 'pending' AND completed_at IS NULL AND result IS NULL)
      OR (status = 'complete' AND completed_at IS NOT NULL AND result IS NOT NULL)
      OR (status = 'failed' AND completed_at IS NOT NULL AND result IS NULL))
);
--> statement-breakpoint
CREATE INDEX problem_pattern_ai_runs_history_idx ON public.problem_pattern_ai_runs(workspace_id, pattern_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE TABLE public.problem_pattern_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  revision integer NOT NULL CHECK (revision > 0),
  definition jsonb NOT NULL,
  test_run_id uuid NOT NULL,
  published_by uuid NOT NULL REFERENCES public.users(id),
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_pattern_versions_pattern_version_uq UNIQUE (pattern_id, version),
  CONSTRAINT problem_pattern_versions_pattern_revision_uq UNIQUE (pattern_id, revision),
  CONSTRAINT problem_pattern_versions_workspace_actor_idempotency_uq UNIQUE (workspace_id, published_by, idempotency_key),
  FOREIGN KEY (pattern_id, workspace_id) REFERENCES public.problem_patterns(id, workspace_id),
  FOREIGN KEY (test_run_id, pattern_id, workspace_id) REFERENCES public.problem_pattern_ai_runs(id, pattern_id, workspace_id)
);
--> statement-breakpoint
CREATE FUNCTION app.guard_problem_pattern_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, app AS $$
DECLARE pattern public.problem_patterns; test public.problem_pattern_ai_runs;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Published pattern versions are immutable'; END IF;
  SELECT * INTO pattern FROM public.problem_patterns WHERE id = NEW.pattern_id AND workspace_id = NEW.workspace_id FOR UPDATE;
  IF NOT FOUND OR pattern.status = 'archived' OR pattern.revision <> NEW.revision OR pattern.definition IS DISTINCT FROM NEW.definition THEN
    RAISE EXCEPTION 'Pattern revision mismatch' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO test FROM public.problem_pattern_ai_runs WHERE id = NEW.test_run_id AND pattern_id = NEW.pattern_id AND workspace_id = NEW.workspace_id;
  IF NOT FOUND OR test.kind <> 'test' OR test.status <> 'complete' OR test.revision <> NEW.revision OR test.result->'preview' IS NULL OR test.result->'preview' = 'null'::jsonb THEN
    RAISE EXCEPTION 'A completed preview of the same revision is required' USING ERRCODE = '23514';
  END IF;
  IF NEW.published_by IS DISTINCT FROM app.current_actor_id() THEN RAISE EXCEPTION 'Actor mismatch' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER problem_pattern_versions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.problem_pattern_versions FOR EACH ROW EXECUTE FUNCTION app.guard_problem_pattern_version();
--> statement-breakpoint
CREATE FUNCTION app.guard_problem_pattern_run() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, app AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.actor_id IS DISTINCT FROM app.current_actor_id() THEN RAISE EXCEPTION 'Invalid AI request'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' OR OLD.status <> 'pending' OR NEW.status NOT IN ('complete', 'failed')
    OR (to_jsonb(NEW) - ARRAY['status','result','error_code','completed_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','result','error_code','completed_at']) THEN
    RAISE EXCEPTION 'AI request history is immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER problem_pattern_runs_guard BEFORE INSERT OR UPDATE OR DELETE ON public.problem_pattern_ai_runs FOR EACH ROW EXECUTE FUNCTION app.guard_problem_pattern_run();

--> statement-breakpoint
ALTER TABLE public.problem_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.problem_patterns FORCE ROW LEVEL SECURITY;
CREATE POLICY problem_patterns_workspace_read ON public.problem_patterns FOR SELECT USING (
 workspace_id = app.current_workspace_id() AND EXISTS (
 SELECT 1 FROM public.memberships m WHERE m.workspace_id = problem_patterns.workspace_id AND m.user_id = app.current_actor_id() AND m.role = 'super_admin'
 ));
CREATE POLICY problem_patterns_admin_insert ON public.problem_patterns FOR INSERT WITH CHECK (
 workspace_id = app.current_workspace_id() AND EXISTS (
 SELECT 1 FROM public.memberships m WHERE m.workspace_id = problem_patterns.workspace_id AND m.user_id = app.current_actor_id() AND m.role = 'super_admin'
 ));
REVOKE ALL ON public.problem_patterns FROM PUBLIC;
GRANT SELECT, INSERT ON public.problem_patterns TO docoo_app;
CREATE POLICY problem_patterns_admin_update ON public.problem_patterns FOR UPDATE USING (
 workspace_id = app.current_workspace_id() AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.workspace_id = problem_patterns.workspace_id AND m.user_id = app.current_actor_id() AND m.role = 'super_admin')
 ) WITH CHECK (workspace_id = app.current_workspace_id());
GRANT UPDATE ON public.problem_patterns TO docoo_app;

--> statement-breakpoint
ALTER TABLE public.problem_pattern_ai_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.problem_pattern_ai_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY problem_pattern_ai_runs_workspace_read ON public.problem_pattern_ai_runs FOR SELECT USING (
 workspace_id = app.current_workspace_id() AND EXISTS (
 SELECT 1 FROM public.memberships m WHERE m.workspace_id = problem_pattern_ai_runs.workspace_id AND m.user_id = app.current_actor_id() AND m.role = 'super_admin'
 ));
CREATE POLICY problem_pattern_ai_runs_admin_insert ON public.problem_pattern_ai_runs FOR INSERT WITH CHECK (
 workspace_id = app.current_workspace_id() AND EXISTS (
 SELECT 1 FROM public.memberships m WHERE m.workspace_id = problem_pattern_ai_runs.workspace_id AND m.user_id = app.current_actor_id() AND m.role = 'super_admin'
 ));
REVOKE ALL ON public.problem_pattern_ai_runs FROM PUBLIC;
GRANT SELECT, INSERT ON public.problem_pattern_ai_runs TO docoo_app;
CREATE POLICY problem_pattern_ai_runs_admin_update ON public.problem_pattern_ai_runs FOR UPDATE USING (
 workspace_id = app.current_workspace_id() AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.workspace_id = problem_pattern_ai_runs.workspace_id AND m.user_id = app.current_actor_id() AND m.role = 'super_admin')
 ) WITH CHECK (workspace_id = app.current_workspace_id());
GRANT UPDATE ON public.problem_pattern_ai_runs TO docoo_app;

--> statement-breakpoint
ALTER TABLE public.problem_pattern_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.problem_pattern_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY problem_pattern_versions_workspace_read ON public.problem_pattern_versions FOR SELECT USING (
 workspace_id = app.current_workspace_id() AND EXISTS (
 SELECT 1 FROM public.memberships m WHERE m.workspace_id = problem_pattern_versions.workspace_id AND m.user_id = app.current_actor_id()
 ));
CREATE POLICY problem_pattern_versions_admin_insert ON public.problem_pattern_versions FOR INSERT WITH CHECK (
 workspace_id = app.current_workspace_id() AND EXISTS (
 SELECT 1 FROM public.memberships m WHERE m.workspace_id = problem_pattern_versions.workspace_id AND m.user_id = app.current_actor_id() AND m.role = 'super_admin'
 ));
REVOKE ALL ON public.problem_pattern_versions FROM PUBLIC;
GRANT SELECT, INSERT ON public.problem_pattern_versions TO docoo_app;

--> statement-breakpoint
REVOKE ALL ON FUNCTION app.guard_problem_pattern_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.guard_problem_pattern_run() FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION app.guard_problem_pattern_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, app AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS DISTINCT FROM app.current_actor_id() OR NEW.revision <> 1 OR NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'Invalid initial pattern';
    END IF;
  ELSE
    IF OLD.status = 'archived' OR (NEW.id, NEW.workspace_id, NEW.pattern_key, NEW.created_by, NEW.creation_key, NEW.creation_hash, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.workspace_id, OLD.pattern_key, OLD.created_by, OLD.creation_key, OLD.creation_hash, OLD.created_at) THEN
      RAISE EXCEPTION 'Pattern identity is immutable';
    END IF;
    IF NEW.definition IS DISTINCT FROM OLD.definition THEN
      IF NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'Draft changes require next revision'; END IF;
    ELSIF NEW.revision NOT IN (OLD.revision, OLD.revision + 1) THEN RAISE EXCEPTION 'Invalid draft revision';
    END IF;
  END IF;
  IF NEW.definition->>'key' IS DISTINCT FROM NEW.pattern_key OR NEW.definition->>'schemaVersion' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Pattern definition identity mismatch';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER problem_pattern_draft_guard BEFORE INSERT OR UPDATE ON public.problem_patterns FOR EACH ROW EXECUTE FUNCTION app.guard_problem_pattern_draft();
REVOKE ALL ON FUNCTION app.guard_problem_pattern_draft() FROM PUBLIC;
