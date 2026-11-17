-- ADR-0066: the express depth of the quick draft (five to ten questions). It is a depth of the quick
-- profile, never a new profile, so every rule that keys on analysis_profile='quick' (level 1 documents,
-- the incomplete warning, the audit pin, the way on to the full analysis) applies to it unchanged.
-- Everything that exists stays 'standard'.
ALTER TABLE projects ADD COLUMN analysis_depth text NOT NULL DEFAULT 'standard';
ALTER TABLE workflow_runs ADD COLUMN analysis_depth text NOT NULL DEFAULT 'standard';
ALTER TABLE analysis_sessions ADD COLUMN analysis_depth text NOT NULL DEFAULT 'standard';
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_analysis_depth CHECK (
  analysis_depth IN ('standard','express') AND (analysis_depth='standard' OR analysis_profile='quick')
);
ALTER TABLE workflow_runs ADD CONSTRAINT workflow_runs_analysis_depth CHECK (
  analysis_depth IN ('standard','express') AND (analysis_depth='standard' OR analysis_profile='quick')
);
ALTER TABLE analysis_sessions DROP CONSTRAINT analysis_sessions_profile_limits;
ALTER TABLE analysis_sessions ADD CONSTRAINT analysis_sessions_profile_limits CHECK (
  (analysis_profile='full' AND analysis_depth='standard' AND minimum_questions=30 AND maximum_questions=300 AND batch_size=40)
  OR (analysis_profile='quick' AND analysis_depth='standard' AND minimum_questions=12 AND maximum_questions=15 AND batch_size=12)
  OR (analysis_profile='quick' AND analysis_depth='express' AND minimum_questions=5 AND maximum_questions=10 AND batch_size=10)
);
--> statement-breakpoint
-- The depth of a run and of a session is as fixed as its profile; a project's depth only changes
-- together with its profile, when the quick draft is continued as a full analysis.
CREATE OR REPLACE FUNCTION app.enforce_analysis_profile_identity() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_TABLE_NAME='documents' THEN
  IF NEW.analysis_profile IS DISTINCT FROM OLD.analysis_profile THEN
   RAISE EXCEPTION 'Document analysis profile is immutable' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='analysis_sessions' THEN
  IF NEW.analysis_profile IS DISTINCT FROM OLD.analysis_profile
     OR NEW.analysis_depth IS DISTINCT FROM OLD.analysis_depth
     OR NEW.continued_from_session_id IS DISTINCT FROM OLD.continued_from_session_id THEN
   RAISE EXCEPTION 'Session analysis profile is immutable' USING ERRCODE='23514';
  END IF;
 ELSE
  IF NEW.analysis_profile IS DISTINCT FROM OLD.analysis_profile
     OR NEW.analysis_depth IS DISTINCT FROM OLD.analysis_depth
     OR NEW.analysis_continuation_session_id IS DISTINCT FROM OLD.analysis_continuation_session_id THEN
   RAISE EXCEPTION 'Run analysis profile is immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
