-- The web side of research runs as a bounded loop of rounds. The administrator sets the least and
-- the most searches and rounds, the pages that end the loop early, and how many pages are kept for
-- the research prompt (the fixed 12 is now the default). A maximum always wins over a minimum.
UPDATE setting_definitions
   SET value_schema = '{"type":"integer","minimum":1,"maximum":50}',
       description_fa = 'حداکثر تعداد جست‌وجوی وب در هر اجرای مرحلهٔ تحقیق (در همهٔ دورها روی هم)',
       description_en = 'Maximum number of web searches in one run of the research stage (all rounds together)'
 WHERE key = 'research.web_max_searches';

INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
 ('research.web_min_searches', '{"type":"integer","minimum":0,"maximum":50}', '1',
  '{workspace,topic,project}', false,
  'حداقل تعداد جست‌وجوی وب؛ تا رسیدن به آن، تحقیق با رسیدن به هدف منابع هم متوقف نمی‌شود (حداکثر همیشه مقدم است)',
  'Minimum number of web searches; the loop does not stop for a reached source target before it (the maximum always wins)'),
 ('research.web_min_rounds', '{"type":"integer","minimum":1,"maximum":10}', '1',
  '{workspace,topic,project}', false,
  'حداقل تعداد دور تحقیق وب',
  'Minimum number of web research rounds'),
 ('research.web_max_rounds', '{"type":"integer","minimum":1,"maximum":10}', '1',
  '{workspace,topic,project}', false,
  'حداکثر تعداد دور تحقیق وب؛ هر دور بر اساس خلأهای دور قبل جست‌وجو می‌کند',
  'Maximum number of web research rounds; each round searches for what the earlier ones left missing'),
 ('research.web_target_sources', '{"type":"integer","minimum":0,"maximum":100}', '0',
  '{workspace,topic,project}', false,
  'تعداد صفحهٔ منبعی که با رسیدن به آن (و پس از تأمین حداقل‌ها) جست‌وجو متوقف می‌شود؛ ۰ یعنی هرگز زودتر متوقف نشود',
  'Source pages after which the search stops (once the minimums are met); 0 never stops early'),
 ('research.web_source_limit', '{"type":"integer","minimum":1,"maximum":100}', '12',
  '{workspace,topic,project}', false,
  'حداکثر تعداد صفحهٔ وب که برای پرامپت تحقیق نگه داشته می‌شود',
  'Maximum number of web pages kept for the research prompt');
