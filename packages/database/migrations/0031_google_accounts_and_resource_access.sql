ALTER TYPE membership_role ADD VALUE IF NOT EXISTS 'editor';
ALTER TYPE membership_role ADD VALUE IF NOT EXISTS 'viewer';
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE password_reset_tokens ADD COLUMN revoked_at timestamptz;
ALTER TABLE users ADD COLUMN account_role text NOT NULL DEFAULT 'super_admin'
  CHECK (account_role IN ('super_admin', 'editor', 'viewer'));
ALTER TABLE users ADD COLUMN login_method text NOT NULL DEFAULT 'PASSWORD'
  CHECK (login_method IN ('PASSWORD', 'GOOGLE', 'BOTH'));
ALTER TABLE users ADD COLUMN google_sub text;
ALTER TABLE users ADD COLUMN last_login_at timestamptz;
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
UPDATE topics t SET created_by=v.created_by FROM topic_versions v WHERE v.topic_id=t.id AND v.version=1;
UPDATE projects p SET created_by=a.actor_id FROM (
 SELECT DISTINCT ON (e.target_id) e.target_id,e.actor_id FROM audit_events e
 JOIN users u ON u.id=e.actor_id
 WHERE e.target_type='project' AND e.action IN ('project.create','project.clone','project.created')
 ORDER BY e.target_id,e.occurred_at,e.id
) a WHERE a.target_id=p.id;
CREATE UNIQUE INDEX users_google_sub_uq ON users(google_sub) WHERE google_sub IS NOT NULL;
CREATE FUNCTION app.normalize_gmail(email text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN lower(split_part(trim(email), '@', 2)) IN ('gmail.com','googlemail.com')
 THEN replace(split_part(split_part(lower(trim(email)), '@', 1), '+', 1), '.', '') || '@gmail.com'
 ELSE lower(trim(email)) END
$$;
CREATE UNIQUE INDEX users_google_email_uq ON users(app.normalize_gmail(email))
 WHERE login_method <> 'PASSWORD' AND deleted_at IS NULL;
CREATE TABLE resource_access (
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('topic', 'project')),
 resource_id uuid NOT NULL,
 access text NOT NULL CHECK (access IN ('VIEW', 'EDIT')),
 granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (workspace_id, user_id, kind, resource_id)
);
CREATE TABLE account_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
 target_id uuid,
 action text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}',
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER account_events_append_only BEFORE UPDATE OR DELETE ON account_events
 FOR EACH ROW EXECUTE FUNCTION app.reject_audit_mutation();
REVOKE ALL ON resource_access, account_events FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON resource_access TO docoo_app;
GRANT SELECT, INSERT ON account_events TO docoo_app;
ALTER TABLE resource_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_access FORCE ROW LEVEL SECURITY;
CREATE POLICY resource_access_tenant ON resource_access
 USING (workspace_id = app.current_workspace_id())
 WITH CHECK (workspace_id = app.current_workspace_id());
CREATE FUNCTION app.actor_role(wid uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT CASE WHEN (app.current_actor_id() = '00000000-0000-0000-0000-000000000000'::uuid OR current_setting('app.actor_id',true)='')
 THEN 'super_admin' ELSE (
 SELECT m.role::text FROM public.memberships m JOIN public.users u ON u.id=m.user_id
 WHERE m.workspace_id=wid AND m.user_id=app.current_actor_id()
 AND u.status='active' AND u.deleted_at IS NULL) END
$$;
CREATE FUNCTION app.resource_access(resource_kind text, wid uuid, rid uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE creator uuid; granted text;
BEGIN
 IF app.actor_role(wid)='super_admin' THEN RETURN 'EDIT'; END IF;
 IF app.actor_role(wid) IS NULL THEN RETURN NULL; END IF;
 IF resource_kind='topic' THEN
  SELECT created_by INTO creator FROM public.topics WHERE id=rid AND workspace_id=wid;
 ELSE
  SELECT created_by INTO creator FROM public.projects WHERE id=rid AND workspace_id=wid;
 END IF;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT r.access INTO granted FROM public.resource_access r
 WHERE r.workspace_id=wid AND r.user_id=app.current_actor_id()
 AND r.kind=resource_kind AND r.resource_id=rid;
 IF granted IS NOT NULL THEN RETURN granted; END IF;
 IF creator=app.current_actor_id() THEN RETURN 'EDIT'; END IF;
 RETURN NULL;
END
$$;
CREATE FUNCTION app.account_workspace_catalog() RETURNS TABLE(id uuid, code text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT w.id,w.code,w.name FROM public.workspaces w
 WHERE EXISTS (SELECT 1 FROM public.users u WHERE u.id=app.current_actor_id()
 AND u.status='active' AND u.deleted_at IS NULL AND u.account_role='super_admin')
$$;
CREATE FUNCTION app.is_account_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS (SELECT 1 FROM public.users WHERE id=app.current_actor_id()
 AND status='active' AND deleted_at IS NULL AND account_role='super_admin')
$$;
REVOKE ALL ON FUNCTION app.is_account_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_account_admin() TO docoo_app;
CREATE POLICY resource_access_account_read ON resource_access AS RESTRICTIVE FOR SELECT
 USING (user_id=app.current_actor_id() OR app.is_account_admin());
CREATE POLICY resource_access_account_insert ON resource_access AS RESTRICTIVE FOR INSERT
 WITH CHECK (app.is_account_admin());
CREATE POLICY resource_access_account_update ON resource_access AS RESTRICTIVE FOR UPDATE
 USING (app.is_account_admin()) WITH CHECK (app.is_account_admin());
CREATE POLICY resource_access_account_delete ON resource_access AS RESTRICTIVE FOR DELETE
 USING (app.is_account_admin());
REVOKE ALL ON FUNCTION app.actor_role(uuid), app.resource_access(text,uuid,uuid),
 app.account_workspace_catalog(), app.normalize_gmail(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.actor_role(uuid), app.resource_access(text,uuid,uuid),
 app.account_workspace_catalog(), app.normalize_gmail(text) TO docoo_app;

CREATE FUNCTION app.scoped_access(wid uuid, kind text, rid uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN app.actor_role(wid)='super_admin' THEN 'EDIT'
 WHEN kind IN ('project','topic') THEN app.resource_access(kind,wid,rid) END
$$;
CREATE FUNCTION app.knowledge_access(wid uuid, item uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN app.actor_role(wid)='super_admin' THEN 'EDIT' ELSE
 (SELECT CASE WHEN bool_or(app.scoped_access(wid,s.scope_type::text,s.scope_id)='EDIT') THEN 'EDIT'
 WHEN bool_or(app.scoped_access(wid,s.scope_type::text,s.scope_id)='VIEW') THEN 'VIEW' END
 FROM public.knowledge_scopes s WHERE s.workspace_id=wid AND s.item_id=item) END
$$;
CREATE FUNCTION app.knowledge_version_access(wid uuid, vid uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT app.knowledge_access(wid,v.item_id) FROM public.knowledge_versions v WHERE v.workspace_id=wid AND v.id=vid
$$;
CREATE FUNCTION app.source_access(wid uuid, aid uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT app.scoped_access(wid,a.scope_type::text,a.scope_id) FROM public.source_assets a WHERE a.workspace_id=wid AND a.id=aid
$$;
REVOKE ALL ON FUNCTION app.scoped_access(uuid,text,uuid),app.knowledge_access(uuid,uuid),app.knowledge_version_access(uuid,uuid),app.source_access(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.scoped_access(uuid,text,uuid),app.knowledge_access(uuid,uuid),app.knowledge_version_access(uuid,uuid),app.source_access(uuid,uuid) TO docoo_app;
CREATE POLICY account_workspace_read ON workspaces AS RESTRICTIVE FOR SELECT USING (app.actor_role(id) IS NOT NULL);
CREATE POLICY account_workspace_update ON workspaces AS RESTRICTIVE FOR UPDATE USING (app.actor_role(id)='super_admin') WITH CHECK (app.actor_role(id)='super_admin');
CREATE POLICY account_workspace_insert ON workspaces AS RESTRICTIVE FOR INSERT WITH CHECK (app.is_account_admin());
CREATE POLICY account_workspace_delete ON workspaces AS RESTRICTIVE FOR DELETE USING (app.actor_role(id)='super_admin');

DO $$
DECLARE t record; scope text; read_scope text; write_scope text; is_root boolean;
BEGIN
 FOR t IN SELECT c.table_name FROM information_schema.columns c
 JOIN pg_class pc ON pc.relname=c.table_name JOIN pg_namespace pn ON pn.oid=pc.relnamespace
 WHERE c.table_schema='public' AND c.column_name='workspace_id' AND pn.nspname='public' AND pc.relrowsecurity
 AND c.table_name NOT IN ('memberships','resource_access')
 LOOP
  scope := NULL; is_root := t.table_name IN ('topics','projects');
  CASE t.table_name
  WHEN 'agent_roles' THEN scope := 'CASE WHEN app.actor_role(workspace_id) IS NOT NULL THEN ''VIEW'' END';
  WHEN 'agent_definition_versions' THEN scope := 'CASE WHEN project_id IS NULL AND app.actor_role(workspace_id) IS NOT NULL THEN ''VIEW'' ELSE app.resource_access(''project'',workspace_id,project_id) END';
  WHEN 'topics' THEN scope := 'app.resource_access(''topic'',workspace_id,id)';
  WHEN 'projects' THEN scope := 'app.resource_access(''project'',workspace_id,id)';
  WHEN 'source_assets' THEN scope := 'app.scoped_access(workspace_id,scope_type::text,scope_id)';
  WHEN 'source_versions' THEN scope := 'app.source_access(workspace_id,asset_id)';
  WHEN 'source_segments' THEN scope := '(SELECT app.source_access(v.workspace_id,v.asset_id) FROM source_versions v WHERE v.workspace_id=source_segments.workspace_id AND v.id=source_version_id)';
  WHEN 'knowledge_items' THEN scope := 'app.knowledge_access(workspace_id,id)';
  WHEN 'knowledge_scopes' THEN scope := 'app.scoped_access(workspace_id,scope_type::text,scope_id)';
  WHEN 'knowledge_versions' THEN scope := 'app.knowledge_access(workspace_id,item_id)';
  WHEN 'citations' THEN scope := '(SELECT app.knowledge_version_access(c.workspace_id,c.knowledge_version_id) FROM claims c WHERE c.workspace_id=citations.workspace_id AND c.id=claim_id)';
  WHEN 'knowledge_conflicts' THEN scope := '(SELECT CASE WHEN app.knowledge_version_access(a.workspace_id,a.knowledge_version_id)=''EDIT'' AND app.knowledge_version_access(b.workspace_id,b.knowledge_version_id)=''EDIT'' THEN ''EDIT'' WHEN app.knowledge_version_access(a.workspace_id,a.knowledge_version_id) IS NOT NULL AND app.knowledge_version_access(b.workspace_id,b.knowledge_version_id) IS NOT NULL THEN ''VIEW'' END FROM claims a JOIN claims b ON a.workspace_id=b.workspace_id WHERE a.workspace_id=knowledge_conflicts.workspace_id AND a.id=claim_a_id AND b.id=claim_b_id)';
  WHEN 'audit_events' THEN scope := 'CASE WHEN project_id IS NOT NULL THEN app.resource_access(''project'',workspace_id,project_id) WHEN target_type IN (''project'',''topic'') THEN app.resource_access(target_type,workspace_id,target_id) END';
  WHEN 'config_assignments' THEN scope := 'CASE WHEN scope_type=''workspace'' AND app.actor_role(workspace_id) IS NOT NULL THEN ''VIEW'' ELSE app.scoped_access(workspace_id,scope_type::text,scope_id) END';
  WHEN 'config_snapshots' THEN scope := 'CASE WHEN subject_type=''workspace'' AND app.actor_role(workspace_id) IS NOT NULL THEN ''VIEW'' ELSE app.scoped_access(workspace_id,subject_type::text,subject_id) END';
  WHEN 'business_snapshots' THEN scope := '(SELECT CASE WHEN bool_or(app.resource_access(''project'',p.workspace_id,p.project_id)=''EDIT'') THEN ''EDIT'' WHEN bool_or(app.resource_access(''project'',p.workspace_id,p.project_id) IS NOT NULL) THEN ''VIEW'' END FROM project_businesses p WHERE p.workspace_id=business_snapshots.workspace_id AND p.snapshot_id=business_snapshots.id)';
  WHEN 'command_receipts' THEN scope := 'CASE WHEN created_by=app.current_actor_id() AND app.actor_role(workspace_id) IS NOT NULL THEN ''EDIT'' END';
  WHEN 'document_versions' THEN scope := '(SELECT app.resource_access(''project'',d.workspace_id,d.project_id) FROM documents d WHERE d.workspace_id=document_versions.workspace_id AND d.id=document_id)';
  WHEN 'document_artifacts' THEN scope := '(SELECT app.resource_access(''project'',d.workspace_id,d.project_id) FROM documents d WHERE d.workspace_id=document_artifacts.workspace_id AND d.id=document_id)';
  WHEN 'evaluations' THEN scope := '(SELECT app.resource_access(''project'',d.workspace_id,d.project_id) FROM documents d WHERE d.workspace_id=evaluations.workspace_id AND d.id=document_id)';
  WHEN 'evaluation_findings' THEN scope := '(SELECT app.resource_access(''project'',d.workspace_id,d.project_id) FROM evaluations e JOIN documents d ON d.id=e.document_id AND d.workspace_id=e.workspace_id WHERE e.workspace_id=evaluation_findings.workspace_id AND e.id=evaluation_id)';
  WHEN 'evaluation_exceptions' THEN scope := '(SELECT app.resource_access(''project'',d.workspace_id,d.project_id) FROM evaluations e JOIN documents d ON d.id=e.document_id AND d.workspace_id=e.workspace_id WHERE e.workspace_id=evaluation_exceptions.workspace_id AND e.id=evaluation_id)';
  WHEN 'stage_attempts' THEN scope := '(SELECT app.resource_access(''project'',s.workspace_id,s.project_id) FROM stage_runs s WHERE s.workspace_id=stage_attempts.workspace_id AND s.id=stage_run_id)';
  WHEN 'stage_outputs' THEN scope := '(SELECT app.resource_access(''project'',s.workspace_id,s.project_id) FROM stage_runs s WHERE s.workspace_id=stage_outputs.workspace_id AND s.id=stage_run_id)';
  WHEN 'stage_reviews' THEN scope := '(SELECT app.resource_access(''project'',s.workspace_id,s.project_id) FROM stage_runs s WHERE s.workspace_id=stage_reviews.workspace_id AND s.id=stage_run_id)';
  WHEN 'gate_decisions' THEN scope := '(SELECT app.resource_access(''project'',s.workspace_id,s.project_id) FROM stage_runs s WHERE s.workspace_id=gate_decisions.workspace_id AND s.id=stage_run_id)';
  ELSE
   IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t.table_name AND column_name='project_id') THEN
    scope := 'app.resource_access(''project'',workspace_id,project_id)';
   ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t.table_name AND column_name='topic_id') THEN
    scope := 'app.resource_access(''topic'',workspace_id,topic_id)';
   ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t.table_name AND column_name='knowledge_version_id') THEN
    scope := 'app.knowledge_version_access(workspace_id,knowledge_version_id)';
   END IF;
  END CASE;
  scope := format('CASE WHEN app.actor_role(workspace_id)=''super_admin'' THEN ''EDIT'' ELSE (%s) END',COALESCE(scope,'NULL::text'));
  read_scope := format('(%s) IS NOT NULL',scope); write_scope := format('(%s)=''EDIT''',scope);
  IF is_root THEN
   -- INSERT ... RETURNING must see the new tuple before a helper can query it.
   read_scope := read_scope || ' OR (app.actor_role(workspace_id)=''editor'' AND created_by=app.current_actor_id())';
   write_scope := write_scope || ' OR (app.actor_role(workspace_id)=''editor'' AND created_by=app.current_actor_id())';
  ELSIF t.table_name='knowledge_items' THEN
   -- Only the new, versionless tuple needs a creation exception. Testing visible
   -- scopes with NOT EXISTS would mistake hidden scopes for an unscoped item.
   read_scope := read_scope || ' OR (created_by=app.current_actor_id() AND current_version_id IS NULL AND (app.actor_role(workspace_id)=''editor'' OR (app.actor_role(workspace_id)=''viewer'' AND EXISTS (SELECT 1 FROM resource_access r WHERE r.workspace_id=knowledge_items.workspace_id AND r.user_id=app.current_actor_id() AND r.access=''EDIT''))))';
   write_scope := write_scope || ' OR (created_by=app.current_actor_id() AND current_version_id IS NULL AND (app.actor_role(workspace_id)=''editor'' OR (app.actor_role(workspace_id)=''viewer'' AND EXISTS (SELECT 1 FROM resource_access r WHERE r.workspace_id=knowledge_items.workspace_id AND r.user_id=app.current_actor_id() AND r.access=''EDIT''))))';
  END IF;
  EXECUTE format('CREATE POLICY account_scope_read ON %I AS RESTRICTIVE FOR SELECT USING (%s)',t.table_name,read_scope);
  EXECUTE format('CREATE POLICY account_scope_update ON %I AS RESTRICTIVE FOR UPDATE USING ((%s)=''EDIT'') WITH CHECK ((%s)=''EDIT'')',t.table_name,scope,scope);
  IF is_root THEN
   EXECUTE format('CREATE POLICY account_scope_delete ON %I AS RESTRICTIVE FOR DELETE USING (app.actor_role(workspace_id)=''super_admin'')',t.table_name);
  ELSE
   EXECUTE format('CREATE POLICY account_scope_delete ON %I AS RESTRICTIVE FOR DELETE USING ((%s)=''EDIT'')',t.table_name,scope);
  END IF;
  IF t.table_name='audit_events' THEN
   write_scope := write_scope || ' OR (actor_id=app.current_actor_id() AND app.actor_role(workspace_id) IS NOT NULL)';
  END IF;
  EXECUTE format('CREATE POLICY account_scope_insert ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (%s)',t.table_name,write_scope);
 END LOOP;
END
$$;
