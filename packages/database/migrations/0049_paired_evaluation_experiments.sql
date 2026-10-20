CREATE TABLE public.project_evaluation_experiments (
 workspace_id uuid NOT NULL, project_id uuid NOT NULL,
 experiment_id text NOT NULL CHECK (experiment_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$'),
 manifest_json jsonb NOT NULL CHECK (jsonb_typeof(manifest_json)='object' AND octet_length(manifest_json::text)<=12000000),
 manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','cancelled')),
 created_by uuid NOT NULL REFERENCES public.users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), finished_at timestamptz,
 PRIMARY KEY (workspace_id,project_id,experiment_id),
 FOREIGN KEY (project_id,workspace_id) REFERENCES public.projects(id,workspace_id),
 CHECK (manifest_json->>'experimentId'=experiment_id AND manifest_json->>'contentHash'=manifest_hash),
 CHECK ((status='running')=(finished_at IS NULL))
);
--> statement-breakpoint
CREATE TABLE public.project_evaluation_case_results (
 workspace_id uuid NOT NULL, project_id uuid NOT NULL, experiment_id text NOT NULL,
 ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 999),
 result_json jsonb NOT NULL CHECK (jsonb_typeof(result_json)='object' AND octet_length(result_json::text)<=500000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (workspace_id,project_id,experiment_id,ordinal),
 FOREIGN KEY (workspace_id,project_id,experiment_id) REFERENCES public.project_evaluation_experiments(workspace_id,project_id,experiment_id),
 CHECK (result_json->>'experimentId'=experiment_id)
);
--> statement-breakpoint
CREATE TABLE public.project_evaluation_experiment_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, project_id uuid NOT NULL, experiment_id text NOT NULL,
 review_json jsonb NOT NULL CHECK (jsonb_typeof(review_json)='object' AND octet_length(review_json::text)<=1000000),
 comparison_json jsonb NOT NULL CHECK (jsonb_typeof(comparison_json)='object' AND octet_length(comparison_json::text)<=1000000),
 review_hash text NOT NULL CHECK (review_hash ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY (workspace_id,project_id,experiment_id) REFERENCES public.project_evaluation_experiments(workspace_id,project_id,experiment_id),
 UNIQUE(workspace_id,project_id,experiment_id,review_hash)
);
--> statement-breakpoint
CREATE FUNCTION app.guard_evaluation_experiment_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE e public.project_evaluation_experiments; n integer; expected_run text; result_status text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'evaluation history is immutable'; END IF;
 IF TG_TABLE_NAME='project_evaluation_experiments' THEN
  IF TG_OP='INSERT' THEN
   IF NEW.created_by IS DISTINCT FROM app.current_actor_id() OR NEW.status<>'running' THEN RAISE EXCEPTION 'evaluation actor or status mismatch'; END IF;
  ELSE
   IF OLD.status<>'running' OR NEW.status='running'
      OR (to_jsonb(NEW)-'status'-'finished_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'finished_at') THEN
    RAISE EXCEPTION 'evaluation manifest and terminal state are immutable';
   END IF;
   SELECT count(*) INTO n FROM public.project_evaluation_case_results
    WHERE workspace_id=NEW.workspace_id AND project_id=NEW.project_id AND experiment_id=NEW.experiment_id;
   IF NEW.status='completed' AND (n<>jsonb_array_length(NEW.manifest_json->'dataset'->'cases')*2 OR EXISTS (
    SELECT 1 FROM public.project_evaluation_case_results WHERE workspace_id=NEW.workspace_id AND project_id=NEW.project_id
      AND experiment_id=NEW.experiment_id AND result_json->>'status'<>'completed')) THEN RAISE EXCEPTION 'evaluation incomplete'; END IF;
   IF NEW.status='failed' AND NOT EXISTS (SELECT 1 FROM public.project_evaluation_case_results
    WHERE workspace_id=NEW.workspace_id AND project_id=NEW.project_id AND experiment_id=NEW.experiment_id AND result_json->>'status'='failed') THEN
    RAISE EXCEPTION 'evaluation has no failure'; END IF;
  END IF;
 ELSE
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'evaluation evidence is immutable'; END IF;
  IF TG_TABLE_NAME='project_evaluation_case_results' THEN
   SELECT * INTO e FROM public.project_evaluation_experiments
    WHERE workspace_id=NEW.workspace_id AND project_id=NEW.project_id AND experiment_id=NEW.experiment_id FOR UPDATE;
  ELSE
   SELECT * INTO e FROM public.project_evaluation_experiments
    WHERE workspace_id=NEW.workspace_id AND project_id=NEW.project_id AND experiment_id=NEW.experiment_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'evaluation experiment unavailable'; END IF;
  IF TG_TABLE_NAME='project_evaluation_case_results' THEN
   IF e.status<>'running' OR e.created_by IS DISTINCT FROM app.current_actor_id() THEN RAISE EXCEPTION 'evaluation not writable'; END IF;
   SELECT count(*) INTO n FROM public.project_evaluation_case_results
    WHERE workspace_id=e.workspace_id AND project_id=e.project_id AND experiment_id=e.experiment_id;
   SELECT result_json->>'status' INTO result_status FROM public.project_evaluation_case_results
    WHERE workspace_id=e.workspace_id AND project_id=e.project_id AND experiment_id=e.experiment_id ORDER BY ordinal DESC LIMIT 1;
   IF NEW.ordinal<>n OR COALESCE(result_status,'completed')<>'completed'
      OR NEW.ordinal>=jsonb_array_length(e.manifest_json->'dataset'->'cases')*2 THEN RAISE EXCEPTION 'evaluation result out of order'; END IF;
   expected_run:=CASE WHEN (NEW.ordinal/2)%2=NEW.ordinal%2 THEN e.manifest_json->'baseline'->>'runId' ELSE e.manifest_json->'candidate'->>'runId' END;
   IF NEW.result_json->>'runId' IS DISTINCT FROM expected_run
      OR NEW.result_json->>'caseId' IS DISTINCT FROM e.manifest_json->'dataset'->'cases'->(NEW.ordinal/2)->>'id' THEN
    RAISE EXCEPTION 'evaluation result scope mismatch'; END IF;
  ELSE
   IF e.status<>'completed' OR NEW.created_by IS DISTINCT FROM app.current_actor_id()
      OR NEW.review_json->>'reviewerId' IS DISTINCT FROM NEW.created_by::text
      OR NEW.review_json->>'experimentHash' IS DISTINCT FROM e.manifest_hash
      OR NEW.review_json->>'rubricHash' IS DISTINCT FROM e.manifest_json->'baseline'->'configuration'->>'rubricHash' THEN
    RAISE EXCEPTION 'evaluation review scope mismatch'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['project_evaluation_experiments','project_evaluation_case_results','project_evaluation_experiment_reviews'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE TRIGGER evaluation_mutation_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION app.guard_evaluation_experiment_mutation()',t);
  EXECUTE format('CREATE POLICY evaluation_read ON public.%I FOR SELECT USING (workspace_id=app.current_workspace_id() AND app.resource_access(''project'',workspace_id,project_id) IS NOT NULL)',t);
  EXECUTE format('CREATE POLICY evaluation_insert ON public.%I FOR INSERT WITH CHECK (workspace_id=app.current_workspace_id() AND app.actor_role(workspace_id) IN (''super_admin'',''editor'') AND app.resource_access(''project'',workspace_id,project_id)=''EDIT'')',t);
  EXECUTE format('GRANT SELECT,INSERT ON public.%I TO docoo_app',t);
  EXECUTE format('REVOKE UPDATE,DELETE ON public.%I FROM docoo_app',t);
 END LOOP;
END $$;
--> statement-breakpoint
CREATE POLICY evaluation_finish ON public.project_evaluation_experiments FOR UPDATE
 USING (workspace_id=app.current_workspace_id() AND created_by=app.current_actor_id() AND app.actor_role(workspace_id) IN ('super_admin','editor') AND app.resource_access('project',workspace_id,project_id)='EDIT')
 WITH CHECK (workspace_id=app.current_workspace_id() AND created_by=app.current_actor_id() AND app.actor_role(workspace_id) IN ('super_admin','editor') AND app.resource_access('project',workspace_id,project_id)='EDIT');
GRANT UPDATE (status,finished_at) ON public.project_evaluation_experiments TO docoo_app;
