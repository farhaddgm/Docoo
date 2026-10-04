-- Tenant isolation, per-admin chat ownership, link integrity, size caps and grants for the
-- Smart tables of 0015 (SMT-001..004): error tracker, chat and the walker issue ledger.
ALTER TABLE app_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_errors FORCE ROW LEVEL SECURITY;
ALTER TABLE smart_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE smart_conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE smart_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE smart_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE walker_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE walker_issues FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY app_errors_tenant_isolation ON app_errors
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
CREATE POLICY walker_issues_tenant_isolation ON walker_issues
  USING (workspace_id = app.current_workspace_id())
  WITH CHECK (workspace_id = app.current_workspace_id());
-- A chat belongs to the admin who started it; messages follow their conversation's owner.
CREATE POLICY smart_conversations_owner ON smart_conversations
  USING (workspace_id = app.current_workspace_id() AND user_id = app.current_actor_id())
  WITH CHECK (workspace_id = app.current_workspace_id() AND user_id = app.current_actor_id());
CREATE POLICY smart_messages_owner ON smart_messages
  USING (
    workspace_id = app.current_workspace_id()
    AND EXISTS (
      SELECT 1 FROM smart_conversations c
       WHERE c.id = smart_messages.conversation_id AND c.user_id = app.current_actor_id()
    )
  )
  WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND EXISTS (
      SELECT 1 FROM smart_conversations c
       WHERE c.id = smart_messages.conversation_id AND c.user_id = app.current_actor_id()
    )
  );
--> statement-breakpoint
ALTER TABLE app_errors ADD CONSTRAINT app_errors_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE smart_conversations ADD CONSTRAINT smart_conversations_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE smart_messages ADD CONSTRAINT smart_messages_id_workspace_uq UNIQUE (id, workspace_id);
--> statement-breakpoint
-- Every link stays inside one workspace; deleting the target only clears the link column.
ALTER TABLE app_errors
  ADD CONSTRAINT app_errors_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id)
  ON DELETE SET NULL (project_id);
ALTER TABLE smart_conversations
  ADD CONSTRAINT smart_conversations_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id)
  ON DELETE SET NULL (project_id);
ALTER TABLE smart_conversations
  ADD CONSTRAINT smart_conversations_error_workspace_fk
  FOREIGN KEY (error_id, workspace_id) REFERENCES app_errors (id, workspace_id)
  ON DELETE SET NULL (error_id);
ALTER TABLE smart_messages
  ADD CONSTRAINT smart_messages_conversation_workspace_fk
  FOREIGN KEY (conversation_id, workspace_id) REFERENCES smart_conversations (id, workspace_id)
  ON DELETE CASCADE;
ALTER TABLE walker_issues
  ADD CONSTRAINT walker_issues_message_workspace_fk
  FOREIGN KEY (source_message_id, workspace_id) REFERENCES smart_messages (id, workspace_id)
  ON DELETE SET NULL (source_message_id);
--> statement-breakpoint
-- Size caps keep a client-supplied or model-written value from bloating a row.
ALTER TABLE app_errors
  ADD CONSTRAINT app_errors_occurrences_positive CHECK (occurrences >= 1),
  ADD CONSTRAINT app_errors_message_size CHECK (char_length(message) <= 2000),
  ADD CONSTRAINT app_errors_stack_size CHECK (stack IS NULL OR char_length(stack) <= 16000);
ALTER TABLE smart_conversations
  ADD CONSTRAINT smart_conversations_text_size CHECK (char_length(route) <= 300 AND char_length(title) <= 300);
ALTER TABLE smart_messages
  ADD CONSTRAINT smart_messages_content_size CHECK (char_length(content) <= 20000);
ALTER TABLE walker_issues
  ADD CONSTRAINT walker_issues_title_size CHECK (char_length(title) BETWEEN 1 AND 300),
  ADD CONSTRAINT walker_issues_body_size CHECK (char_length(body) <= 50000),
  ADD CONSTRAINT walker_issues_note_size CHECK (char_length(note) <= 5000);
--> statement-breakpoint
CREATE TRIGGER app_errors_touch_updated_at BEFORE UPDATE ON app_errors
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER smart_conversations_touch_updated_at BEFORE UPDATE ON smart_conversations
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER walker_issues_touch_updated_at BEFORE UPDATE ON walker_issues
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
--> statement-breakpoint
-- Errors are grouped and re-opened, never deleted; chat messages are immutable (no UPDATE).
REVOKE ALL ON app_errors, smart_conversations, smart_messages, walker_issues FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT, UPDATE ON app_errors TO docoo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON smart_conversations, walker_issues TO docoo_app;
GRANT SELECT, INSERT ON smart_messages TO docoo_app;
