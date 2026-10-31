-- ADR-0043: a project can say, as it is created, what the administrator expects to receive
-- ("a 90-day plan", "a product specification"). The analyst reads it as information, so its
-- questions go to the gap between the problem and that output, and the AI proposal of the
-- deliverable plan starts from it. Empty means the administrator did not say, which is what every
-- earlier project is.
ALTER TABLE projects
  ADD COLUMN expected_output text NOT NULL DEFAULT ''
  CONSTRAINT projects_expected_output_length CHECK (char_length(expected_output) <= 5000);
