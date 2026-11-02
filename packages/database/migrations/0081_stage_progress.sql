-- ADR-0049: what a running research stage is doing right now, so the administrator sees "3
-- searches done, 8 pages found, question 2 still empty" instead of waiting in the dark. A stage
-- writes one small row per step; the project page reads the newest rows of the running attempt.
-- Append-only and best-effort: a missing row never fails a stage.
CREATE TABLE stage_progress (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 project_id uuid NOT NULL,
 stage_run_id uuid NOT NULL,
 attempt_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind ~ '^[a-z_]{1,40}$'),
 data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(pg_column_size(data) <= 4096),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
 FOREIGN KEY(stage_run_id,workspace_id) REFERENCES stage_runs(id,workspace_id),
 FOREIGN KEY(attempt_id,workspace_id) REFERENCES stage_attempts(id,workspace_id)
);
CREATE INDEX stage_progress_idx ON stage_progress (stage_run_id, created_at);
--> statement-breakpoint
ALTER TABLE stage_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_progress FORCE ROW LEVEL SECURITY;
REVOKE ALL ON stage_progress FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT ON stage_progress TO docoo_app;
CREATE TRIGGER stage_progress_append_only BEFORE UPDATE OR DELETE ON stage_progress
 FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE POLICY stage_progress_read ON stage_progress FOR SELECT
 USING(workspace_id=app.current_workspace_id() AND app.resource_access('project',workspace_id,project_id) IN ('VIEW','EDIT'));
CREATE POLICY stage_progress_append ON stage_progress FOR INSERT
 WITH CHECK(workspace_id=app.current_workspace_id() AND app.resource_access('project',workspace_id,project_id)='EDIT');
