-- ADR-0031 P1: the administrator's conversation with the agent of a stage. One append-only
-- row per message; the conversation is the stage run. A message never changes an output: a
-- revision request reaches the agent only through the existing rejection of the output.
CREATE TABLE stage_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 project_id uuid NOT NULL,
 stage_run_id uuid NOT NULL,
 output_id uuid,
 role text NOT NULL CHECK(role IN ('admin','agent')),
 kind text NOT NULL CHECK(kind IN ('ask','revision_request','answer','rejection_sent')),
 content text NOT NULL CHECK(length(content) BETWEEN 1 AND 20000),
 status text NOT NULL DEFAULT 'done' CHECK(status IN ('done','failed')),
 reply_to uuid,
 invocation_id uuid REFERENCES model_invocations(id) ON DELETE SET NULL,
 author_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
 FOREIGN KEY(stage_run_id,workspace_id) REFERENCES stage_runs(id,workspace_id),
 FOREIGN KEY(output_id,workspace_id) REFERENCES stage_outputs(id,workspace_id),
 CHECK((role='admin' AND kind IN ('ask','revision_request','rejection_sent') AND author_id IS NOT NULL)
    OR (role='agent' AND kind='answer'))
);
--> statement-breakpoint
CREATE INDEX stage_messages_stage_idx ON stage_messages (stage_run_id, created_at);
ALTER TABLE stage_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY stage_messages_read ON stage_messages FOR SELECT
 USING(workspace_id=app.current_workspace_id() AND app.resource_access('project',workspace_id,project_id) IN ('VIEW','EDIT'));
CREATE POLICY stage_messages_append ON stage_messages FOR INSERT
 WITH CHECK(workspace_id=app.current_workspace_id() AND app.resource_access('project',workspace_id,project_id)='EDIT'
  AND (author_id IS NULL OR author_id=app.current_actor_id()));
REVOKE ALL ON stage_messages FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT ON stage_messages TO docoo_app;
CREATE TRIGGER stage_messages_append_only BEFORE UPDATE OR DELETE ON stage_messages
 FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
--> statement-breakpoint
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
 ('workflow.stage_chat_max_messages', '{"type":"integer","minimum":5,"maximum":200}', '40',
  '{workspace,topic,project}', false,
  'حداکثر تعداد پیام ادمین در گفتگو با ایجنت هر مرحله',
  'Maximum number of administrator messages in the conversation with the agent of one stage');
