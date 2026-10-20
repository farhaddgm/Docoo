CREATE TABLE public.project_evaluation_review_commands (
 workspace_id uuid NOT NULL, project_id uuid NOT NULL, experiment_id text NOT NULL,
 command_key text NOT NULL CHECK (command_key ~ '^[A-Za-z0-9._:-]{8,200}$'),
 request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
 review_id uuid NOT NULL REFERENCES public.project_evaluation_experiment_reviews(id),
 created_by uuid NOT NULL REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (workspace_id,project_id,experiment_id,command_key),
 FOREIGN KEY (workspace_id,project_id,experiment_id) REFERENCES public.project_evaluation_experiments(workspace_id,project_id,experiment_id)
);
--> statement-breakpoint
CREATE FUNCTION app.guard_evaluation_review_command() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.created_by IS DISTINCT FROM app.current_actor_id() OR NOT EXISTS (
  SELECT 1 FROM public.project_evaluation_experiment_reviews r WHERE r.id=NEW.review_id
   AND r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id AND r.experiment_id=NEW.experiment_id
   AND r.created_by=NEW.created_by AND r.review_hash=NEW.request_hash
 ) THEN RAISE EXCEPTION 'evaluation review command scope mismatch'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
ALTER TABLE public.project_evaluation_review_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_evaluation_review_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY evaluation_command_read ON public.project_evaluation_review_commands FOR SELECT
 USING (workspace_id=app.current_workspace_id() AND app.resource_access('project',workspace_id,project_id) IS NOT NULL);
CREATE POLICY evaluation_command_insert ON public.project_evaluation_review_commands FOR INSERT
 WITH CHECK (workspace_id=app.current_workspace_id() AND app.actor_role(workspace_id) IN ('super_admin','editor')
  AND app.resource_access('project',workspace_id,project_id)='EDIT');
CREATE TRIGGER evaluation_review_command_scope BEFORE INSERT ON public.project_evaluation_review_commands
 FOR EACH ROW EXECUTE FUNCTION app.guard_evaluation_review_command();
CREATE TRIGGER evaluation_review_command_immutable BEFORE UPDATE OR DELETE ON public.project_evaluation_review_commands
 FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
GRANT SELECT,INSERT ON public.project_evaluation_review_commands TO docoo_app;
REVOKE UPDATE,DELETE ON public.project_evaluation_review_commands FROM docoo_app;
