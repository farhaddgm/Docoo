-- Consumers may check catalog availability without reading administrator drafts.
CREATE FUNCTION app.problem_pattern_is_selectable(p_pattern_id uuid,p_workspace_id uuid,p_lock boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
BEGIN
  IF p_workspace_id IS DISTINCT FROM app.current_workspace_id() OR NOT EXISTS(
    SELECT 1 FROM public.memberships WHERE workspace_id=p_workspace_id AND user_id=app.current_actor_id()
  ) THEN RETURN false; END IF;
  IF p_lock THEN
    PERFORM 1 FROM public.problem_patterns WHERE id=p_pattern_id AND workspace_id=p_workspace_id AND status<>'archived' FOR SHARE;
    RETURN FOUND;
  END IF;
  RETURN EXISTS(SELECT 1 FROM public.problem_patterns WHERE id=p_pattern_id AND workspace_id=p_workspace_id AND status<>'archived');
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.problem_pattern_is_selectable(uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.problem_pattern_is_selectable(uuid,uuid,boolean) TO docoo_app;
