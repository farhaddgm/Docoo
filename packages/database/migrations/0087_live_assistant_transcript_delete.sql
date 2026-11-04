-- ADR-0055 §4-10: the owner can delete a conversation's text, and the text expires after the
-- retention the owner set. The transcript stays append-only: a line is still never edited, and a
-- delete is refused unless the statement runs in a transaction that asked for a purge
-- (app.retention_purge), which only the two deliberate paths in the application do. A person can
-- only delete their own lines (row security), and the proposals and the audit trail stay.
GRANT DELETE ON live_messages TO docoo_app;
CREATE POLICY live_messages_own_delete ON live_messages
 FOR DELETE USING (workspace_id = app.current_workspace_id() AND user_id = app.current_actor_id());
