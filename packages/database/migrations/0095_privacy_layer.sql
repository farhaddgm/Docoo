-- Privacy layer in front of every model call (ADR-0059).
-- A project chooses what happens to private values (emails, phone numbers, national ids, card
-- numbers, IBANs and its own blocked words) before a request leaves for a model provider:
-- 'mask' replaces them by placeholders and puts them back in the answer, 'block' refuses to send,
-- 'off' sends as written. Masking is the default. The blocked words are the project's own list.
ALTER TABLE projects
  ADD COLUMN privacy_mode text NOT NULL DEFAULT 'mask',
  ADD COLUMN privacy_blocked_words text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT projects_privacy_mode_ck CHECK (privacy_mode IN ('off', 'mask', 'block')),
  ADD CONSTRAINT projects_privacy_blocked_words_ck CHECK (cardinality(privacy_blocked_words) <= 100);

-- What a call masked: the count and the kinds, never a value.
ALTER TABLE model_invocations
  ADD COLUMN privacy_masked_count integer NOT NULL DEFAULT 0,
  ADD COLUMN privacy_masked_kinds jsonb;
