-- ADR-0032: Brain analysis with ranked findings, and administrator-approved actions.
-- Findings are produced by fixed rules and stored with the (append-only) report. A decision about
-- a proposed action is its own append-only row; nothing a Brain report proposes happens without it.
ALTER TABLE brain_reports
 ADD COLUMN analysis_version text,
 ADD COLUMN findings jsonb NOT NULL DEFAULT '[]'::jsonb,
 ADD COLUMN narrative text;
ALTER TABLE brain_reports ADD CONSTRAINT brain_reports_findings_shape
 CHECK (jsonb_typeof(findings) = 'array' AND jsonb_array_length(findings) <= 40);
ALTER TABLE brain_reports ADD CONSTRAINT brain_reports_narrative_length
 CHECK (narrative IS NULL OR char_length(narrative) <= 2000);
ALTER TABLE brain_reports ADD CONSTRAINT brain_reports_id_workspace_uq UNIQUE (id, workspace_id);
--> statement-breakpoint
CREATE TABLE brain_action_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 report_id uuid NOT NULL,
 finding_key text NOT NULL CHECK (char_length(finding_key) BETWEEN 1 AND 120),
 action_key text NOT NULL CHECK (char_length(action_key) BETWEEN 1 AND 120),
 action_kind text NOT NULL CHECK (action_kind IN ('audit_knowledge','request_revision','pause_project')),
 project_id uuid,
 target_type text NOT NULL CHECK (char_length(target_type) BETWEEN 1 AND 40),
 target_id uuid NOT NULL,
 status text NOT NULL CHECK (status IN ('running','done','failed','dismissed')),
 note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
 action jsonb NOT NULL CHECK (octet_length(action::text) <= 4000),
 result jsonb,
 decided_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 FOREIGN KEY (report_id, workspace_id) REFERENCES brain_reports(id, workspace_id) ON DELETE CASCADE,
 FOREIGN KEY (project_id, workspace_id) REFERENCES projects(id, workspace_id) ON DELETE CASCADE,
 CHECK ((status = 'running') = (completed_at IS NULL))
);
-- One decision per proposed action; a failed attempt does not use the action up.
CREATE UNIQUE INDEX brain_action_decisions_once
 ON brain_action_decisions (report_id, finding_key, action_key) WHERE status <> 'failed';
CREATE INDEX brain_action_decisions_report_idx ON brain_action_decisions (report_id, created_at);
--> statement-breakpoint
ALTER TABLE brain_action_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_action_decisions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON brain_action_decisions FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT ON brain_action_decisions TO docoo_app;
GRANT UPDATE (status, result, completed_at) ON brain_action_decisions TO docoo_app;
CREATE POLICY brain_action_decisions_read ON brain_action_decisions FOR SELECT
 USING (workspace_id = app.current_workspace_id());
CREATE POLICY brain_action_decisions_append ON brain_action_decisions FOR INSERT
 WITH CHECK (workspace_id = app.current_workspace_id() AND decided_by = app.current_actor_id());
CREATE POLICY brain_action_decisions_complete ON brain_action_decisions FOR UPDATE
 USING (workspace_id = app.current_workspace_id() AND decided_by = app.current_actor_id())
 WITH CHECK (workspace_id = app.current_workspace_id() AND decided_by = app.current_actor_id());
--> statement-breakpoint
-- The only change a decision accepts is its completion: running -> done | failed, with the result.
CREATE FUNCTION app.guard_brain_action_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  IF current_setting('app.retention_purge', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'brain_action_decisions is append-only';
 END IF;
 IF OLD.status <> 'running' OR NEW.status NOT IN ('done','failed')
    OR (to_jsonb(OLD) - ARRAY['status','result','completed_at'])
       IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['status','result','completed_at']) THEN
  RAISE EXCEPTION 'A Brain action decision cannot change after it completes';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER brain_action_decisions_guard BEFORE UPDATE OR DELETE ON brain_action_decisions
 FOR EACH ROW EXECUTE FUNCTION app.guard_brain_action_decision();
--> statement-breakpoint
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
 ('brain.narrative_enabled', '{"type":"boolean"}', 'false',
  '{workspace}', false,
  'Brain از یافته‌های گزارش یک خلاصهٔ ساده با مدل می‌نویسد؛ فقط نوع و تعداد یافته‌ها به مدل می‌رود، نه متن پروژه یا دانش. هر گزارش یک فراخوانی مدل هزینه دارد',
  'Brain writes a short plain-language summary of the report findings with the model; only the finding types and counts go to the model, never project or knowledge text. Each report costs one model call');
