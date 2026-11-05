-- ADR-0055 §4-1: the server-side executor. A conversation can run without a voice at all: the
-- owner types, the configured text model works through the same registry and gateway, and every
-- change still waits for a person. Such a session has mode 'text'.
--
-- What the executor's model calls cost is measured by the server (the provider's own usage, priced
-- by the platform), not reported by the browser, and is kept apart from what the browser reports
-- so neither can overwrite the other. A session's total is the two added. Like every counter here
-- it only grows.
ALTER TABLE live_sessions DROP CONSTRAINT live_sessions_mode_check;
ALTER TABLE live_sessions ADD CONSTRAINT live_sessions_mode_check
 CHECK(mode IN ('realtime','pipeline','text'));
ALTER TABLE live_sessions
 ADD COLUMN executor_input_tokens bigint NOT NULL DEFAULT 0 CHECK(executor_input_tokens >= 0),
 ADD COLUMN executor_output_tokens bigint NOT NULL DEFAULT 0 CHECK(executor_output_tokens >= 0),
 ADD COLUMN executor_cost_usd double precision NOT NULL DEFAULT 0 CHECK(executor_cost_usd >= 0),
 ADD COLUMN executor_calls integer NOT NULL DEFAULT 0 CHECK(executor_calls >= 0);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.live_sessions_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.workspace_id <> OLD.workspace_id OR NEW.user_id <> OLD.user_id
     OR NEW.mode <> OLD.mode OR NEW.model <> OLD.model OR NEW.started_at <> OLD.started_at
     OR NEW.access_rules IS DISTINCT FROM OLD.access_rules OR NEW.caps IS DISTINCT FROM OLD.caps THEN
    RAISE EXCEPTION 'live_sessions: what a session started with cannot change';
  END IF;
  IF OLD.status = 'ended' THEN
    RAISE EXCEPTION 'live_sessions: an ended session cannot change';
  END IF;
  IF NEW.input_tokens < OLD.input_tokens OR NEW.output_tokens < OLD.output_tokens
     OR NEW.cost_usd < OLD.cost_usd
     OR NEW.executor_input_tokens < OLD.executor_input_tokens
     OR NEW.executor_output_tokens < OLD.executor_output_tokens
     OR NEW.executor_cost_usd < OLD.executor_cost_usd
     OR NEW.executor_calls < OLD.executor_calls THEN
    RAISE EXCEPTION 'live_sessions: usage only grows';
  END IF;
  RETURN NEW;
END
$$;
