-- ADR-0038: the research plan. Before the research stage runs, the administrator confirms the
-- questions it must answer. Plans are versions: an edit adds a new plan, and only a confirmation
-- of the newest plan lets research go on (a plan with no question is the choice to research as
-- before, from the problem statement). Everything is append-only history; nothing is edited in place.
CREATE TABLE research_plans (
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
CREATE TABLE research_questions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 plan_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 12),
 question text NOT NULL CHECK(char_length(btrim(question)) BETWEEN 5 AND 400),
 why text NOT NULL DEFAULT '' CHECK(char_length(why) <= 600),
 channel text NOT NULL CHECK(channel IN ('knowledge','web','both')),
 FOREIGN KEY(plan_id,workspace_id) REFERENCES research_plans(id,workspace_id),
 UNIQUE(plan_id, ordinal)
);
CREATE TABLE research_plan_confirmations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 plan_id uuid NOT NULL,
 confirmed_by uuid NOT NULL,
 note text NOT NULL DEFAULT '' CHECK(char_length(note) <= 1000),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(plan_id,workspace_id) REFERENCES research_plans(id,workspace_id),
 UNIQUE(plan_id)
);
--> statement-breakpoint
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['research_plans','research_questions','research_plan_confirmations'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,docoo_app',name);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO docoo_app',name);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation()',name||'_append_only',name);
 END LOOP;
END $$;
CREATE POLICY research_plans_read ON research_plans FOR SELECT
 USING(workspace_id=app.current_workspace_id() AND app.resource_access('project',workspace_id,project_id) IN ('VIEW','EDIT'));
CREATE POLICY research_plans_append ON research_plans FOR INSERT
 WITH CHECK(workspace_id=app.current_workspace_id() AND app.resource_access('project',workspace_id,project_id)='EDIT'
  AND (created_by IS NULL OR created_by=app.current_actor_id()));
-- Questions and confirmations follow the project of their plan.
CREATE POLICY research_questions_read ON research_questions FOR SELECT
 USING(workspace_id=app.current_workspace_id() AND EXISTS (SELECT 1 FROM research_plans p WHERE p.id=plan_id AND p.workspace_id=research_questions.workspace_id));
CREATE POLICY research_questions_append ON research_questions FOR INSERT
 WITH CHECK(workspace_id=app.current_workspace_id() AND EXISTS (SELECT 1 FROM research_plans p WHERE p.id=plan_id AND p.workspace_id=research_questions.workspace_id));
CREATE POLICY research_plan_confirmations_read ON research_plan_confirmations FOR SELECT
 USING(workspace_id=app.current_workspace_id() AND EXISTS (SELECT 1 FROM research_plans p WHERE p.id=plan_id AND p.workspace_id=research_plan_confirmations.workspace_id));
CREATE POLICY research_plan_confirmations_append ON research_plan_confirmations FOR INSERT
 WITH CHECK(workspace_id=app.current_workspace_id() AND confirmed_by=app.current_actor_id()
  AND EXISTS (SELECT 1 FROM research_plans p WHERE p.id=plan_id AND p.workspace_id=research_plan_confirmations.workspace_id
              AND app.resource_access('project',p.workspace_id,p.project_id)='EDIT'));
--> statement-breakpoint
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
 ('workflow.require_research_plan_confirmation', '{"type":"boolean"}', 'true',
  '{workspace,topic,project}', false,
  'تحقیق تا تأیید برنامهٔ تحقیق توسط ادمین شروع نمی‌شود (تأیید بدون پرسش یعنی تحقیق مثل قبل)',
  'Research does not start until the administrator confirms the research plan (confirming it with no question means researching as before)');
