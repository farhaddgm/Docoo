-- ADR-0054: the research can read the few pages it leans on most in full, not only the search
-- notes on them, so a figure or a date is quoted exactly. Off by default (the Deep and Sensitive
-- modes turn it on). It uses the owner's URL policy (ingestion.url_policy / ingestion.url_allowlist)
-- and the same guarded fetcher as the knowledge ingestion, so it can reach nothing that could not.
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
 ('research.read_pages', '{"type":"boolean"}', 'false',
  '{workspace,topic,project}', false,
  'صفحه‌های کلیدی کامل خوانده شوند، نه فقط خلاصهٔ جست‌وجو؛ تا عدد و تاریخ دقیق نقل و با خودِ صفحه سنجیده شود. فقط صفحه‌هایی خوانده می‌شوند که «سیاست دریافت نشانی» (ingestion.url_policy) اجازه می‌دهد؛ با سیاست «فهرست مجاز» (پیش‌فرض) فقط دامنه‌های همان فهرست',
  'Read the key pages in full, not only the search notes on them, so a figure or a date is quoted exactly and checked against the page itself. Only pages the URL policy (ingestion.url_policy) allows are read; with the default allowlist policy, only domains on that list'),
 ('research.read_pages_max', '{"type":"integer","minimum":1,"maximum":10}', '5',
  '{workspace,topic,project}', false,
  'حداکثر چند صفحه کامل خوانده شود. مثال: ۵ یعنی مهم‌ترین پنج صفحه (اول صفحه‌هایی که هر دو مدل یافته‌اند، بعد رسمی‌ها)',
  'The most pages to read in full. Example: 5 means the five most important pages (those both models found first, then official ones)');
