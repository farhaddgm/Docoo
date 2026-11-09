-- ADR-0056 §6: the voice assistant monitor says which AI a conversation ran on. A session already
-- keeps its model; this adds the provider it ran on (openai, gemini, ...), taken when the session
-- starts. Sessions that began before this keep an empty provider and the monitor leaves it out.
-- Like the model, it is part of what a session started with, so it can never change afterwards.
ALTER TABLE live_sessions
 ADD COLUMN provider text NOT NULL DEFAULT '' CHECK(char_length(provider) <= 40);
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
     OR NEW.executor_input_tokens < OLD.executor_input_tokens
     OR NEW.executor_output_tokens < OLD.executor_output_tokens
     OR NEW.executor_cost_usd < OLD.executor_cost_usd
     OR NEW.executor_calls < OLD.executor_calls THEN
    RAISE EXCEPTION 'live_sessions: usage only grows';
  END IF;
  RETURN NEW;
END
$$;
