-- The export format a project's documents offer first (ADR-0019 follow-up; UX §5 step 7).
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
  ('document.default_export_format', '{"type":"string","enum":["docx","pdf","pptx"]}', '"docx"',
   '{workspace,topic,project}', false,
   'قالب خروجی که در صفحهٔ سند ابتدا پیشنهاد می‌شود',
   'Export format offered first on a document page');
