-- A removed connection is only disabled (disabled_at), never deleted, and the providers page hides it.
-- The name index still counted it, so re-adding a connection under a removed one's name failed with
-- "A connection with this name already exists" while nothing visible used the name.
-- Names now need to be unique only among connections that are still in use.
DROP INDEX IF EXISTS provider_connections_name_uq;
CREATE UNIQUE INDEX provider_connections_name_uq ON provider_connections (workspace_id, lower(name)) WHERE disabled_at IS NULL;
