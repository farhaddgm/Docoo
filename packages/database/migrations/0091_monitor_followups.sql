-- ADR-0056 follow-ups for the monitors.
--
-- 1. Cached input tokens. A provider's answer says how many input tokens it read from its cache
--    (cheaper, and worth showing next to the cost). The server measures this for the executor
--    model; the browser reports it for the voice model once a real voice connection exists. Like
--    every counter of a session it only grows.
-- 2. What the assistant is doing right now (listening, thinking, speaking, asleep), reported by the
--    browser with its heartbeat, so the voice monitor can show a live state instead of guessing
--    from the time of the last message. It is a hint with a time, never a decision.
-- 3. A display name for a project, shown on the viewer monitor instead of its real name.
ALTER TABLE live_sessions
 ADD COLUMN cached_input_tokens bigint NOT NULL DEFAULT 0 CHECK(cached_input_tokens >= 0),
 ADD COLUMN executor_cached_input_tokens bigint NOT NULL DEFAULT 0 CHECK(executor_cached_input_tokens >= 0),
 ADD COLUMN activity text CHECK(activity IN ('listening','thinking','speaking','asleep')),
 ADD COLUMN activity_at timestamptz;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.live_sessions_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.workspace_id <> OLD.workspace_id OR NEW.user_id <> OLD.user_id
     OR NEW.mode <> OLD.mode OR NEW.model <> OLD.model OR NEW.provider <> OLD.provider
     OR NEW.started_at <> OLD.started_at
     OR NEW.access_rules IS DISTINCT FROM OLD.access_rules OR NEW.caps IS DISTINCT FROM OLD.caps THEN
    RAISE EXCEPTION 'live_sessions: what a session started with cannot change';
  END IF;
  IF OLD.status = 'ended' THEN
    RAISE EXCEPTION 'live_sessions: an ended session cannot change';
  END IF;
  IF NEW.input_tokens < OLD.input_tokens OR NEW.output_tokens < OLD.output_tokens
     OR NEW.cost_usd < OLD.cost_usd
     OR NEW.cached_input_tokens < OLD.cached_input_tokens
     OR NEW.executor_input_tokens < OLD.executor_input_tokens
     OR NEW.executor_output_tokens < OLD.executor_output_tokens
     OR NEW.executor_cached_input_tokens < OLD.executor_cached_input_tokens
     OR NEW.executor_cost_usd < OLD.executor_cost_usd
     OR NEW.executor_calls < OLD.executor_calls THEN
    RAISE EXCEPTION 'live_sessions: usage only grows';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TABLE monitor_project_aliases (
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 alias text NOT NULL CHECK(char_length(alias) BETWEEN 1 AND 80),
 updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (project_id)
);
CREATE INDEX monitor_project_aliases_workspace_idx ON monitor_project_aliases (workspace_id);
ALTER TABLE monitor_project_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_project_aliases FORCE ROW LEVEL SECURITY;
CREATE POLICY monitor_project_aliases_tenant ON monitor_project_aliases
 USING (workspace_id = app.current_workspace_id())
 WITH CHECK (workspace_id = app.current_workspace_id());
REVOKE ALL ON monitor_project_aliases FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON monitor_project_aliases TO docoo_app;
--> statement-breakpoint
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
 ('monitor.viewer.use_alias', '{"type":"boolean"}', 'true', '{workspace}', false,
  'اگر پروژه نام نمایشی دارد، به‌جای نام واقعی آن روی نمایشگر بیننده نمایش داده شود',
  'When a project has a display name, show it on the viewer monitor instead of the real name');
