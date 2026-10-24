-- ADR-0040: the administrator's decision on a conflict the research reported (trust one of its
-- sources, or dismiss it as not real), and the setting that lists extra official web domains.
-- A decision belongs to the conflict (its fingerprint) within the stage run, so it survives the
-- join of a follow-up round onto the output; a newer decision on the same conflict replaces the
-- older one by being later. Append-only.
CREATE TABLE research_conflict_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 project_id uuid NOT NULL,
 stage_run_id uuid NOT NULL,
 output_id uuid NOT NULL,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{16}$'),
 decision text NOT NULL CHECK(decision IN ('trust','dismiss')),
 trusted_ref text CHECK(trusted_ref ~ '^[KW][0-9]{1,4}$'),
 note text NOT NULL DEFAULT '' CHECK(char_length(note) <= 500),
 decided_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((decision = 'trust') = (trusted_ref IS NOT NULL)),
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
 FOREIGN KEY(stage_run_id,workspace_id) REFERENCES stage_runs(id,workspace_id),
 FOREIGN KEY(output_id,workspace_id) REFERENCES stage_outputs(id,workspace_id)
);
CREATE INDEX research_conflict_decisions_idx ON research_conflict_decisions (stage_run_id, fingerprint, created_at);
--> statement-breakpoint
ALTER TABLE research_conflict_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_conflict_decisions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON research_conflict_decisions FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT ON research_conflict_decisions TO docoo_app;
CREATE TRIGGER research_conflict_decisions_append_only BEFORE UPDATE OR DELETE ON research_conflict_decisions
 FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE POLICY research_conflict_decisions_read ON research_conflict_decisions FOR SELECT
 USING(workspace_id=app.current_workspace_id() AND app.resource_access('project',workspace_id,project_id) IN ('VIEW','EDIT'));
CREATE POLICY research_conflict_decisions_append ON research_conflict_decisions FOR INSERT
 WITH CHECK(workspace_id=app.current_workspace_id() AND app.resource_access('project',workspace_id,project_id)='EDIT'
  AND decided_by=app.current_actor_id());
--> statement-breakpoint
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
 ('research.official_domains', '{"type":"array","items":{"type":"string","maxLength":120},"maxItems":50}', '[]',
  '{workspace,topic,project}', false,
  'دامنه‌های وبِ رسمی علاوه بر دامنه‌های دولتی، دانشگاهی و نهادهای بین‌المللی که خودکار رسمی حساب می‌شوند؛ هر خط یک دامنه (مثلاً سازمان ناظر صنعت شما)',
  'Web domains counted as official besides the built-in government, university and international ones; one domain per line (for example your industry regulator)');
