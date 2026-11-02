-- ADR-0053: research memory. When the administrator keeps a verified research finding, it becomes a
-- draft item of the organization's knowledge; this row remembers which finding became which item,
-- so the same finding is not kept twice and the research view can show it as kept. Append-only.
CREATE TABLE research_memory_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 project_id uuid NOT NULL,
 stage_run_id uuid NOT NULL,
 output_id uuid NOT NULL,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
 knowledge_id uuid NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
 FOREIGN KEY(stage_run_id,workspace_id) REFERENCES stage_runs(id,workspace_id),
 FOREIGN KEY(output_id,workspace_id) REFERENCES stage_outputs(id,workspace_id),
 FOREIGN KEY(knowledge_id,workspace_id) REFERENCES knowledge_items(id,workspace_id)
);
CREATE INDEX research_memory_items_fingerprint_idx ON research_memory_items (workspace_id, fingerprint);
CREATE INDEX research_memory_items_project_idx ON research_memory_items (project_id, created_at);
--> statement-breakpoint
ALTER TABLE research_memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_memory_items FORCE ROW LEVEL SECURITY;
REVOKE ALL ON research_memory_items FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT ON research_memory_items TO docoo_app;
CREATE TRIGGER research_memory_items_append_only BEFORE UPDATE OR DELETE ON research_memory_items
 FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE POLICY research_memory_items_read ON research_memory_items FOR SELECT
 USING(workspace_id=app.current_workspace_id() AND app.resource_access('project',workspace_id,project_id) IN ('VIEW','EDIT'));
CREATE POLICY research_memory_items_append ON research_memory_items FOR INSERT
 WITH CHECK(workspace_id=app.current_workspace_id() AND app.resource_access('project',workspace_id,project_id)='EDIT'
  AND created_by=app.current_actor_id());
