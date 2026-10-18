-- ADR-0026: the research stage can search the web with the search tool of the provider that is
-- already connected (OpenAI web search, Google Search grounding, Anthropic web search). On by
-- default; a failed search leaves the stage on its approved knowledge and says so.
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
 ('research.web_enabled', '{"type":"boolean"}', 'true',
  '{workspace,topic,project}', false,
  'تحقیق علاوه بر دانش تأییدشده، با ابزار جست‌وجوی خود ارائه‌دهندهٔ AI در وب هم می‌گردد؛ عبارت‌های جست‌وجو را مدل از صورت مسئله می‌سازد و به موتور جست‌وجوی ارائه‌دهنده می‌رود',
  'Besides approved knowledge, research also searches the web with the search tool of the AI provider; the model writes the search queries from the problem statement and they go to the provider’s search'),
 ('research.web_max_searches', '{"type":"integer","minimum":1,"maximum":10}', '5',
  '{workspace,topic,project}', false,
  'حداکثر تعداد جست‌وجوی وب در هر اجرای مرحلهٔ تحقیق',
  'Maximum number of web searches in one run of the research stage');
