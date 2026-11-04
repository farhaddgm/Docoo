-- ADR-0055: the ledger of the live voice assistant. A session is one switched-on stretch; its
-- messages are the transcript; an action is one change the assistant proposed, with every step of
-- its confirmation. All three belong to the one administrator who talked: nobody else reads them
-- through the application. Nothing is ever deleted here except by the retention sweep.
--
-- The assistant only ever asks. A change runs only after its row went proposed -> confirmed (and
-- through first_confirmed when it is irreversible). The trigger on live_actions is the same state
-- machine as nextLiveActionStatus in @docoo/contracts, so a bug in the service cannot skip a
-- confirmation, confirm late, or edit what was proposed. A test keeps the two equal.
CREATE TABLE live_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 user_id uuid NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')),
 end_reason text CHECK(end_reason IN ('user','idle','cap_cost','cap_time','cap_daily','disabled','superseded','error')),
 mode text NOT NULL CHECK(mode IN ('realtime','pipeline')),
 model text NOT NULL DEFAULT '' CHECK(char_length(model) <= 200),
 -- What the owner had allowed and the limits that applied when the session began.
 access_rules jsonb NOT NULL,
 caps jsonb NOT NULL,
 -- Usage as the browser reported it. Counters only grow.
 input_tokens bigint NOT NULL DEFAULT 0 CHECK(input_tokens >= 0),
 output_tokens bigint NOT NULL DEFAULT 0 CHECK(output_tokens >= 0),
 cost_usd double precision NOT NULL DEFAULT 0 CHECK(cost_usd >= 0),
 started_at timestamptz NOT NULL DEFAULT now(),
 last_activity_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz,
 CHECK((status = 'active' AND ended_at IS NULL AND end_reason IS NULL)
    OR (status = 'ended' AND ended_at IS NOT NULL AND end_reason IS NOT NULL))
);
-- One live session per person: a second tab or a crashed browser must not leave two running.
CREATE UNIQUE INDEX live_sessions_one_active_idx ON live_sessions (user_id) WHERE status = 'active';
CREATE INDEX live_sessions_user_idx ON live_sessions (user_id, started_at DESC);
CREATE INDEX live_sessions_workspace_idx ON live_sessions (workspace_id, started_at);
--> statement-breakpoint
CREATE TABLE live_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 session_id uuid NOT NULL REFERENCES live_sessions(id),
 user_id uuid NOT NULL REFERENCES users(id),
 seq integer NOT NULL CHECK(seq > 0),
 role text NOT NULL CHECK(role IN ('user','assistant')),
 content text NOT NULL CHECK(char_length(content) BETWEEN 1 AND 4000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (session_id, seq)
);
--> statement-breakpoint
CREATE TABLE live_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 session_id uuid NOT NULL REFERENCES live_sessions(id),
 user_id uuid NOT NULL REFERENCES users(id),
 -- The name the model used. It may not exist: an unknown name is recorded as a refusal.
 capability text NOT NULL CHECK(char_length(capability) BETWEEN 1 AND 100),
 project_id uuid,
 -- The project the owner had open when it was proposed: it decides "the open project" access, and
 -- the same question is asked again at confirmation.
 current_project_id uuid,
 tier text CHECK(tier IN ('T0','T1','T2','T3')),
 steps text[] NOT NULL DEFAULT '{}',
 tainted boolean NOT NULL DEFAULT false,
 -- Fixed when proposed and read back when confirmed: what is confirmed is what runs.
 params jsonb NOT NULL DEFAULT '{}',
 summary text NOT NULL DEFAULT '' CHECK(char_length(summary) <= 2000),
 target_name text CHECK(char_length(target_name) <= 300),
 status text NOT NULL CHECK(status IN ('proposed','first_confirmed','confirmed','executed','failed','cancelled','expired','refused')),
 refusal_reason text CHECK(char_length(refusal_reason) <= 60),
 cancel_reason text CHECK(char_length(cancel_reason) <= 60),
 result jsonb,
 error_code text CHECK(char_length(error_code) <= 100),
 proposed_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 first_confirmed_at timestamptz,
 first_confirmed_via text CHECK(first_confirmed_via IN ('voice','click','auto')),
 confirmed_at timestamptz,
 confirmed_via text CHECK(confirmed_via IN ('voice','click','auto')),
 finished_at timestamptz,
 CHECK(expires_at > proposed_at),
 CHECK((status = 'refused') = (refusal_reason IS NOT NULL)),
 CHECK(status <> 'cancelled' OR cancel_reason IS NOT NULL),
 CHECK((first_confirmed_at IS NULL) = (first_confirmed_via IS NULL)),
 CHECK((confirmed_at IS NULL) = (confirmed_via IS NULL))
);
CREATE INDEX live_actions_session_idx ON live_actions (session_id, proposed_at);
CREATE INDEX live_actions_user_idx ON live_actions (user_id, proposed_at DESC);
--> statement-breakpoint
-- A session may only move forward: it ends once, its counters grow, its owner never changes.
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
     OR NEW.cost_usd < OLD.cost_usd THEN
    RAISE EXCEPTION 'live_sessions: usage only grows';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER live_sessions_guard BEFORE UPDATE ON live_sessions
 FOR EACH ROW EXECUTE FUNCTION app.live_sessions_guard();
CREATE TRIGGER live_sessions_no_delete BEFORE DELETE ON live_sessions
 FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER live_messages_append_only BEFORE UPDATE OR DELETE ON live_messages
 FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
--> statement-breakpoint
-- The state machine of a proposed change (nextLiveActionStatus). It also keeps what was proposed
-- fixed, refuses a confirmation after the deadline by the database's own clock, and refuses a
-- one-step confirmation of an irreversible (T3) change.
CREATE OR REPLACE FUNCTION app.live_actions_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.workspace_id <> OLD.workspace_id OR NEW.session_id <> OLD.session_id
     OR NEW.user_id <> OLD.user_id OR NEW.capability <> OLD.capability
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.current_project_id IS DISTINCT FROM OLD.current_project_id
     OR NEW.tier IS DISTINCT FROM OLD.tier
     OR NEW.steps IS DISTINCT FROM OLD.steps OR NEW.tainted <> OLD.tainted
     OR NEW.params IS DISTINCT FROM OLD.params OR NEW.summary <> OLD.summary
     OR NEW.target_name IS DISTINCT FROM OLD.target_name OR NEW.proposed_at <> OLD.proposed_at
     OR NEW.expires_at <> OLD.expires_at OR NEW.refusal_reason IS DISTINCT FROM OLD.refusal_reason THEN
    RAISE EXCEPTION 'live_actions: a proposed change is fixed';
  END IF;
  IF (OLD.first_confirmed_at IS NOT NULL AND (NEW.first_confirmed_at IS DISTINCT FROM OLD.first_confirmed_at
        OR NEW.first_confirmed_via IS DISTINCT FROM OLD.first_confirmed_via))
     OR (OLD.confirmed_at IS NOT NULL AND (NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
        OR NEW.confirmed_via IS DISTINCT FROM OLD.confirmed_via))
     OR (OLD.finished_at IS NOT NULL AND NEW.finished_at IS DISTINCT FROM OLD.finished_at) THEN
    RAISE EXCEPTION 'live_actions: a confirmation, once given, is fixed';
  END IF;
  IF NEW.status = OLD.status THEN
    RAISE EXCEPTION 'live_actions: an update must move the status';
  END IF;
  IF NOT (
       (OLD.status = 'proposed' AND NEW.status IN ('first_confirmed','confirmed','cancelled','expired'))
    OR (OLD.status = 'first_confirmed' AND NEW.status IN ('confirmed','cancelled','expired'))
    OR (OLD.status = 'confirmed' AND NEW.status IN ('executed','failed'))
  ) THEN
    RAISE EXCEPTION 'live_actions: % -> % is not a legal move', OLD.status, NEW.status;
  END IF;
  IF NEW.status = 'first_confirmed' AND (NEW.first_confirmed_at IS NULL OR NEW.tier IS DISTINCT FROM 'T3') THEN
    RAISE EXCEPTION 'live_actions: only an irreversible change has a first confirmation';
  END IF;
  IF NEW.status = 'confirmed' AND NEW.confirmed_at IS NULL THEN
    RAISE EXCEPTION 'live_actions: a confirmed change records its confirmation';
  END IF;
  IF NEW.status = 'confirmed' AND NEW.tier IS DISTINCT FROM 'T0' AND NEW.confirmed_via = 'auto' THEN
    RAISE EXCEPTION 'live_actions: only a read confirms itself';
  END IF;
  IF NEW.status = 'confirmed' AND OLD.status = 'proposed' AND NEW.tier = 'T3' THEN
    RAISE EXCEPTION 'live_actions: an irreversible change needs two confirmations';
  END IF;
  IF NEW.status IN ('first_confirmed','confirmed') AND OLD.status IN ('proposed','first_confirmed')
     AND now() >= OLD.expires_at THEN
    RAISE EXCEPTION 'live_actions: the time to confirm has passed';
  END IF;
  IF NEW.status = 'expired' AND now() < OLD.expires_at THEN
    RAISE EXCEPTION 'live_actions: it has not expired yet';
  END IF;
  IF NEW.status IN ('executed','failed','cancelled','expired') AND NEW.finished_at IS NULL THEN
    RAISE EXCEPTION 'live_actions: a finished change records when';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER live_actions_guard BEFORE UPDATE ON live_actions
 FOR EACH ROW EXECUTE FUNCTION app.live_actions_guard();
CREATE TRIGGER live_actions_no_delete BEFORE DELETE ON live_actions
 FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
--> statement-breakpoint
ALTER TABLE live_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE live_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE live_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_actions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON live_sessions, live_messages, live_actions FROM PUBLIC, docoo_app;
--> statement-breakpoint
-- Each row belongs to the administrator who talked; the owner of the workspace does not read
-- another person's conversation through the application either.
CREATE POLICY live_sessions_own_read ON live_sessions
 FOR SELECT USING (workspace_id = app.current_workspace_id() AND user_id = app.current_actor_id());
CREATE POLICY live_sessions_own_start ON live_sessions
 FOR INSERT WITH CHECK (workspace_id = app.current_workspace_id() AND user_id = app.current_actor_id()
  AND status = 'active');
CREATE POLICY live_sessions_own_update ON live_sessions
 FOR UPDATE USING (workspace_id = app.current_workspace_id() AND user_id = app.current_actor_id())
 WITH CHECK (workspace_id = app.current_workspace_id() AND user_id = app.current_actor_id());
GRANT SELECT, INSERT, UPDATE ON live_sessions TO docoo_app;
CREATE POLICY live_messages_own_read ON live_messages
 FOR SELECT USING (workspace_id = app.current_workspace_id() AND user_id = app.current_actor_id());
CREATE POLICY live_messages_own_append ON live_messages
 FOR INSERT WITH CHECK (workspace_id = app.current_workspace_id() AND user_id = app.current_actor_id());
GRANT SELECT, INSERT ON live_messages TO docoo_app;
CREATE POLICY live_actions_own_read ON live_actions
 FOR SELECT USING (workspace_id = app.current_workspace_id() AND user_id = app.current_actor_id());
-- A change is born proposed, or born refused when the gateway said no. Never already confirmed.
CREATE POLICY live_actions_own_propose ON live_actions
 FOR INSERT WITH CHECK (workspace_id = app.current_workspace_id() AND user_id = app.current_actor_id()
  AND status IN ('proposed','refused')
  AND first_confirmed_at IS NULL AND confirmed_at IS NULL AND finished_at IS NULL);
CREATE POLICY live_actions_own_move ON live_actions
 FOR UPDATE USING (workspace_id = app.current_workspace_id() AND user_id = app.current_actor_id())
 WITH CHECK (workspace_id = app.current_workspace_id() AND user_id = app.current_actor_id());
GRANT SELECT, INSERT, UPDATE ON live_actions TO docoo_app;
