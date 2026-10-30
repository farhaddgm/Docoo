-- ADR-0037: output requirements. What the administrator says the final output must contain
-- ("must") or must not contain ("must_not"), written at any moment of a project, from a stage tab,
-- a chat message or the requirements tab. Everything is append-only: an edit is a new requirement
-- that replaces the old one, and a withdrawal or a replacement is a row of its own, so the history
-- of what was asked, and when, is never lost.
CREATE TABLE output_requirements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 project_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('must','must_not')),
 body text NOT NULL CHECK(char_length(btrim(body)) BETWEEN 3 AND 1000),
 source text NOT NULL CHECK(source IN ('admin','chat')),
 -- The stage tab the administrator was in when writing it (null: the requirements tab).
 stage stage_kind,
 -- The chat message it was taken from; present exactly for the source "chat".
 message_id uuid REFERENCES stage_messages(id),
 supersedes_id uuid,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
 FOREIGN KEY(supersedes_id,workspace_id) REFERENCES output_requirements(id,workspace_id),
 UNIQUE(id, workspace_id),
 CHECK((source='chat') = (message_id IS NOT NULL))
);
CREATE INDEX output_requirements_project_idx ON output_requirements (project_id, created_at);
CREATE INDEX output_requirements_message_idx ON output_requirements (message_id) WHERE message_id IS NOT NULL;
CREATE TABLE output_requirement_withdrawals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 project_id uuid NOT NULL,
 requirement_id uuid NOT NULL,
 -- "withdrawn": the administrator no longer wants it; "replaced": an edit wrote a newer one.
 reason_kind text NOT NULL CHECK(reason_kind IN ('withdrawn','replaced')),
 reason text NOT NULL DEFAULT '' CHECK(char_length(reason) <= 500),
 withdrawn_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
 FOREIGN KEY(requirement_id,workspace_id) REFERENCES output_requirements(id,workspace_id),
 UNIQUE(requirement_id)
);
-- One coverage check: a batch (check_id) with one row per active requirement at that moment.
CREATE TABLE output_requirement_checks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 project_id uuid NOT NULL,
 check_id uuid NOT NULL,
 requirement_id uuid NOT NULL,
 verdict text NOT NULL CHECK(verdict IN ('covered','partial','not_covered','unknown')),
 evidence text NOT NULL DEFAULT '' CHECK(char_length(evidence) <= 1000),
 found_in text NOT NULL DEFAULT '' CHECK(char_length(found_in) <= 200),
 invocation_id uuid REFERENCES model_invocations(id) ON DELETE SET NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
 FOREIGN KEY(requirement_id,workspace_id) REFERENCES output_requirements(id,workspace_id),
 UNIQUE(check_id, requirement_id)
);
CREATE INDEX output_requirement_checks_project_idx ON output_requirement_checks (project_id, created_at DESC);
--> statement-breakpoint
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['output_requirements','output_requirement_withdrawals','output_requirement_checks'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,docoo_app',name);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO docoo_app',name);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation()',name||'_append_only',name);
  EXECUTE format($p$CREATE POLICY %I ON %I FOR SELECT
    USING(workspace_id=app.current_workspace_id() AND app.resource_access('project',workspace_id,project_id) IN ('VIEW','EDIT'))$p$,name||'_read',name);
 END LOOP;
END $$;
CREATE POLICY output_requirements_append ON output_requirements FOR INSERT
 WITH CHECK(workspace_id=app.current_workspace_id() AND app.resource_access('project',workspace_id,project_id)='EDIT'
  AND created_by=app.current_actor_id()
  AND (message_id IS NULL OR EXISTS (SELECT 1 FROM stage_messages m
        WHERE m.id=message_id AND m.workspace_id=output_requirements.workspace_id AND m.project_id=output_requirements.project_id)));
CREATE POLICY output_requirement_withdrawals_append ON output_requirement_withdrawals FOR INSERT
 WITH CHECK(workspace_id=app.current_workspace_id() AND app.resource_access('project',workspace_id,project_id)='EDIT'
  AND withdrawn_by=app.current_actor_id()
  AND EXISTS (SELECT 1 FROM output_requirements r WHERE r.id=requirement_id AND r.workspace_id=output_requirement_withdrawals.workspace_id
              AND r.project_id=output_requirement_withdrawals.project_id));
CREATE POLICY output_requirement_checks_append ON output_requirement_checks FOR INSERT
 WITH CHECK(workspace_id=app.current_workspace_id() AND app.resource_access('project',workspace_id,project_id)='EDIT'
  AND created_by=app.current_actor_id()
  AND EXISTS (SELECT 1 FROM output_requirements r WHERE r.id=requirement_id AND r.workspace_id=output_requirement_checks.workspace_id
              AND r.project_id=output_requirement_checks.project_id));
