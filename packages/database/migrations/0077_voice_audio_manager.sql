-- ADR-0046 step 3: the owner can see that recordings exist and remove them (the "clear all
-- recordings" button and the sweep of expired ones), but the application never lets anyone but the
-- speaker hear them. Reading the row gives the owner only metadata through the API.
CREATE POLICY conversation_audio_manager_read ON conversation_audio
 FOR SELECT USING (workspace_id = app.current_workspace_id() AND EXISTS (
  SELECT 1 FROM public.memberships m WHERE m.workspace_id = conversation_audio.workspace_id
   AND m.user_id = app.current_actor_id() AND m.role = 'super_admin'));
CREATE POLICY conversation_audio_manager_delete ON conversation_audio
 FOR DELETE USING (workspace_id = app.current_workspace_id() AND EXISTS (
  SELECT 1 FROM public.memberships m WHERE m.workspace_id = conversation_audio.workspace_id
   AND m.user_id = app.current_actor_id() AND m.role = 'super_admin'));
--> statement-breakpoint
-- Only the link to the message may change after a recording is stored (and a row lock needs some
-- update privilege); the file, its owner and its expiry never change.
GRANT UPDATE (message_id) ON conversation_audio TO docoo_app;
