-- Tenant isolation, append-only history, link integrity and grants for the analyst's
-- question-and-answer tables of 0015 (ANL-*).
ALTER TABLE analysis_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE analysis_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_rounds FORCE ROW LEVEL SECURITY;
ALTER TABLE question_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE analysis_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_questions FORCE ROW LEVEL SECURITY;
ALTER TABLE analysis_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_answers FORCE ROW LEVEL SECURITY;
ALTER TABLE analysis_contradictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_contradictions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY analysis_sessions_tenant_isolation ON analysis_sessions
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY question_batches_tenant_isolation ON question_batches
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY analysis_questions_tenant_isolation ON analysis_questions
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY analysis_contradictions_tenant_isolation ON analysis_contradictions
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY analysis_rounds_read ON analysis_rounds
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY analysis_rounds_append ON analysis_rounds
  FOR INSERT WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY analysis_answers_read ON analysis_answers
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY analysis_answers_append ON analysis_answers
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
--> statement-breakpoint
ALTER TABLE analysis_sessions ADD CONSTRAINT analysis_sessions_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE analysis_rounds ADD CONSTRAINT analysis_rounds_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE question_batches ADD CONSTRAINT question_batches_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE analysis_questions ADD CONSTRAINT analysis_questions_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE analysis_sessions
  ADD CONSTRAINT analysis_sessions_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE analysis_sessions
  ADD CONSTRAINT analysis_sessions_stage_run_workspace_fk
  FOREIGN KEY (stage_run_id, workspace_id) REFERENCES stage_runs (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE analysis_rounds
  ADD CONSTRAINT analysis_rounds_session_workspace_fk
  FOREIGN KEY (session_id, workspace_id) REFERENCES analysis_sessions (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE analysis_rounds
  ADD CONSTRAINT analysis_rounds_based_on_batch_workspace_fk
  FOREIGN KEY (based_on_batch_id, workspace_id) REFERENCES question_batches (id, workspace_id);
ALTER TABLE question_batches
  ADD CONSTRAINT question_batches_session_workspace_fk
  FOREIGN KEY (session_id, workspace_id) REFERENCES analysis_sessions (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE question_batches
  ADD CONSTRAINT question_batches_stage_run_workspace_fk
  FOREIGN KEY (stage_run_id, workspace_id) REFERENCES stage_runs (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE question_batches
  ADD CONSTRAINT question_batches_round_workspace_fk
  FOREIGN KEY (round_id, workspace_id) REFERENCES analysis_rounds (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE analysis_questions
  ADD CONSTRAINT analysis_questions_session_workspace_fk
  FOREIGN KEY (session_id, workspace_id) REFERENCES analysis_sessions (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE analysis_questions
  ADD CONSTRAINT analysis_questions_batch_workspace_fk
  FOREIGN KEY (batch_id, workspace_id) REFERENCES question_batches (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE analysis_questions
  ADD CONSTRAINT analysis_questions_follow_up_workspace_fk
  FOREIGN KEY (follow_up_of_id, workspace_id) REFERENCES analysis_questions (id, workspace_id);
ALTER TABLE analysis_answers
  ADD CONSTRAINT analysis_answers_question_workspace_fk
  FOREIGN KEY (question_id, workspace_id) REFERENCES analysis_questions (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE analysis_contradictions
  ADD CONSTRAINT analysis_contradictions_session_workspace_fk
  FOREIGN KEY (session_id, workspace_id) REFERENCES analysis_sessions (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE analysis_contradictions
  ADD CONSTRAINT analysis_contradictions_question_a_workspace_fk
  FOREIGN KEY (question_a_id, workspace_id) REFERENCES analysis_questions (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE analysis_contradictions
  ADD CONSTRAINT analysis_contradictions_question_b_workspace_fk
  FOREIGN KEY (question_b_id, workspace_id) REFERENCES analysis_questions (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE analysis_contradictions
  ADD CONSTRAINT analysis_contradictions_detected_round_workspace_fk
  FOREIGN KEY (detected_round_id, workspace_id) REFERENCES analysis_rounds (id, workspace_id);
ALTER TABLE analysis_contradictions
  ADD CONSTRAINT analysis_contradictions_resolved_round_workspace_fk
  FOREIGN KEY (resolved_round_id, workspace_id) REFERENCES analysis_rounds (id, workspace_id);
--> statement-breakpoint
-- The limits of FR-ANL-001/002 cannot be exceeded even by a faulty writer.
ALTER TABLE analysis_sessions ADD CONSTRAINT analysis_sessions_limits CHECK (
  minimum_questions >= 1 AND maximum_questions <= 300
  AND minimum_questions <= maximum_questions
  AND batch_size BETWEEN 1 AND 40
);
ALTER TABLE analysis_sessions ADD CONSTRAINT analysis_sessions_finish_pair CHECK (
  (finish_requested_at IS NULL) = (finish_reason IS NULL)
);
ALTER TABLE analysis_rounds ADD CONSTRAINT analysis_rounds_values CHECK (
  round_no > 0 AND outcome IN ('batch', 'definition')
);
ALTER TABLE question_batches ADD CONSTRAINT question_batches_values CHECK (
  batch_no > 0 AND status IN ('open', 'submitted')
  AND (status = 'submitted') = (submitted_at IS NOT NULL)
);
ALTER TABLE analysis_questions ADD CONSTRAINT analysis_questions_values CHECK (
  ordinal BETWEEN 1 AND 300
  AND category IN ('goal', 'constraint', 'context', 'stakeholder', 'time', 'budget', 'data', 'risk', 'success_criteria', 'out_of_scope')
  AND status IN ('open', 'answered', 'unanswered', 'irrelevant', 'later')
  AND (status = 'open') = (current_answer_id IS NULL)
  AND char_length(btrim(text)) BETWEEN 1 AND 2000
  AND char_length(rationale) <= 1000
);
ALTER TABLE analysis_answers ADD CONSTRAINT analysis_answers_values CHECK (
  revision_no > 0
  AND status IN ('answered', 'unanswered', 'irrelevant', 'later')
  AND jsonb_typeof(attachments) = 'array'
  AND coalesce(char_length(text), 0) <= 8000
  AND (status <> 'answered' OR coalesce(btrim(text), '') <> '' OR jsonb_array_length(attachments) > 0)
  AND (status = 'answered' OR jsonb_array_length(attachments) = 0)
);
ALTER TABLE analysis_contradictions ADD CONSTRAINT analysis_contradictions_values CHECK (
  status IN ('open', 'resolved')
  AND question_a_id <> question_b_id
  AND (status = 'resolved') = (resolved_round_id IS NOT NULL)
);
-- At most one batch waits for answers at a time.
CREATE UNIQUE INDEX question_batches_one_open_uq ON question_batches (session_id) WHERE status = 'open';
--> statement-breakpoint
CREATE TRIGGER analysis_rounds_append_only
  BEFORE UPDATE OR DELETE ON analysis_rounds
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER analysis_answers_append_only
  BEFORE UPDATE OR DELETE ON analysis_answers
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER analysis_sessions_touch_updated_at BEFORE UPDATE ON analysis_sessions
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER analysis_questions_touch_updated_at BEFORE UPDATE ON analysis_questions
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER analysis_contradictions_touch_updated_at BEFORE UPDATE ON analysis_contradictions
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
--> statement-breakpoint
REVOKE ALL ON analysis_sessions, analysis_rounds, question_batches, analysis_questions, analysis_answers, analysis_contradictions FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT, UPDATE ON analysis_sessions, question_batches, analysis_questions, analysis_contradictions TO docoo_app;
GRANT SELECT, INSERT ON analysis_rounds, analysis_answers TO docoo_app;
