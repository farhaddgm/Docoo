-- Pin the actual profile into audit records; request/model metadata cannot relabel a draft.
CREATE FUNCTION app.pin_analysis_profile_audit() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,public AS $$
DECLARE profile text;
BEGIN
 CASE NEW.target_type
 WHEN 'document' THEN
  SELECT analysis_profile INTO profile FROM documents WHERE id=NEW.target_id AND workspace_id=NEW.workspace_id;
 WHEN 'project' THEN
  SELECT analysis_profile INTO profile FROM projects WHERE id=NEW.target_id AND workspace_id=NEW.workspace_id;
 WHEN 'workflow_run' THEN
  SELECT analysis_profile INTO profile FROM workflow_runs WHERE id=NEW.target_id AND workspace_id=NEW.workspace_id;
 WHEN 'stage_run' THEN
  SELECT r.analysis_profile INTO profile FROM stage_runs s JOIN workflow_runs r ON r.id=s.run_id
   WHERE s.id=NEW.target_id AND s.workspace_id=NEW.workspace_id;
 WHEN 'question_batch' THEN
  SELECT s.analysis_profile INTO profile FROM question_batches b JOIN analysis_sessions s ON s.id=b.session_id
   WHERE b.id=NEW.target_id AND b.workspace_id=NEW.workspace_id;
 ELSE profile:=NULL;
 END CASE;
 IF profile IS NOT NULL THEN
  NEW.after:=CASE WHEN jsonb_typeof(NEW.after)='object' THEN NEW.after ELSE jsonb_build_object('payload',NEW.after) END
    ||jsonb_build_object('analysisProfile',profile,'incomplete',profile='quick');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER audit_events_analysis_profile BEFORE INSERT ON audit_events
 FOR EACH ROW EXECUTE FUNCTION app.pin_analysis_profile_audit();
REVOKE EXECUTE ON FUNCTION app.pin_analysis_profile_audit() FROM PUBLIC;
