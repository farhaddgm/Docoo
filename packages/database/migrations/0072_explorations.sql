-- ADR-0044 P1: an exploration turns an event or topic into candidate problems. The exploration row
-- itself can change (title, text, open/archived); messages, candidates and decisions are
-- append-only history, so a candidate that was parked or dropped can come back with a new decision.
CREATE TABLE explorations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 2 AND 200),
 event_text text NOT NULL CHECK(char_length(btrim(event_text)) BETWEEN 1 AND 5000),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','archived')),
 output_language text NOT NULL DEFAULT 'fa' CHECK(output_language IN ('fa','en')),
 version integer NOT NULL DEFAULT 1 CHECK(version >= 1),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id, workspace_id)
);
CREATE INDEX explorations_workspace_idx ON explorations (workspace_id, updated_at DESC);

CREATE TABLE exploration_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 exploration_id uuid NOT NULL,
 seq integer NOT NULL CHECK(seq >= 1),
 role text NOT NULL CHECK(role IN ('admin','agent')),
 content text NOT NULL CHECK(char_length(content) BETWEEN 1 AND 20000),
 status text NOT NULL DEFAULT 'done' CHECK(status IN ('done','failed')),
 invocation_id uuid REFERENCES model_invocations(id) ON DELETE SET NULL,
 author_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(exploration_id, workspace_id) REFERENCES explorations(id, workspace_id),
 UNIQUE(exploration_id, seq),
 CHECK((role='admin' AND author_id IS NOT NULL) OR role='agent')
);

-- One row per version of a candidate; candidate_key is the identity that survives edits.
CREATE TABLE exploration_candidates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 -- Candidates added in one request share a timestamp; this keeps their order stable.
 seq bigint GENERATED ALWAYS AS IDENTITY,
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 exploration_id uuid NOT NULL,
 candidate_key uuid NOT NULL,
 version_no integer NOT NULL CHECK(version_no >= 1),
 title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 2 AND 200),
 problem_draft text NOT NULL CHECK(char_length(btrim(problem_draft)) BETWEEN 1 AND 5000),
 why text NOT NULL DEFAULT '' CHECK(char_length(why) <= 2000),
 assumptions text NOT NULL DEFAULT '' CHECK(char_length(assumptions) <= 2000),
 expected_output text NOT NULL DEFAULT '' CHECK(char_length(expected_output) <= 2000),
 source text NOT NULL CHECK(source IN ('ai','admin')),
 invocation_id uuid REFERENCES model_invocations(id) ON DELETE SET NULL,
 created_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(exploration_id, workspace_id) REFERENCES explorations(id, workspace_id),
 UNIQUE(candidate_key, version_no)
);
CREATE INDEX exploration_candidates_exploration_idx ON exploration_candidates (exploration_id, created_at);

-- The state of a candidate is its newest decision; no decision means 'proposed'.
CREATE TABLE exploration_candidate_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 exploration_id uuid NOT NULL,
 candidate_key uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('proposed','parked','dropped','promoted')),
 reason text NOT NULL DEFAULT '' CHECK(char_length(reason) <= 1000),
 decided_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(exploration_id, workspace_id) REFERENCES explorations(id, workspace_id)
);
CREATE INDEX exploration_decisions_idx ON exploration_candidate_decisions (exploration_id, candidate_key, created_at);
--> statement-breakpoint
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['explorations','exploration_messages','exploration_candidates','exploration_candidate_decisions'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,docoo_app',name);
  -- Any member reads. Only an owner or an editor writes; a viewer never changes anything.
  EXECUTE format($p$CREATE POLICY %I ON %I FOR SELECT USING(workspace_id=app.current_workspace_id()
    AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.workspace_id=%I.workspace_id AND m.user_id=app.current_actor_id()))$p$,
    name||'_read', name, name);
  EXECUTE format($p$CREATE POLICY %I ON %I FOR INSERT WITH CHECK(workspace_id=app.current_workspace_id()
    AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.workspace_id=%I.workspace_id AND m.user_id=app.current_actor_id()
                AND m.role IN ('super_admin','editor')))$p$,
    name||'_write', name, name);
 END LOOP;
 -- History tables: insert only, and never edited or deleted.
 FOREACH name IN ARRAY ARRAY['exploration_messages','exploration_candidates','exploration_candidate_decisions'] LOOP
  EXECUTE format('GRANT SELECT,INSERT ON %I TO docoo_app',name);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation()',name||'_append_only',name);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON explorations TO docoo_app;
CREATE POLICY explorations_update ON explorations FOR UPDATE
 USING(workspace_id=app.current_workspace_id() AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.workspace_id=explorations.workspace_id
       AND m.user_id=app.current_actor_id() AND m.role IN ('super_admin','editor')))
 WITH CHECK(workspace_id=app.current_workspace_id());
-- The author of what is written is the person acting; a decision names an existing candidate.
CREATE POLICY exploration_messages_author ON exploration_messages AS RESTRICTIVE FOR INSERT
 WITH CHECK(author_id IS NULL OR author_id=app.current_actor_id());
CREATE POLICY explorations_author ON explorations AS RESTRICTIVE FOR INSERT
 WITH CHECK(created_by=app.current_actor_id());
CREATE POLICY exploration_candidates_author ON exploration_candidates AS RESTRICTIVE FOR INSERT
 WITH CHECK(created_by IS NULL OR created_by=app.current_actor_id());
CREATE POLICY exploration_decisions_author ON exploration_candidate_decisions AS RESTRICTIVE FOR INSERT
 WITH CHECK(decided_by=app.current_actor_id() AND EXISTS (SELECT 1 FROM exploration_candidates c
   WHERE c.candidate_key=exploration_candidate_decisions.candidate_key
     AND c.exploration_id=exploration_candidate_decisions.exploration_id
     AND c.workspace_id=exploration_candidate_decisions.workspace_id));
--> statement-breakpoint
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
 ('exploration.max_messages', '{"type":"integer","minimum":5,"maximum":200}', '40', '{workspace}', false,
  'حداکثر تعداد پیام ادمین در گفتگوی یک کاوش',
  'Maximum number of administrator messages in the conversation of one exploration'),
 ('exploration.max_candidates', '{"type":"integer","minimum":5,"maximum":100}', '30', '{workspace}', false,
  'حداکثر تعداد مسئلهٔ کاندید در یک کاوش',
  'Maximum number of candidate problems in one exploration');
