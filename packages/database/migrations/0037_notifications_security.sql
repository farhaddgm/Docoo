-- Tenant isolation, state rules, grants, the triggers that make the notifications of 0036 and the
-- settings of the mailer (ADR-0025). Notifications are made by triggers on the tables that hold
-- the events, so a new place that creates a human task cannot forget to notify.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notifications_tenant_isolation ON notifications
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
--> statement-breakpoint
ALTER TABLE notifications
  ADD CONSTRAINT notifications_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE notifications ADD CONSTRAINT notifications_values CHECK (
  char_length(kind) BETWEEN 1 AND 60
  AND jsonb_typeof(payload) = 'object'
  AND email_status IN ('pending', 'sent', 'skipped', 'failed')
  AND email_attempts >= 0
  AND (email_status <> 'sent' OR email_sent_at IS NOT NULL)
  AND (read_by IS NULL OR read_at IS NOT NULL)
);
--> statement-breakpoint
-- Who needs to be told is the application's business; the rows themselves are append-and-mark:
-- the event never changes, only the read mark and the mail bookkeeping.
REVOKE ALL ON notifications FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT ON notifications TO docoo_app;
GRANT UPDATE (read_at, read_by, email_status, email_attempts, email_claimed_at, email_sent_at)
  ON notifications TO docoo_app;
--> statement-breakpoint
CREATE FUNCTION app.notify_human_task()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO notifications (workspace_id, kind, project_id, ref_id, payload)
  VALUES (NEW.workspace_id, left(NEW.kind, 60), NEW.project_id, NEW.id,
          jsonb_build_object('stageRunId', NEW.stage_run_id));
  RETURN NEW;
END
$$;
CREATE TRIGGER human_tasks_notify
  AFTER INSERT ON human_tasks
  FOR EACH ROW EXECUTE FUNCTION app.notify_human_task();
--> statement-breakpoint
CREATE FUNCTION app.notify_run_completed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO notifications (workspace_id, kind, project_id, ref_id)
  VALUES (NEW.workspace_id, 'run_completed', NEW.project_id, NEW.id);
  RETURN NEW;
END
$$;
CREATE TRIGGER workflow_runs_notify_completed
  AFTER UPDATE OF status ON workflow_runs
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION app.notify_run_completed();
--> statement-breakpoint
CREATE FUNCTION app.notify_writing_done()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO notifications (workspace_id, kind, project_id, ref_id, payload)
  VALUES (NEW.workspace_id, 'writing_' || NEW.status, NEW.project_id, NEW.id,
          jsonb_build_object('documentId', NEW.document_id));
  RETURN NEW;
END
$$;
CREATE TRIGGER document_writings_notify_done
  AFTER UPDATE OF status ON document_writings
  FOR EACH ROW
  WHEN (NEW.status IN ('succeeded', 'failed') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION app.notify_writing_done();
--> statement-breakpoint
-- The mailer runs without a workspace in hand: this lists the workspaces that have mail to send.
CREATE FUNCTION app.workspaces_with_pending_mail()
RETURNS TABLE (workspace_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT n.workspace_id FROM notifications n WHERE n.email_status = 'pending' LIMIT 50
$$;
REVOKE ALL ON FUNCTION app.workspaces_with_pending_mail() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.workspaces_with_pending_mail() TO docoo_app;
--> statement-breakpoint
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
  ('notifications.email_enabled', '{"type":"boolean"}', 'false',
   '{workspace}', false,
   'ارسال ایمیل برای اعلان‌ها (نیازمند تنظیم SMTP روی سرور)؛ ایمیل فقط نوع رویداد و کد پروژه را دارد، نه متن پروژه',
   'Send an email for notifications (needs SMTP on the server); the mail names the kind of event and the project code, never project text'),
  ('notifications.email_kinds',
   '{"type":"array","items":{"type":"string","enum":["gate_review","analysis_answers","agent_question","attempt_limit","provider_failure","configuration","cost_limit","run_completed","writing_succeeded","writing_failed"]},"maxItems":10}',
   '["gate_review","analysis_answers","agent_question","attempt_limit","provider_failure","configuration","cost_limit","run_completed","writing_succeeded","writing_failed"]',
   '{workspace}', false,
   'رویدادهایی که ایمیل می‌شوند (خالی یعنی همه)',
   'The events that are emailed (empty means all)');
