-- Additive, project-scoped decision evidence; existing application readers remain compatible.
CREATE TABLE project_evidence_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
 project_id uuid NOT NULL, target_type text NOT NULL CHECK(target_type IN ('solution','document')),
 target_version_id uuid NOT NULL, block_index integer, assertion text NOT NULL CHECK(length(assertion) BETWEEN 2 AND 2000),
 claim_id uuid NOT NULL REFERENCES claims(id), citation jsonb NOT NULL,
 relation text NOT NULL CHECK(relation IN ('supports','opposes','context')), applicability_reviewed boolean NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000), actor_id uuid NOT NULL,
 idempotency_key text NOT NULL, request_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
 UNIQUE(workspace_id,project_id,idempotency_key),
 CHECK(target_type='solution' AND block_index IS NULL OR target_type='document' AND block_index IS NOT NULL AND block_index BETWEEN 0 AND 10000)
);
CREATE TABLE project_conflict_suggestion_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), project_id uuid NOT NULL,
 claim_a_id uuid NOT NULL REFERENCES claims(id), claim_b_id uuid NOT NULL REFERENCES claims(id),
 fingerprint text NOT NULL, decision text NOT NULL CHECK(decision IN ('confirmed','dismissed','conditioned')),
 applicability_condition text, reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000), actor_id uuid NOT NULL,
 idempotency_key text NOT NULL, request_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id), UNIQUE(workspace_id,project_id,idempotency_key),
 CHECK(claim_a_id<>claim_b_id), CHECK(decision<>'conditioned' OR applicability_condition IS NOT NULL AND length(applicability_condition) BETWEEN 3 AND 2000)
);
CREATE TABLE project_research_intelligence_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), project_id uuid NOT NULL,
 actor_id uuid NOT NULL, plan jsonb NOT NULL, plan_hash text NOT NULL, idempotency_key text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','succeeded','failed')),
 report jsonb, manifest jsonb, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id), UNIQUE(workspace_id,project_id,idempotency_key),
 CHECK(octet_length(plan::text)<=20000), CHECK(status<>'succeeded' OR report IS NOT NULL AND manifest IS NOT NULL AND completed_at IS NOT NULL)
);
--> statement-breakpoint
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['project_evidence_links','project_conflict_suggestion_reviews','project_research_intelligence_reports'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY intelligence_read ON %I FOR SELECT USING(workspace_id=app.current_workspace_id() AND app.resource_access(''project'',workspace_id,project_id) IN (''VIEW'',''EDIT''))',name);
  EXECUTE format('CREATE POLICY intelligence_append ON %I FOR INSERT WITH CHECK(workspace_id=app.current_workspace_id() AND actor_id=app.current_actor_id() AND app.resource_access(''project'',workspace_id,project_id)=''EDIT'')',name);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,docoo_app',name);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO docoo_app',name);
 END LOOP;
END $$;
CREATE POLICY intelligence_complete ON project_research_intelligence_reports FOR UPDATE
 USING(workspace_id=app.current_workspace_id() AND actor_id=app.current_actor_id() AND app.resource_access('project',workspace_id,project_id)='EDIT')
 WITH CHECK(workspace_id=app.current_workspace_id() AND actor_id=app.current_actor_id() AND app.resource_access('project',workspace_id,project_id)='EDIT');
GRANT UPDATE(status,report,manifest,completed_at) ON project_research_intelligence_reports TO docoo_app;
CREATE TRIGGER evidence_links_immutable BEFORE UPDATE OR DELETE ON project_evidence_links FOR EACH ROW EXECUTE FUNCTION app.reject_audit_mutation();
CREATE TRIGGER conflict_reviews_immutable BEFORE UPDATE OR DELETE ON project_conflict_suggestion_reviews FOR EACH ROW EXECUTE FUNCTION app.reject_audit_mutation();
--> statement-breakpoint
CREATE FUNCTION app.guard_intelligence_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='project_evidence_links' THEN
  IF NOT EXISTS(SELECT 1 FROM claims WHERE id=NEW.claim_id AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'Invalid evidence scope'; END IF;
  IF NEW.target_type='solution' THEN
   IF NOT EXISTS(SELECT 1 FROM solutions WHERE id=NEW.target_version_id AND project_id=NEW.project_id AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'Invalid solution scope'; END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE v.id=NEW.target_version_id AND d.project_id=NEW.project_id AND v.workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'Invalid document scope'; END IF;
  END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM claims WHERE id=NEW.claim_a_id AND workspace_id=NEW.workspace_id) OR NOT EXISTS(SELECT 1 FROM claims WHERE id=NEW.claim_b_id AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'Invalid conflict scope'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER evidence_links_scope BEFORE INSERT ON project_evidence_links FOR EACH ROW EXECUTE FUNCTION app.guard_intelligence_scope();
CREATE TRIGGER conflict_reviews_scope BEFORE INSERT ON project_conflict_suggestion_reviews FOR EACH ROW EXECUTE FUNCTION app.guard_intelligence_scope();
CREATE FUNCTION app.guard_intelligence_report() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status<>'queued' OR NEW.status='queued' OR (to_jsonb(OLD)-ARRAY['status','report','manifest','completed_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','report','manifest','completed_at']) THEN RAISE EXCEPTION 'Research report is immutable after completion'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER intelligence_report_completion BEFORE UPDATE ON project_research_intelligence_reports FOR EACH ROW EXECUTE FUNCTION app.guard_intelligence_report();
