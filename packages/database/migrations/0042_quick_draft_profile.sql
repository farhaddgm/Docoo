-- Issue140: optional incomplete draft; all pre-existing projects/runs/documents remain full.
ALTER TABLE projects ADD COLUMN analysis_profile text NOT NULL DEFAULT 'full';
ALTER TABLE projects ADD COLUMN analysis_continuation_session_id uuid;
ALTER TABLE workflow_runs ADD COLUMN analysis_profile text NOT NULL DEFAULT 'full';
ALTER TABLE workflow_runs ADD COLUMN analysis_continuation_session_id uuid;
ALTER TABLE analysis_sessions ADD COLUMN analysis_profile text NOT NULL DEFAULT 'full';
ALTER TABLE analysis_sessions ADD COLUMN continued_from_session_id uuid;
ALTER TABLE documents ADD COLUMN analysis_profile text NOT NULL DEFAULT 'full';
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_analysis_profile CHECK (analysis_profile IN ('full','quick'));
ALTER TABLE workflow_runs ADD CONSTRAINT workflow_runs_analysis_profile CHECK (analysis_profile IN ('full','quick'));
ALTER TABLE analysis_sessions ADD CONSTRAINT analysis_sessions_profile_limits CHECK (
  (analysis_profile='full' AND minimum_questions=30 AND maximum_questions=300 AND batch_size=40)
  OR (analysis_profile='quick' AND minimum_questions=12 AND maximum_questions=15 AND batch_size=12)
);
ALTER TABLE documents ADD CONSTRAINT documents_analysis_profile CHECK (
  analysis_profile='full' OR (analysis_profile='quick' AND level=1)
);
ALTER TABLE analysis_sessions ADD CONSTRAINT analysis_sessions_continuation_identity UNIQUE (id,project_id,workspace_id);
ALTER TABLE analysis_sessions ADD CONSTRAINT analysis_sessions_continuation_project_fk
 FOREIGN KEY (continued_from_session_id,project_id,workspace_id) REFERENCES analysis_sessions(id,project_id,workspace_id);
ALTER TABLE projects ADD CONSTRAINT projects_continuation_project_fk
 FOREIGN KEY (analysis_continuation_session_id,id,workspace_id) REFERENCES analysis_sessions(id,project_id,workspace_id);
ALTER TABLE workflow_runs ADD CONSTRAINT workflow_runs_continuation_project_fk
 FOREIGN KEY (analysis_continuation_session_id,project_id,workspace_id) REFERENCES analysis_sessions(id,project_id,workspace_id);
--> statement-breakpoint
CREATE FUNCTION app.enforce_analysis_profile_identity() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_TABLE_NAME='documents' THEN
  IF NEW.analysis_profile IS DISTINCT FROM OLD.analysis_profile THEN
   RAISE EXCEPTION 'Document analysis profile is immutable' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='analysis_sessions' THEN
  IF NEW.analysis_profile IS DISTINCT FROM OLD.analysis_profile OR NEW.continued_from_session_id IS DISTINCT FROM OLD.continued_from_session_id THEN
   RAISE EXCEPTION 'Session analysis profile is immutable' USING ERRCODE='23514';
  END IF;
 ELSE
  IF NEW.analysis_profile IS DISTINCT FROM OLD.analysis_profile OR NEW.analysis_continuation_session_id IS DISTINCT FROM OLD.analysis_continuation_session_id THEN
   RAISE EXCEPTION 'Run analysis profile is immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER documents_analysis_profile_immutable BEFORE UPDATE ON documents
 FOR EACH ROW EXECUTE FUNCTION app.enforce_analysis_profile_identity();
CREATE TRIGGER analysis_sessions_profile_immutable BEFORE UPDATE ON analysis_sessions
 FOR EACH ROW EXECUTE FUNCTION app.enforce_analysis_profile_identity();
CREATE TRIGGER workflow_runs_analysis_profile_immutable BEFORE UPDATE ON workflow_runs
 FOR EACH ROW EXECUTE FUNCTION app.enforce_analysis_profile_identity();
--> statement-breakpoint
CREATE FUNCTION app.enforce_quick_draft_warning() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,public AS $$
DECLARE profile text; warning text;
BEGIN
 SELECT d.analysis_profile,CASE WHEN d.language='fa' THEN 'پیش‌نویس؛ ناقص‌تر از تحلیل کامل' ELSE 'Draft; less complete than full analysis' END
 INTO profile,warning FROM documents d WHERE d.id=NEW.document_id AND d.workspace_id=NEW.workspace_id;
 IF profile='quick' AND NOT NEW.content @> jsonb_build_object('blocks',jsonb_build_array(
  jsonb_build_object('id','docoo-quick-draft-warning','type','callout','tone','warning','text',warning))) THEN
  RAISE EXCEPTION 'Quick draft must retain its incomplete warning' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER document_versions_quick_draft_warning BEFORE INSERT ON document_versions
 FOR EACH ROW EXECUTE FUNCTION app.enforce_quick_draft_warning();
REVOKE EXECUTE ON FUNCTION app.enforce_analysis_profile_identity() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.enforce_quick_draft_warning() FROM PUBLIC;
