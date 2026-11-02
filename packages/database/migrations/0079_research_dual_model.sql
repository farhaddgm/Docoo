-- ADR-0047: dual-model research. For a project where it matters, the web side of the research
-- stage can be searched by a second model (any connection, also one of the same provider) and a
-- judge can report where the two disagree; the disagreements are decided by the administrator on
-- the conflicts page. Off by default; the one-model research is untouched.
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
 ('research.dual_enabled', '{"type":"boolean"}', 'false',
  '{workspace,topic,project}', false,
  'تحقیق دومدلی: جست‌وجوی وب را یک مدل دوم هم انجام می‌دهد و یک داور اختلاف یافته‌های دو مدل را گزارش می‌کند؛ تصمیم اختلاف‌ها با ادمین است. هزینه و تعداد فراخوانی بیشتر می‌شود و پرسش‌ها به هر دو ارائه‌دهنده می‌رود',
  'Dual-model research: a second model also searches the web and a judge reports where the two disagree; the administrator decides the disagreements. It costs more calls, and the questions go to both providers'),
 ('research.dual_connection_id', '{"type":"string","pattern":"^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$"}', '""',
  '{workspace,topic,project}', false,
  'اتصال مدل دوم در تحقیق دومدلی (می‌تواند همان ارائه‌دهندهٔ مدل اول باشد)',
  'Connection of the second model in dual-model research (may be the same provider as the first)'),
 ('research.dual_model', '{"type":"string","maxLength":200}', '""',
  '{workspace,topic,project}', false,
  'شناسهٔ مدل دوم از کاتالوگ همان اتصال',
  'Second model id from the connection catalog'),
 ('research.judge_connection_id', '{"type":"string","pattern":"^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$"}', '""',
  '{workspace,topic,project}', false,
  'اتصال مدل داور؛ خالی یعنی همان مدل اصلی تحقیق',
  'Connection of the judge model; empty means the researcher''s own model'),
 ('research.judge_model', '{"type":"string","maxLength":200}', '""',
  '{workspace,topic,project}', false,
  'شناسهٔ مدل داور؛ خالی یعنی همان مدل اصلی تحقیق',
  'Judge model id; empty means the researcher''s own model');
