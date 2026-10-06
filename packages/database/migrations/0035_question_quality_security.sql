-- Tenant isolation, link integrity, state rules, append-only history and grants for the Brain's
-- judgement of the analyst's questions of 0034 (ADR-0024), and the setting that chooses the criteria.
ALTER TABLE question_quality_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_quality_reviews FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY question_quality_reviews_read ON question_quality_reviews
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY question_quality_reviews_append ON question_quality_reviews
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
--> statement-breakpoint
ALTER TABLE question_quality_reviews
  ADD CONSTRAINT question_quality_reviews_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE question_quality_reviews ADD CONSTRAINT question_quality_reviews_values CHECK (
  status IN ('completed', 'failed')
  AND jsonb_typeof(criteria) = 'array' AND jsonb_array_length(criteria) BETWEEN 1 AND 5
  AND jsonb_typeof(findings) = 'array' AND jsonb_array_length(findings) <= 15
  AND question_count BETWEEN 1 AND 300
  AND discarded >= 0
  AND char_length(btrim(model)) BETWEEN 1 AND 400
  -- A verdict has a score and a summary and no failure reason; a failure has the reason and no verdict.
  AND (
    (status = 'completed' AND score BETWEEN 1 AND 5 AND summary IS NOT NULL
       AND char_length(btrim(summary)) > 0 AND reason IS NULL)
    OR (status = 'failed' AND score IS NULL AND summary IS NULL
       AND reason IN ('provider_failure', 'invalid_output') AND jsonb_array_length(findings) = 0)
  )
);
--> statement-breakpoint
CREATE TRIGGER question_quality_reviews_append_only
  BEFORE UPDATE OR DELETE ON question_quality_reviews
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
--> statement-breakpoint
REVOKE ALL ON question_quality_reviews FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT ON question_quality_reviews TO docoo_app;
--> statement-breakpoint
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
  ('analysis.quality_criteria',
   '{"type":"array","items":{"type":"string","enum":["decision_relevance","leading","duplicate","vague","tone"]},"maxItems":5}',
   '["decision_relevance","leading","duplicate","vague","tone"]',
   '{workspace,topic,project}', false,
   'جنبه‌هایی که ارزیابی کیفیت سؤال‌های تحلیلگر توسط Brain می‌سنجد (خالی یعنی همه)',
   'The aspects the Brain judges when it evaluates the analyst''s questions (empty means all)');
