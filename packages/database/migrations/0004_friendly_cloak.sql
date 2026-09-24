CREATE TYPE "public"."auth_event_action" AS ENUM('login.failed', 'login.succeeded', 'logout.succeeded');--> statement-breakpoint
ALTER TABLE "auth_events" ALTER COLUMN "action" SET DATA TYPE "public"."auth_event_action" USING "action"::"public"."auth_event_action";
--> statement-breakpoint
CREATE FUNCTION app.auth_user_workspaces()
RETURNS TABLE (id uuid, code text, name text, role membership_role)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT w.id, w.code, w.name, m.role
    FROM memberships m
    JOIN workspaces w ON w.id = m.workspace_id
   WHERE m.user_id = app.current_actor_id()
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_user_workspaces() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.auth_user_workspaces() TO docoo_app;
