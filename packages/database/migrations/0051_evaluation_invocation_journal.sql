-- Delegated execution can inspect one selected public model descriptor without exposing secrets.
CREATE FUNCTION app.evaluation_model_snapshot(wid uuid,pid uuid,cid uuid,wanted_model text)
RETURNS TABLE(provider text,model jsonb,hash text,price jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF wid IS DISTINCT FROM app.current_workspace_id() OR app.current_actor_id() IS NULL
  OR app.actor_role(wid) IS NULL OR app.actor_role(wid) NOT IN ('super_admin','editor')
  OR app.resource_access('project',wid,pid) IS DISTINCT FROM 'EDIT'
  OR NOT EXISTS(SELECT 1 FROM public.projects p WHERE p.workspace_id=wid AND p.id=pid
    AND p.deleted_at IS NULL AND p.status NOT IN ('archived','deleted')) THEN RETURN; END IF;
 RETURN QUERY SELECT c.provider::text,m.value,s.hash,
  (SELECT jsonb_build_object('id',p.id,'inputPerMillion',p.input_per_million,'outputPerMillion',p.output_per_million,
    'cachedInputPerMillion',p.cached_input_per_million,'reasoningPerMillion',p.reasoning_per_million,'effectiveFrom',p.effective_from)
   FROM public.model_prices p WHERE p.workspace_id=wid AND p.provider=c.provider AND p.model=wanted_model
    AND p.effective_from<=now() ORDER BY p.effective_from DESC,p.created_at DESC,p.id DESC LIMIT 1)
 FROM public.provider_connections c JOIN LATERAL (
  SELECT s1.models,s1.hash FROM public.model_catalog_snapshots s1 WHERE s1.workspace_id=wid AND s1.connection_id=c.id
   ORDER BY s1.created_at DESC,s1.id DESC LIMIT 1) s ON true
 CROSS JOIN LATERAL jsonb_array_elements(s.models) m(value)
 WHERE c.id=cid AND c.workspace_id=wid AND c.disabled_at IS NULL AND m.value->>'id'=wanted_model;
END $$;
REVOKE ALL ON FUNCTION app.evaluation_model_snapshot(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.evaluation_model_snapshot(uuid,uuid,uuid,text) TO docoo_app;
--> statement-breakpoint
-- A committed intent fences each external call; pending/unknown is never a retry permit.
CREATE TABLE public.project_evaluation_invocation_journal (
 workspace_id uuid NOT NULL, project_id uuid NOT NULL, experiment_id text NOT NULL,
 ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 999),
 intent_json jsonb NOT NULL CHECK (jsonb_typeof(intent_json)='object' AND octet_length(intent_json::text)<=2000),
 intent_hash text NOT NULL CHECK (intent_hash ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','returned','unknown')),
 receipt_json jsonb CHECK (jsonb_typeof(receipt_json)='object' AND octet_length(receipt_json::text)<=500000),
 receipt_hash text CHECK (receipt_hash ~ '^[a-f0-9]{64}$'),
 invocation_id uuid UNIQUE REFERENCES public.model_invocations(id),
 created_by uuid NOT NULL REFERENCES public.users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), finished_at timestamptz,
 PRIMARY KEY (workspace_id,project_id,experiment_id,ordinal),
 FOREIGN KEY (workspace_id,project_id,experiment_id) REFERENCES public.project_evaluation_experiments(workspace_id,project_id,experiment_id),
 CHECK ((status='pending')=(finished_at IS NULL)),
 CHECK ((status='returned')=(receipt_json IS NOT NULL AND receipt_hash IS NOT NULL AND invocation_id IS NOT NULL)),
 CHECK (status='returned' OR (receipt_json IS NULL AND receipt_hash IS NULL AND invocation_id IS NULL))
);
--> statement-breakpoint
CREATE FUNCTION app.guard_evaluation_invocation_journal() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE e public.project_evaluation_experiments; n integer; arm jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'evaluation invocation journal is immutable'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.status<>'pending' OR NEW.status='pending' OR
   (to_jsonb(NEW)-ARRAY['status','receipt_json','receipt_hash','invocation_id','finished_at']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['status','receipt_json','receipt_hash','invocation_id','finished_at']) THEN
   RAISE EXCEPTION 'evaluation invocation receipt is immutable';
  END IF;
 ELSE
  SELECT * INTO e FROM public.project_evaluation_experiments
   WHERE workspace_id=NEW.workspace_id AND project_id=NEW.project_id AND experiment_id=NEW.experiment_id FOR UPDATE;
  IF NOT FOUND OR e.status<>'running' OR e.created_by IS DISTINCT FROM app.current_actor_id()
   OR NEW.created_by IS DISTINCT FROM e.created_by OR NEW.status<>'pending' THEN
   RAISE EXCEPTION 'evaluation invocation unavailable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.workspace_id=NEW.workspace_id AND p.id=NEW.project_id
   AND p.deleted_at IS NULL AND p.status NOT IN ('archived','deleted')) THEN RAISE EXCEPTION 'evaluation project read only'; END IF;
  SELECT count(*) INTO n FROM public.project_evaluation_case_results
   WHERE workspace_id=NEW.workspace_id AND project_id=NEW.project_id AND experiment_id=NEW.experiment_id;
  IF NEW.ordinal<>n OR NEW.ordinal>=jsonb_array_length(e.manifest_json->'dataset'->'cases')*2 OR EXISTS (
   SELECT 1 FROM public.project_evaluation_case_results WHERE workspace_id=NEW.workspace_id
    AND project_id=NEW.project_id AND experiment_id=NEW.experiment_id AND result_json->>'status'<>'completed') THEN
   RAISE EXCEPTION 'evaluation invocation out of order';
  END IF;
  arm:=CASE WHEN (NEW.ordinal/2)%2=NEW.ordinal%2 THEN e.manifest_json->'baseline' ELSE e.manifest_json->'candidate' END;
  IF NEW.intent_json->>'experimentId' IS DISTINCT FROM e.experiment_id
   OR NEW.intent_json->>'experimentHash' IS DISTINCT FROM e.manifest_hash
   OR NEW.intent_json->>'runId' IS DISTINCT FROM arm->>'runId'
   OR NEW.intent_json->>'modelSnapshotHash' IS DISTINCT FROM arm->'configuration'->>'modelSnapshotHash'
   OR NEW.intent_json->>'caseId' IS DISTINCT FROM e.manifest_json->'dataset'->'cases'->(NEW.ordinal/2)->>'id' THEN
   RAISE EXCEPTION 'evaluation invocation scope mismatch';
  END IF;
 END IF;
 IF NEW.status='returned' AND (NEW.receipt_json->>'invocationId' IS DISTINCT FROM NEW.invocation_id::text OR NOT EXISTS (
  SELECT 1 FROM public.model_invocations i WHERE i.id=NEW.invocation_id AND i.workspace_id=NEW.workspace_id
   AND i.project_id=NEW.project_id AND i.purpose='evaluation:paired' AND i.status='succeeded'
   AND i.prompt_sha256=NEW.intent_json->>'requestHash'
   AND i.model=NEW.receipt_json->>'observedModelId'
   AND (CASE WHEN i.provider='fake' THEN 'deterministic' ELSE i.provider::text END)=NEW.receipt_json->>'observedProvider'
 )) THEN RAISE EXCEPTION 'evaluation invocation receipt scope mismatch'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
ALTER TABLE public.project_evaluation_invocation_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_evaluation_invocation_journal FORCE ROW LEVEL SECURITY;
CREATE POLICY evaluation_invocation_read ON public.project_evaluation_invocation_journal FOR SELECT
 USING (workspace_id=app.current_workspace_id() AND app.resource_access('project',workspace_id,project_id) IS NOT NULL);
CREATE POLICY evaluation_invocation_insert ON public.project_evaluation_invocation_journal FOR INSERT
 WITH CHECK (workspace_id=app.current_workspace_id() AND created_by=app.current_actor_id()
  AND app.actor_role(workspace_id) IN ('super_admin','editor') AND app.resource_access('project',workspace_id,project_id)='EDIT');
CREATE POLICY evaluation_invocation_finish ON public.project_evaluation_invocation_journal FOR UPDATE
 USING (workspace_id=app.current_workspace_id() AND created_by=app.current_actor_id()
  AND app.actor_role(workspace_id) IN ('super_admin','editor') AND app.resource_access('project',workspace_id,project_id)='EDIT')
 WITH CHECK (workspace_id=app.current_workspace_id() AND created_by=app.current_actor_id()
  AND app.actor_role(workspace_id) IN ('super_admin','editor') AND app.resource_access('project',workspace_id,project_id)='EDIT');
CREATE TRIGGER evaluation_invocation_guard BEFORE INSERT OR UPDATE OR DELETE ON public.project_evaluation_invocation_journal
 FOR EACH ROW EXECUTE FUNCTION app.guard_evaluation_invocation_journal();
GRANT SELECT,INSERT ON public.project_evaluation_invocation_journal TO docoo_app;
GRANT UPDATE (status,receipt_json,receipt_hash,invocation_id,finished_at) ON public.project_evaluation_invocation_journal TO docoo_app;
REVOKE DELETE ON public.project_evaluation_invocation_journal FROM docoo_app;
