-- ADR-0034: an administrator decides, per project and topic, whether the knowledge of a project
-- may be used by the other projects linked to the same topic. The default is 'none', which keeps
-- every project's own knowledge private as before.
ALTER TABLE project_topics
 ADD COLUMN knowledge_sharing text NOT NULL DEFAULT 'none'
 CHECK (knowledge_sharing IN ('none', 'selected', 'all'));
--> statement-breakpoint
-- The items a project shares when a topic link is set to 'selected'. Only the project's own
-- (project-scope) knowledge can be listed; the API checks that when an item is added.
CREATE TABLE project_shared_knowledge (
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 project_id uuid NOT NULL,
 item_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (project_id, item_id),
 FOREIGN KEY (project_id, workspace_id) REFERENCES projects(id, workspace_id) ON DELETE CASCADE,
 FOREIGN KEY (item_id, workspace_id) REFERENCES knowledge_items(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX project_shared_knowledge_item_idx ON project_shared_knowledge (item_id);
CREATE INDEX project_shared_knowledge_workspace_idx ON project_shared_knowledge (workspace_id);
--> statement-breakpoint
ALTER TABLE project_shared_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_shared_knowledge FORCE ROW LEVEL SECURITY;
REVOKE ALL ON project_shared_knowledge FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT, DELETE ON project_shared_knowledge TO docoo_app;
CREATE POLICY project_shared_knowledge_tenant_isolation ON project_shared_knowledge
 USING (workspace_id = app.current_workspace_id())
 WITH CHECK (workspace_id = app.current_workspace_id());
