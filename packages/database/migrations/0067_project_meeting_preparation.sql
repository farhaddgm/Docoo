CREATE TABLE public.project_meeting_revisions (
  project_id uuid NOT NULL, workspace_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  state jsonb NOT NULL CHECK (jsonb_typeof(state)='object' AND octet_length(state::text) <= 100000),
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(project_id,workspace_id,revision),
  FOREIGN KEY(project_id,workspace_id) REFERENCES public.projects(id,workspace_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE public.project_meeting_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, workspace_id uuid NOT NULL,
  revision integer NOT NULL, actor_id uuid NOT NULL REFERENCES public.users(id),
  mode text NOT NULL CHECK(mode IN ('prepare','rehearse')),
  difficulty text NOT NULL CHECK(difficulty IN ('supportive','hesitant','challenging')),
  content text NOT NULL CHECK(char_length(content) BETWEEN 1 AND 4000),
  provider_consent boolean NOT NULL CHECK(provider_consent),
  idempotency_key uuid NOT NULL, request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','complete','failed')),
  result jsonb, error_code text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), completed_at timestamptz,
  UNIQUE(workspace_id,actor_id,idempotency_key),
  FOREIGN KEY(project_id,workspace_id,revision) REFERENCES public.project_meeting_revisions(project_id,workspace_id,revision) ON DELETE CASCADE,
  CHECK ((status='pending' AND result IS NULL AND completed_at IS NULL) OR (status='complete' AND result IS NOT NULL AND completed_at IS NOT NULL) OR (status='failed' AND result IS NULL AND completed_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX project_meeting_runs_history_idx ON public.project_meeting_runs(workspace_id,project_id,created_at DESC,id DESC);
--> statement-breakpoint
CREATE FUNCTION app.guard_project_meeting_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,app AS $$
BEGIN
  IF TG_OP='DELETE' AND pg_trigger_depth()>1 THEN RETURN OLD; END IF;
  IF TG_TABLE_NAME='project_meeting_runs' AND TG_OP='UPDATE' THEN
    IF OLD.status='pending' AND NEW.status IN ('complete','failed') AND (to_jsonb(NEW)-ARRAY['status','result','error_code','completed_at']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','result','error_code','completed_at']) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Meeting history is immutable';
END $$;
--> statement-breakpoint
CREATE TRIGGER project_meeting_revisions_immutable BEFORE UPDATE OR DELETE ON public.project_meeting_revisions FOR EACH ROW EXECUTE FUNCTION app.guard_project_meeting_history();
CREATE TRIGGER project_meeting_runs_immutable BEFORE UPDATE OR DELETE ON public.project_meeting_runs FOR EACH ROW EXECUTE FUNCTION app.guard_project_meeting_history();
REVOKE ALL ON FUNCTION app.guard_project_meeting_history() FROM PUBLIC;

--> statement-breakpoint
ALTER TABLE public.project_meeting_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_meeting_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY project_meeting_revisions_read ON public.project_meeting_revisions FOR SELECT USING(workspace_id=app.current_workspace_id() AND app.resource_access('project',workspace_id,project_id) IS NOT NULL);
CREATE POLICY project_meeting_revisions_insert ON public.project_meeting_revisions FOR INSERT WITH CHECK(workspace_id=app.current_workspace_id() AND created_by=app.current_actor_id() AND app.resource_access('project',workspace_id,project_id)='EDIT');
REVOKE ALL ON public.project_meeting_revisions FROM PUBLIC;
GRANT SELECT,INSERT ON public.project_meeting_revisions TO docoo_app;

--> statement-breakpoint
ALTER TABLE public.project_meeting_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_meeting_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY project_meeting_runs_read ON public.project_meeting_runs FOR SELECT USING(workspace_id=app.current_workspace_id() AND app.resource_access('project',workspace_id,project_id) IS NOT NULL);
CREATE POLICY project_meeting_runs_insert ON public.project_meeting_runs FOR INSERT WITH CHECK(workspace_id=app.current_workspace_id() AND actor_id=app.current_actor_id() AND app.resource_access('project',workspace_id,project_id)='EDIT');
REVOKE ALL ON public.project_meeting_runs FROM PUBLIC;
GRANT SELECT,INSERT ON public.project_meeting_runs TO docoo_app;

--> statement-breakpoint
CREATE POLICY project_meeting_runs_update ON public.project_meeting_runs FOR UPDATE USING(workspace_id=app.current_workspace_id() AND actor_id=app.current_actor_id() AND app.resource_access('project',workspace_id,project_id)='EDIT') WITH CHECK(workspace_id=app.current_workspace_id() AND actor_id=app.current_actor_id());
GRANT UPDATE ON public.project_meeting_runs TO docoo_app;
