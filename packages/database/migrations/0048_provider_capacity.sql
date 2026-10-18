ALTER TABLE provider_connections ADD COLUMN max_concurrent_invocations integer NOT NULL DEFAULT 4;
ALTER TABLE provider_connections ADD CONSTRAINT provider_connections_concurrency_range CHECK (max_concurrent_invocations BETWEEN 1 AND 100);
CREATE UNIQUE INDEX provider_connections_scope_id_uq ON provider_connections(workspace_id,id);
--> statement-breakpoint
CREATE TABLE provider_invocation_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  connection_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_capacity_connection_scope_fk FOREIGN KEY(workspace_id,connection_id) REFERENCES provider_connections(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT provider_invocation_leases_positive_lifetime CHECK(expires_at>created_at)
);
CREATE INDEX provider_invocation_leases_active_idx ON provider_invocation_leases(workspace_id,connection_id,expires_at);
--> statement-breakpoint
ALTER TABLE provider_invocation_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_invocation_leases FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_invocation_leases_workspace ON provider_invocation_leases
  USING(workspace_id=app.current_workspace_id()) WITH CHECK(workspace_id=app.current_workspace_id());
REVOKE ALL ON provider_invocation_leases FROM PUBLIC;
GRANT SELECT,INSERT,DELETE ON provider_invocation_leases TO docoo_app;
