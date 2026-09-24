CREATE TABLE "auth_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"identifier_digest" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"ip_hash" text,
	"user_agent_hash" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_events_actor_time_idx" ON "auth_events" USING btree ("actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "auth_events_correlation_idx" ON "auth_events" USING btree ("correlation_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.reject_auth_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'auth_events are append-only';
END
$$;
--> statement-breakpoint
CREATE TRIGGER auth_events_append_only
  BEFORE UPDATE OR DELETE ON auth_events
  FOR EACH ROW EXECUTE FUNCTION app.reject_auth_event_mutation();
--> statement-breakpoint
REVOKE ALL ON auth_events FROM PUBLIC, docoo_app;
--> statement-breakpoint
GRANT INSERT ON auth_events TO docoo_app;
