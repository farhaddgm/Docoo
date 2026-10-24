-- ADR-0036: an administrator can redo a finished stage. The redo is a new run that carries the
-- earlier completed stages over (their outputs stay where they were made) and runs the chosen
-- stage and the ones after it again.
ALTER TABLE workflow_runs ADD COLUMN redo_from_stage stage_kind;
--> statement-breakpoint
-- The stage run of an earlier run that a carried-over stage was copied from; its outputs, reviews
-- and attempts are read from there.
ALTER TABLE stage_runs ADD COLUMN carried_from_stage_run_id uuid;
