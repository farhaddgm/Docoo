-- ADR-0058: xAI (Grok) as a fourth model provider. Only the brand is new: connections, secrets,
-- model catalog, prices and the invocation ledger already take any `provider_kind`.
ALTER TYPE provider_kind ADD VALUE IF NOT EXISTS 'xai';
