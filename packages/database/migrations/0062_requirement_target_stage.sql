-- ADR-0041: an output requirement can be aimed at one stage (analysis, research, ideas, documents,
-- evaluation) instead of the final output as a whole. NULL keeps the meaning every earlier row has:
-- it binds the final output and every stage reads it. `stage` stays what it was, the tab the
-- administrator was in when writing it. The table is append-only: an edit that moves a requirement
-- to another stage writes a new row, as any edit does.
ALTER TABLE output_requirements ADD COLUMN target_stage stage_kind;
CREATE INDEX output_requirements_target_idx ON output_requirements (project_id, target_stage);
