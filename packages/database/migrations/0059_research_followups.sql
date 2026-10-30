-- ADR-0039: a follow-up round of the research stage. The administrator asks for another round that
-- works only on the questions the output left weak or unanswered (and on questions the plan gained).
-- The row records which questions and which output the round follows; the rejection that starts the
-- attempt carries its token, so only that rejection starts a follow-up round. Append-only.
CREATE TABLE research_followups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 project_id uuid NOT NULL,
 stage_run_id uuid NOT NULL,
 output_id uuid NOT NULL,
 plan_id uuid NOT NULL,
 token text NOT NULL CHECK(token ~ '^[0-9a-f]{8}$'),
 questions jsonb NOT NULL CHECK(jsonb_typeof(questions)='array' AND jsonb_array_length(questions) BETWEEN 1 AND 12),
 requested_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
 FOREIGN KEY(stage_run_id,workspace_id) REFERENCES stage_runs(id,workspace_id),
 FOREIGN KEY(output_id,workspace_id) REFERENCES stage_outputs(id,workspace_id),
 FOREIGN KEY(plan_id,workspace_id) REFERENCES research_plans(id,workspace_id),
 UNIQUE(stage_run_id, token)
);
CREATE INDEX research_followups_stage_idx ON research_followups (stage_run_id, created_at);
--> statement-breakpoint
ALTER TABLE research_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_followups FORCE ROW LEVEL SECURITY;
REVOKE ALL ON research_followups FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT ON research_followups TO docoo_app;
CREATE TRIGGER research_followups_append_only BEFORE UPDATE OR DELETE ON research_followups
 FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE POLICY research_followups_read ON research_followups FOR SELECT
 USING(workspace_id=app.current_workspace_id() AND app.resource_access('project',workspace_id,project_id) IN ('VIEW','EDIT'));
CREATE POLICY research_followups_append ON research_followups FOR INSERT
 WITH CHECK(workspace_id=app.current_workspace_id() AND app.resource_access('project',workspace_id,project_id)='EDIT'
  AND requested_by=app.current_actor_id());
