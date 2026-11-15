-- ADR-0059: the research stage can also search the web through an independent search service
-- (Exa, Tavily), next to the model's own search. The two services are only new brands of a
-- connection: secrets (encrypted, write-only, versioned), health, audit and disabling already
-- work for any `provider_kind`. A search connection carries what one query costs, entered by the
-- owner (the services bill per request, not per token).
ALTER TYPE provider_kind ADD VALUE IF NOT EXISTS 'exa';
ALTER TYPE provider_kind ADD VALUE IF NOT EXISTS 'tavily';

ALTER TABLE provider_connections ADD COLUMN IF NOT EXISTS cost_per_query_usd real;
ALTER TABLE provider_connections
  ADD CONSTRAINT provider_connections_query_cost_range
  CHECK (cost_per_query_usd IS NULL OR (cost_per_query_usd >= 0 AND cost_per_query_usd <= 1));

-- Off by default: sending a query to an outside service is the owner's explicit choice (P-07).
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
 ('research.independent_enabled', '{"type":"boolean"}', 'false',
  '{workspace,topic,project}', false,
  'تحقیق علاوه بر جست‌وجوی خود مدل، با سرویس‌های جست‌وجوی مستقل متصل‌شده (Exa و Tavily) هم در وب می‌گردد. فقط پرسش‌های تأییدشدهٔ طرح تحقیق (یا صورت مسئله) پس از بررسی حریم خصوصی به آن‌ها فرستاده می‌شود؛ هر سرویسی که متصل و فعال باشد استفاده می‌شود',
  'Besides the model’s own search, research also searches the web through the connected independent search services (Exa and Tavily). Only the confirmed research questions (or the problem statement) are sent, after a privacy check; every connected and enabled service is used'),
 ('research.independent_max_queries', '{"type":"integer","minimum":1,"maximum":12}', '5',
  '{workspace,topic,project}', false,
  'حداکثر تعداد پرسش (query) که در هر اجرای تحقیق به هر سرویس جست‌وجوی مستقل فرستاده می‌شود',
  'Maximum number of queries sent to each independent search service in one research run'),
 ('research.independent_results_per_query', '{"type":"integer","minimum":1,"maximum":20}', '8',
  '{workspace,topic,project}', false,
  'تعداد نتیجه‌ای که برای هر پرسش از سرویس جست‌وجوی مستقل خواسته می‌شود',
  'Number of results asked of an independent search service for each query');
