-- Tenant isolation, append-only history, link integrity and grants for the orchestration
-- tables of 0009 (AI-*, WF-*).
ALTER TABLE provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE stage_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE stage_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE gate_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE human_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE human_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE provider_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_secrets FORCE ROW LEVEL SECURITY;
ALTER TABLE model_catalog_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_catalog_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE model_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_prices FORCE ROW LEVEL SECURITY;
ALTER TABLE stage_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_outputs FORCE ROW LEVEL SECURITY;
ALTER TABLE stage_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE model_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_invocations FORCE ROW LEVEL SECURITY;
ALTER TABLE command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE command_receipts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY provider_connections_tenant_isolation ON provider_connections
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY workflow_runs_tenant_isolation ON workflow_runs
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY stage_runs_tenant_isolation ON stage_runs
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY stage_attempts_tenant_isolation ON stage_attempts
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY gate_decisions_tenant_isolation ON gate_decisions
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY human_tasks_tenant_isolation ON human_tasks
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY provider_secrets_read ON provider_secrets
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY provider_secrets_append ON provider_secrets
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
CREATE POLICY model_catalog_snapshots_read ON model_catalog_snapshots
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY model_catalog_snapshots_append ON model_catalog_snapshots
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
CREATE POLICY model_prices_read ON model_prices
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY model_prices_append ON model_prices
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
CREATE POLICY stage_outputs_read ON stage_outputs
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY stage_outputs_append ON stage_outputs
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
CREATE POLICY stage_reviews_read ON stage_reviews
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY stage_reviews_append ON stage_reviews
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
CREATE POLICY model_invocations_read ON model_invocations
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY model_invocations_append ON model_invocations
  FOR INSERT WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY command_receipts_read ON command_receipts
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY command_receipts_append ON command_receipts
  FOR INSERT WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (created_by IS NULL OR created_by = app.current_actor_id())
  );
--> statement-breakpoint
ALTER TABLE provider_connections ADD CONSTRAINT provider_connections_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE workflow_runs ADD CONSTRAINT workflow_runs_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE stage_runs ADD CONSTRAINT stage_runs_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE stage_attempts ADD CONSTRAINT stage_attempts_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE stage_outputs ADD CONSTRAINT stage_outputs_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE provider_secrets
  ADD CONSTRAINT provider_secrets_connection_workspace_fk
  FOREIGN KEY (connection_id, workspace_id) REFERENCES provider_connections (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE model_catalog_snapshots
  ADD CONSTRAINT model_catalog_snapshots_connection_workspace_fk
  FOREIGN KEY (connection_id, workspace_id) REFERENCES provider_connections (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE workflow_runs
  ADD CONSTRAINT workflow_runs_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE stage_runs
  ADD CONSTRAINT stage_runs_run_workspace_fk
  FOREIGN KEY (run_id, workspace_id) REFERENCES workflow_runs (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE stage_runs
  ADD CONSTRAINT stage_runs_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE stage_attempts
  ADD CONSTRAINT stage_attempts_stage_run_workspace_fk
  FOREIGN KEY (stage_run_id, workspace_id) REFERENCES stage_runs (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE stage_outputs
  ADD CONSTRAINT stage_outputs_stage_run_workspace_fk
  FOREIGN KEY (stage_run_id, workspace_id) REFERENCES stage_runs (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE stage_reviews
  ADD CONSTRAINT stage_reviews_stage_run_workspace_fk
  FOREIGN KEY (stage_run_id, workspace_id) REFERENCES stage_runs (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE stage_reviews
  ADD CONSTRAINT stage_reviews_output_workspace_fk
  FOREIGN KEY (output_id, workspace_id) REFERENCES stage_outputs (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE gate_decisions
  ADD CONSTRAINT gate_decisions_stage_run_workspace_fk
  FOREIGN KEY (stage_run_id, workspace_id) REFERENCES stage_runs (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE gate_decisions
  ADD CONSTRAINT gate_decisions_output_workspace_fk
  FOREIGN KEY (output_id, workspace_id) REFERENCES stage_outputs (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE human_tasks
  ADD CONSTRAINT human_tasks_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE stage_runs ADD CONSTRAINT stage_runs_attempt_limit CHECK (attempt_limit BETWEEN 1 AND 50);
ALTER TABLE stage_runs ADD CONSTRAINT stage_runs_gate_mode CHECK (gate_mode IN ('manual', 'automatic'));
ALTER TABLE stage_attempts ADD CONSTRAINT stage_attempts_positive CHECK (attempt_no > 0);
ALTER TABLE stage_outputs ADD CONSTRAINT stage_outputs_origin CHECK (origin IN ('model', 'edit'));
ALTER TABLE gate_decisions ADD CONSTRAINT gate_decisions_mode CHECK (mode IN ('manual', 'automatic'));
ALTER TABLE provider_connections ADD CONSTRAINT provider_connections_base_url CHECK (base_url IS NULL OR base_url ~ '^https?://');
ALTER TABLE model_prices ADD CONSTRAINT model_prices_non_negative CHECK (
  input_per_million >= 0 AND output_per_million >= 0
  AND coalesce(cached_input_per_million, 0) >= 0 AND coalesce(reasoning_per_million, 0) >= 0
);
-- Only one open gate per stage run.
CREATE UNIQUE INDEX gate_decisions_one_pending_uq ON gate_decisions (stage_run_id) WHERE status = 'pending';
-- Only one live workflow run per project.
CREATE UNIQUE INDEX workflow_runs_one_live_uq ON workflow_runs (project_id)
  WHERE status IN ('starting', 'running', 'paused', 'waiting_for_human');
--> statement-breakpoint
CREATE TRIGGER provider_secrets_append_only
  BEFORE UPDATE OR DELETE ON provider_secrets
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER model_catalog_snapshots_append_only
  BEFORE UPDATE OR DELETE ON model_catalog_snapshots
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER model_prices_append_only
  BEFORE UPDATE OR DELETE ON model_prices
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER stage_outputs_append_only
  BEFORE UPDATE OR DELETE ON stage_outputs
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER stage_reviews_append_only
  BEFORE UPDATE OR DELETE ON stage_reviews
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER model_invocations_append_only
  BEFORE UPDATE OR DELETE ON model_invocations
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER command_receipts_append_only
  BEFORE UPDATE OR DELETE ON command_receipts
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER provider_connections_touch_updated_at BEFORE UPDATE ON provider_connections
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER workflow_runs_touch_updated_at BEFORE UPDATE ON workflow_runs
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER stage_runs_touch_updated_at BEFORE UPDATE ON stage_runs
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER stage_attempts_touch_updated_at BEFORE UPDATE ON stage_attempts
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
--> statement-breakpoint
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
  ('ai.connection_id', '{"type":"string","pattern":"^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$"}', '""',
   '{workspace,topic,project}', false,
   'اتصال provider پیش‌فرض برای اجرای مراحل',
   'Default provider connection for stage runs'),
  ('ai.model', '{"type":"string","maxLength":200}', '""',
   '{workspace,topic,project}', false,
   'شناسهٔ مدل از catalog همان اتصال',
   'Model id from the connection catalog');
--> statement-breakpoint
REVOKE ALL ON provider_connections, workflow_runs, stage_runs, stage_attempts, gate_decisions, human_tasks, provider_secrets, model_catalog_snapshots, model_prices, stage_outputs, stage_reviews, model_invocations, command_receipts FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT, UPDATE ON provider_connections, workflow_runs, stage_runs, stage_attempts, gate_decisions, human_tasks TO docoo_app;
GRANT SELECT, INSERT ON provider_secrets, model_catalog_snapshots, model_prices, stage_outputs, stage_reviews, model_invocations, command_receipts TO docoo_app;
