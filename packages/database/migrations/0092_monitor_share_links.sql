-- ADR-0056 follow-up: a link that shows one monitor to anyone who has the address and the password.
-- The owner makes the link in the back office, gives it a password, an optional expiry and the
-- number of screens that may watch at once. The address and every watcher's session are stored only
-- as digests; the password only as an argon2 hash.
-- These tables are read before any workspace is known (the visitor has only the address), so they
-- are not filtered by the tenant setting like the others; every query of the API names the
-- workspace itself, and the worker logins cannot touch them (as for sessions).
CREATE TABLE monitor_share_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 kind text NOT NULL CHECK(kind IN ('voice','viewer')),
 label text NOT NULL DEFAULT '' CHECK(char_length(label) <= 80),
 token_digest text NOT NULL UNIQUE,
 password_hash text NOT NULL,
 expires_at timestamptz,
 max_sessions integer NOT NULL CHECK(max_sessions BETWEEN 1 AND 100),
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
CREATE INDEX monitor_share_links_workspace_idx ON monitor_share_links (workspace_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE monitor_share_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 link_id uuid NOT NULL REFERENCES monitor_share_links(id) ON DELETE CASCADE,
 token_digest text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX monitor_share_sessions_link_idx ON monitor_share_sessions (link_id, last_seen_at DESC);
--> statement-breakpoint
ALTER TABLE monitor_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_share_links FORCE ROW LEVEL SECURITY;
CREATE POLICY monitor_share_links_application ON monitor_share_links TO docoo_app USING (session_user NOT IN ('docoo_worker_agent','docoo_worker_ingestion')) WITH CHECK (session_user NOT IN ('docoo_worker_agent','docoo_worker_ingestion'));
ALTER TABLE monitor_share_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_share_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY monitor_share_sessions_application ON monitor_share_sessions TO docoo_app USING (session_user NOT IN ('docoo_worker_agent','docoo_worker_ingestion')) WITH CHECK (session_user NOT IN ('docoo_worker_agent','docoo_worker_ingestion'));
REVOKE ALL ON monitor_share_links, monitor_share_sessions FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON monitor_share_links, monitor_share_sessions TO docoo_app;
