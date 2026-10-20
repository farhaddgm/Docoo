CREATE TABLE public.project_evaluation_start_commands (
 workspace_id uuid NOT NULL, project_id uuid NOT NULL, command_key text NOT NULL
  CHECK (command_key ~ '^[A-Za-z0-9._:-]{8,200}$'),
 request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
 experiment_id text NOT NULL, created_by uuid NOT NULL REFERENCES public.users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (workspace_id,project_id,command_key),
 UNIQUE (workspace_id,project_id,experiment_id),
 FOREIGN KEY (workspace_id,project_id,experiment_id)
  REFERENCES public.project_evaluation_experiments(workspace_id,project_id,experiment_id)
);
--> statement-breakpoint
CREATE TABLE public.project_evaluation_start_outbox (
 workspace_id uuid NOT NULL, project_id uuid NOT NULL, experiment_id text NOT NULL,
 created_by uuid NOT NULL REFERENCES public.users(id),
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','started')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 1000000),
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (workspace_id,project_id,experiment_id),
 FOREIGN KEY (workspace_id,project_id,experiment_id)
  REFERENCES public.project_evaluation_experiments(workspace_id,project_id,experiment_id)
);
--> statement-breakpoint
CREATE FUNCTION app.guard_evaluation_start_command() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.created_by IS DISTINCT FROM app.current_actor_id() OR NOT EXISTS (
  SELECT 1 FROM public.project_evaluation_experiments e WHERE e.workspace_id=NEW.workspace_id
   AND e.project_id=NEW.project_id AND e.experiment_id=NEW.experiment_id AND e.created_by=NEW.created_by
 ) THEN RAISE EXCEPTION 'evaluation start command scope mismatch'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION app.guard_evaluation_start_outbox() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'pending' OR NEW.attempts<>0 THEN RAISE EXCEPTION 'invalid evaluation outbox insertion'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP<>'UPDATE' OR (to_jsonb(NEW)-'state'-'attempts'-'updated_at'-'lease_until') IS DISTINCT FROM
  (to_jsonb(OLD)-'state'-'attempts'-'updated_at'-'lease_until') OR OLD.state='started' OR NEW.state NOT IN ('pending','started')
  OR NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1
  OR NOT EXISTS (SELECT 1 FROM public.project_evaluation_experiments e WHERE e.workspace_id=NEW.workspace_id
   AND e.project_id=NEW.project_id AND e.experiment_id=NEW.experiment_id AND e.created_by=NEW.created_by)
 THEN RAISE EXCEPTION 'evaluation start outbox is immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['project_evaluation_start_commands','project_evaluation_start_outbox'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY evaluation_start_read ON public.%I FOR SELECT USING (workspace_id=app.current_workspace_id() AND created_by=app.current_actor_id() AND app.resource_access(''project'',workspace_id,project_id) IS NOT NULL)',t);
  EXECUTE format('CREATE POLICY evaluation_start_insert ON public.%I FOR INSERT WITH CHECK (workspace_id=app.current_workspace_id() AND created_by=app.current_actor_id() AND app.actor_role(workspace_id) IN (''super_admin'',''editor'') AND app.resource_access(''project'',workspace_id,project_id)=''EDIT'')',t);
  EXECUTE format('GRANT SELECT,INSERT ON public.%I TO docoo_app',t);
  EXECUTE format('REVOKE UPDATE,DELETE ON public.%I FROM docoo_app',t);
 END LOOP;
END $$;
--> statement-breakpoint
CREATE TRIGGER evaluation_start_command_guard BEFORE INSERT ON public.project_evaluation_start_commands
 FOR EACH ROW EXECUTE FUNCTION app.guard_evaluation_start_command();
CREATE TRIGGER evaluation_start_command_immutable BEFORE UPDATE OR DELETE ON public.project_evaluation_start_commands
 FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER evaluation_start_outbox_guard BEFORE UPDATE OR INSERT OR DELETE ON public.project_evaluation_start_outbox
 FOR EACH ROW EXECUTE FUNCTION app.guard_evaluation_start_outbox();
CREATE POLICY evaluation_start_outbox_update ON public.project_evaluation_start_outbox FOR UPDATE
 USING (workspace_id=app.current_workspace_id() AND created_by=app.current_actor_id()
  AND app.actor_role(workspace_id) IN ('super_admin','editor') AND app.resource_access('project',workspace_id,project_id)='EDIT')
 WITH CHECK (workspace_id=app.current_workspace_id() AND created_by=app.current_actor_id()
  AND app.actor_role(workspace_id) IN ('super_admin','editor') AND app.resource_access('project',workspace_id,project_id)='EDIT');
GRANT UPDATE (state,attempts,updated_at,lease_until) ON public.project_evaluation_start_outbox TO docoo_app;
--> statement-breakpoint
CREATE FUNCTION app.claim_evaluation_start() RETURNS TABLE(workspace_id uuid,project_id uuid,experiment_id text,actor_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE pending public.project_evaluation_start_outbox;
BEGIN
 SELECT * INTO pending FROM public.project_evaluation_start_outbox o
  WHERE o.state='pending' AND (o.lease_until IS NULL OR o.lease_until<clock_timestamp())
  ORDER BY o.created_at,o.workspace_id,o.project_id,o.experiment_id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.project_evaluation_start_outbox SET attempts=attempts+1,
  lease_until=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp()
  WHERE public.project_evaluation_start_outbox.workspace_id=pending.workspace_id
   AND public.project_evaluation_start_outbox.project_id=pending.project_id
   AND public.project_evaluation_start_outbox.experiment_id=pending.experiment_id;
 RETURN QUERY SELECT pending.workspace_id,pending.project_id,pending.experiment_id,pending.created_by;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.claim_evaluation_start() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_evaluation_start() TO docoo_app;
--> statement-breakpoint
CREATE FUNCTION app.complete_evaluation_start(wid uuid,pid uuid,eid text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.project_evaluation_start_outbox SET state='started',lease_until=NULL,updated_at=clock_timestamp()
  WHERE workspace_id=wid AND project_id=pid AND experiment_id=eid AND state='pending';
 RETURN FOUND OR EXISTS (SELECT 1 FROM public.project_evaluation_start_outbox
  WHERE workspace_id=wid AND project_id=pid AND experiment_id=eid AND state='started');
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.complete_evaluation_start(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.complete_evaluation_start(uuid,uuid,text) TO docoo_app;
