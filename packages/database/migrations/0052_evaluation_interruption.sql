ALTER TABLE public.project_evaluation_experiments DROP CONSTRAINT project_evaluation_experiments_status_check;
ALTER TABLE public.project_evaluation_experiments ADD CONSTRAINT project_evaluation_experiments_status_check
 CHECK (status IN ('running','completed','failed','cancelled','interrupted'));
--> statement-breakpoint
-- Revocation must stop further work without granting the revoked actor access to the project.
-- This capability only changes their own running experiment's terminal metadata; never returns content.
CREATE FUNCTION app.interrupt_evaluation_experiment(wid uuid,pid uuid,eid text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.project_evaluation_experiments;
BEGIN
 IF wid IS DISTINCT FROM app.current_workspace_id() OR app.current_actor_id() IS NULL THEN RETURN false; END IF;
 SELECT * INTO e FROM public.project_evaluation_experiments
  WHERE workspace_id=wid AND project_id=pid AND experiment_id=eid FOR UPDATE;
 IF NOT FOUND OR (e.created_by IS DISTINCT FROM app.current_actor_id() AND app.actor_role(wid) IS DISTINCT FROM 'super_admin') THEN RETURN false; END IF;
 IF e.status='interrupted' THEN RETURN true; END IF;
 IF e.status<>'running' THEN RETURN false; END IF;
 UPDATE public.project_evaluation_experiments SET status='interrupted',finished_at=clock_timestamp()
  WHERE workspace_id=wid AND project_id=pid AND experiment_id=eid;
 INSERT INTO public.audit_events(workspace_id,actor_id,action,target_type,target_id,project_id,after,correlation_id)
 VALUES(wid,app.current_actor_id(),'project.evaluation_experiment.interrupted','project',pid,pid,
  jsonb_build_object('experimentId',eid,'redacted',true),gen_random_uuid());
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.interrupt_evaluation_experiment(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.interrupt_evaluation_experiment(uuid,uuid,text) TO docoo_app;
