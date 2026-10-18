-- ADR-0031 P2: the plan of expected deliverables of a project. Plans are versions: an edit adds a
-- new plan, and only a confirmation of the newest plan lets ideation go on. Everything here is
-- append-only history; nothing is edited in place.
CREATE TABLE deliverable_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 project_id uuid NOT NULL,
 version_no integer NOT NULL CHECK(version_no >= 1),
 source text NOT NULL CHECK(source IN ('system','ai','admin')),
 invocation_id uuid REFERENCES model_invocations(id) ON DELETE SET NULL,
 created_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
 UNIQUE(project_id, version_no),
 UNIQUE(id, workspace_id)
);
CREATE TABLE deliverable_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 plan_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 20),
 kind text NOT NULL CHECK(kind IN ('strategy_document','product_documentation','technical_prototype')),
 title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 2 AND 200),
 purpose text NOT NULL DEFAULT '' CHECK(char_length(purpose) <= 2000),
 scope_in text NOT NULL DEFAULT '' CHECK(char_length(scope_in) <= 2000),
 scope_out text NOT NULL DEFAULT '' CHECK(char_length(scope_out) <= 2000),
 FOREIGN KEY(plan_id,workspace_id) REFERENCES deliverable_plans(id,workspace_id),
 UNIQUE(plan_id, ordinal)
);
CREATE TABLE deliverable_confirmations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 plan_id uuid NOT NULL,
 confirmed_by uuid NOT NULL,
 note text NOT NULL DEFAULT '' CHECK(char_length(note) <= 1000),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(plan_id,workspace_id) REFERENCES deliverable_plans(id,workspace_id),
 UNIQUE(plan_id)
);
--> statement-breakpoint
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['deliverable_plans','deliverable_items','deliverable_confirmations'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,docoo_app',name);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO docoo_app',name);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation()',name||'_append_only',name);
 END LOOP;
END $$;
CREATE POLICY deliverable_plans_read ON deliverable_plans FOR SELECT
 USING(workspace_id=app.current_workspace_id() AND app.resource_access('project',workspace_id,project_id) IN ('VIEW','EDIT'));
CREATE POLICY deliverable_plans_append ON deliverable_plans FOR INSERT
 WITH CHECK(workspace_id=app.current_workspace_id() AND app.resource_access('project',workspace_id,project_id)='EDIT'
  AND (created_by IS NULL OR created_by=app.current_actor_id()));
-- Items and confirmations follow the project of their plan.
CREATE POLICY deliverable_items_read ON deliverable_items FOR SELECT
 USING(workspace_id=app.current_workspace_id() AND EXISTS (SELECT 1 FROM deliverable_plans p WHERE p.id=plan_id AND p.workspace_id=deliverable_items.workspace_id));
CREATE POLICY deliverable_items_append ON deliverable_items FOR INSERT
 WITH CHECK(workspace_id=app.current_workspace_id() AND EXISTS (SELECT 1 FROM deliverable_plans p WHERE p.id=plan_id AND p.workspace_id=deliverable_items.workspace_id));
CREATE POLICY deliverable_confirmations_read ON deliverable_confirmations FOR SELECT
 USING(workspace_id=app.current_workspace_id() AND EXISTS (SELECT 1 FROM deliverable_plans p WHERE p.id=plan_id AND p.workspace_id=deliverable_confirmations.workspace_id));
CREATE POLICY deliverable_confirmations_append ON deliverable_confirmations FOR INSERT
 WITH CHECK(workspace_id=app.current_workspace_id() AND confirmed_by=app.current_actor_id()
  AND EXISTS (SELECT 1 FROM deliverable_plans p WHERE p.id=plan_id AND p.workspace_id=deliverable_confirmations.workspace_id
              AND app.resource_access('project',p.workspace_id,p.project_id)='EDIT'));
--> statement-breakpoint
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
 ('workflow.require_deliverable_confirmation', '{"type":"boolean"}', 'true',
  '{workspace,topic,project}', false,
  'ایده‌پردازی تا تأیید برنامهٔ خروجی‌ها توسط ادمین شروع نمی‌شود',
  'Ideation does not start until the administrator confirms the plan of expected deliverables');
