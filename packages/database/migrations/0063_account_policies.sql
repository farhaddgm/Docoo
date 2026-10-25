-- ADR-0042: per-account settings the owner sets on top of the role. One optional row per user;
-- an account without a row has the defaults of its role. The owner and administrators ignore it.
CREATE TABLE account_policies (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 can_create_projects boolean NOT NULL DEFAULT false,
 can_create_topics boolean NOT NULL DEFAULT false,
 max_projects integer CHECK(max_projects BETWEEN 1 AND 10000),
 -- section -> 'none' | 'view' | 'edit'; only the sections that differ from the role's default.
 sections jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(sections) = 'object'),
 can_upload_files boolean NOT NULL DEFAULT true,
 ai_enabled boolean NOT NULL DEFAULT true,
 ai_monthly_tokens bigint CHECK(ai_monthly_tokens BETWEEN 0 AND 10000000000),
 ai_monthly_cost_usd numeric(12,4) CHECK(ai_monthly_cost_usd BETWEEN 0 AND 1000000),
 ai_daily_calls integer CHECK(ai_daily_calls BETWEEN 0 AND 1000000),
 expires_at timestamptz,
 note text NOT NULL DEFAULT '' CHECK(char_length(note) <= 500),
 updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Same boundary as the users table: the application serves it, the workers never read it.
ALTER TABLE account_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY account_policies_application_auth ON account_policies TO docoo_app
 USING (session_user NOT IN ('docoo_worker_agent','docoo_worker_ingestion'))
 WITH CHECK (session_user NOT IN ('docoo_worker_agent','docoo_worker_ingestion'));
REVOKE ALL ON account_policies FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT, UPDATE ON account_policies TO docoo_app;
--> statement-breakpoint
-- Before this release every editor could create projects and topics; keep that for them. New
-- accounts start without it and the owner switches it on.
INSERT INTO account_policies (user_id, can_create_projects, can_create_topics)
 SELECT id, true, true FROM users WHERE account_role = 'editor' AND deleted_at IS NULL
 ON CONFLICT (user_id) DO NOTHING;
--> statement-breakpoint
-- Who a model call is for, so the AI limits of an account can be counted. Calls a workflow makes
-- are counted for the person who started the run (workflow_runs.created_by) when this is null.
ALTER TABLE model_invocations ADD COLUMN actor_id uuid;
CREATE INDEX model_invocations_actor_idx ON model_invocations (actor_id, created_at) WHERE actor_id IS NOT NULL;
