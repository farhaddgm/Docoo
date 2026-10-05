-- Tenant isolation, append-only history, link integrity, lookups and settings for research with
-- approved knowledge and the model-based evaluation of roles (ADR-0017).
ALTER TABLE agent_tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tool_calls FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agent_tool_calls_read ON agent_tool_calls
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY agent_tool_calls_append ON agent_tool_calls
  FOR INSERT WITH CHECK (workspace_id = app.current_workspace_id());
--> statement-breakpoint
-- A call names the exact definition version whose allowlist decided it; versions are never deleted.
ALTER TABLE agent_tool_calls
  ADD CONSTRAINT agent_tool_calls_version_workspace_fk
  FOREIGN KEY (agent_definition_version_id, workspace_id) REFERENCES agent_definition_versions (id, workspace_id);
-- The tools are the fixed list of @docoo/domain (AGENT_TOOLS); the input is kept as a digest only.
ALTER TABLE agent_tool_calls ADD CONSTRAINT agent_tool_calls_values CHECK (
  tool IN ('web_search', 'web_read', 'knowledge_retrieve', 'project_documents_read',
           'table_chart_spec', 'calculator', 'citation_verifier', 'document_renderer',
           'request_human_input')
  AND input_sha256 ~ '^[0-9a-f]{64}$'
  AND jsonb_typeof(result) = 'object'
  AND (latency_ms IS NULL OR latency_ms >= 0)
);
--> statement-breakpoint
CREATE TRIGGER agent_tool_calls_append_only
  BEFORE UPDATE OR DELETE ON agent_tool_calls
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
--> statement-breakpoint
REVOKE ALL ON agent_tool_calls FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT ON agent_tool_calls TO docoo_app;
--> statement-breakpoint
-- Where a knowledge item was used: which retrieval snapshots contain it, and which calls cited it.
CREATE INDEX retrieval_snapshots_results_gin ON retrieval_snapshots USING gin (results jsonb_path_ops);
CREATE INDEX agent_tool_calls_result_gin ON agent_tool_calls USING gin (result jsonb_path_ops);
--> statement-breakpoint
-- A report keeps its role evaluations as an array of objects (ADR-0017).
ALTER TABLE brain_reports ADD CONSTRAINT brain_reports_evaluations_shape
  CHECK (jsonb_typeof(evaluations) = 'array');
--> statement-breakpoint
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
  ('research.max_queries', '{"type":"integer","minimum":1,"maximum":10}', '5',
   '{workspace,topic,project}', false,
   'حداکثر تعداد پرس‌وجوی دانش در مرحلهٔ تحقیق (مسئله و هدف‌ها)',
   'Maximum number of knowledge queries in the research stage (the problem and its objectives)'),
  ('research.knowledge_limit', '{"type":"integer","minimum":0,"maximum":30}', '12',
   '{workspace,topic,project}', false,
   'حداکثر قطعهٔ دانش تأییدشده در prompt تحقیق؛ صفر یعنی بدون دانش',
   'Maximum approved knowledge passages in the research prompt; zero means no knowledge'),
  ('research.allow_restricted_knowledge', '{"type":"boolean"}', 'false',
   '{workspace}', false,
   'اجازهٔ ارسال دانش با محرمانگی «محدود» به مدل در مرحلهٔ تحقیق',
   'Allow knowledge marked "restricted" to be sent to the model in the research stage');
