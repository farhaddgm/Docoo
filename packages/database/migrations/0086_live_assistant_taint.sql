-- ADR-0055 §4-4: what the assistant has read can carry instructions it must not obey (a stage
-- output, a problem statement, knowledge). The server remembers when a session last read such
-- content; for a while after, every change proposed in that session is confirmed more strictly
-- (a reversible change is treated as consequential), whatever the browser says.
ALTER TABLE live_sessions ADD COLUMN untrusted_read_at timestamptz;
