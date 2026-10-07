-- Tenant isolation, link integrity, state rules and grants for the questions an agent puts to the
-- administrator (ADR-0023). The question text is the project's own content, so unlike the tool
-- ledger this table keeps it; it is shown to the administrator and never leaves the workspace
-- except as part of the data of the attempt that asked.
ALTER TABLE agent_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_questions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agent_questions_tenant_isolation ON agent_questions
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
--> statement-breakpoint
ALTER TABLE agent_questions
  ADD CONSTRAINT agent_questions_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE agent_questions
  ADD CONSTRAINT agent_questions_stage_workspace_fk
  FOREIGN KEY (stage_run_id, workspace_id) REFERENCES stage_runs (id, workspace_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE agent_questions ADD CONSTRAINT agent_questions_values CHECK (
  status IN ('open', 'answered', 'dismissed')
  AND char_length(btrim(question)) BETWEEN 3 AND 1000
  AND char_length(reason) <= 600
  AND (answer IS NULL OR char_length(answer) <= 4000)
  -- An open question has no answer yet; an answered one has the text and when; a dismissed one
  -- has when and no text.
  AND (
    (status = 'open' AND answer IS NULL AND answered_at IS NULL)
    OR (status = 'answered' AND answer IS NOT NULL AND char_length(btrim(answer)) > 0 AND answered_at IS NOT NULL)
    OR (status = 'dismissed' AND answer IS NULL AND answered_at IS NOT NULL)
  )
);
--> statement-breakpoint
-- Once answered or dismissed a question is history: the answer an attempt used must stay what it was.
CREATE OR REPLACE FUNCTION app.agent_question_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.retention_purge', true) = 'on' OR OLD.status = 'open' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'a closed agent question is history';
  END IF;
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'a closed agent question is history';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER agent_questions_closed_is_history
  BEFORE UPDATE OR DELETE ON agent_questions
  FOR EACH ROW EXECUTE FUNCTION app.agent_question_guard();
--> statement-breakpoint
REVOKE ALL ON agent_questions FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT ON agent_questions TO docoo_app;
-- Only the answer can be written afterwards; the question itself never changes.
GRANT UPDATE (status, answer, answered_by, answered_at) ON agent_questions TO docoo_app;
