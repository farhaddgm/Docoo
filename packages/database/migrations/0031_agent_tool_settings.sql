-- The model may call the tools its role is allowed (ADR-0023). Off by default: a run behaves as before
-- until an administrator switches it on; the ledger and the allowlist apply either way.
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
  ('agents.tool_calling', '{"type":"boolean"}', 'false',
   '{workspace,topic,project}', false,
   'اجازهٔ فراخوانی ابزارهای مجاز نقش توسط خود مدل (مثلاً جست‌وجوی دانش تأییدشده)',
   'Let the model call the tools its role is allowed (for example a search of approved knowledge)'),
  ('agents.max_tool_calls', '{"type":"integer","minimum":1,"maximum":20}', '6',
   '{workspace,topic,project}', false,
   'حداکثر تعداد فراخوانی ابزار برای هر پاسخ مدل',
   'Maximum number of tool calls for one model answer');
