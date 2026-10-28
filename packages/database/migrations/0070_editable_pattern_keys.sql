-- The UUID is the immutable identity; the administrator may rename the catalog key.
-- Published versions and pinned project snapshots keep their original definitions.
CREATE OR REPLACE FUNCTION app.guard_problem_pattern_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, app AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS DISTINCT FROM app.current_actor_id() OR NEW.revision <> 1 OR NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'Invalid initial pattern';
    END IF;
  ELSE
    IF OLD.status = 'archived' OR (NEW.id, NEW.workspace_id, NEW.created_by, NEW.creation_key, NEW.creation_hash, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.workspace_id, OLD.created_by, OLD.creation_key, OLD.creation_hash, OLD.created_at) THEN
      RAISE EXCEPTION 'Pattern identity is immutable';
    END IF;
    IF NEW.definition IS DISTINCT FROM OLD.definition THEN
      IF NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'Draft changes require next revision'; END IF;
    ELSIF NEW.revision NOT IN (OLD.revision, OLD.revision + 1) THEN RAISE EXCEPTION 'Invalid draft revision';
    END IF;
  END IF;
  IF NEW.definition->>'key' IS DISTINCT FROM NEW.pattern_key OR NEW.definition->>'schemaVersion' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Pattern definition identity mismatch';
  END IF;
  RETURN NEW;
END $$;
