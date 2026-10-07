-- Expose only aggregate counts, never credentials, identities, IPs or full audit records.
CREATE OR REPLACE FUNCTION app.security_signal_counts(since_time timestamptz DEFAULT NULL)
RETURNS TABLE(failed_logins bigint, access_changes bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT
 (SELECT count(*) FROM public.auth_events WHERE occurred_at > LEAST(COALESCE(since_time,now()-interval '15 minutes'),now()-interval '15 minutes') AND action IN ('login.failed','login.locked')),
 (SELECT count(*) FROM public.account_events WHERE occurred_at > COALESCE(since_time,now()-interval '1 day') AND action <> 'auth.google.login');
$$;
REVOKE ALL ON FUNCTION app.security_signal_counts(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.security_signal_counts(timestamptz) TO docoo_app;

--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='docoo_worker_agent') THEN CREATE ROLE docoo_worker_agent LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT; END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='docoo_worker_ingestion') THEN CREATE ROLE docoo_worker_ingestion LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT; END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='docoo_key_rotation') THEN CREATE ROLE docoo_key_rotation NOLOGIN; END IF;
END $$;
GRANT docoo_app TO docoo_worker_agent, docoo_worker_ingestion;
--> statement-breakpoint
-- session_user cannot be changed by these non-superuser logins, including through SET ROLE.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_application_auth ON users TO docoo_app USING (session_user NOT IN ('docoo_worker_agent','docoo_worker_ingestion')) WITH CHECK (session_user NOT IN ('docoo_worker_agent','docoo_worker_ingestion'));
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_application_auth ON sessions TO docoo_app USING (session_user NOT IN ('docoo_worker_agent','docoo_worker_ingestion')) WITH CHECK (session_user NOT IN ('docoo_worker_agent','docoo_worker_ingestion'));
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY reset_tokens_application_auth ON password_reset_tokens TO docoo_app USING (session_user NOT IN ('docoo_worker_agent','docoo_worker_ingestion')) WITH CHECK (session_user NOT IN ('docoo_worker_agent','docoo_worker_ingestion'));
--> statement-breakpoint
-- Keep the append-only credential history, permitting only privileged envelope rewrapping.
CREATE OR REPLACE FUNCTION app.guard_provider_secret_envelope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND current_setting('app.retention_purge',true)='on' THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND pg_has_role(current_user,'docoo_key_rotation','member') AND
 (to_jsonb(OLD)-ARRAY['wrapped_key','wrap_iv','wrap_tag','key_id'])=(to_jsonb(NEW)-ARRAY['wrapped_key','wrap_iv','wrap_tag','key_id']) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'provider secrets are append-only';
END $$;
DROP TRIGGER provider_secrets_append_only ON provider_secrets;
CREATE TRIGGER provider_secrets_append_only BEFORE UPDATE OR DELETE ON provider_secrets FOR EACH ROW EXECUTE FUNCTION app.guard_provider_secret_envelope();

--> statement-breakpoint
CREATE INDEX auth_events_security_time_idx ON auth_events(occurred_at) WHERE action IN ('login.failed','login.locked');
CREATE INDEX account_events_security_time_idx ON account_events(occurred_at) WHERE action <> 'auth.google.login';
