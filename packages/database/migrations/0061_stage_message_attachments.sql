-- Files the administrator attaches to a message of the stage conversation (ADR-0031). Each is a
-- source of the project (uploaded and scanned like any other); the message keeps only a reference
-- {sourceId, versionId, title}, so the append-only row stays small and the file stays governed
-- by the source rules.
ALTER TABLE stage_messages
 ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]'::jsonb
 CHECK(jsonb_typeof(attachments) = 'array' AND jsonb_array_length(attachments) <= 5);
