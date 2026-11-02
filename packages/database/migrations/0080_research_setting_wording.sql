-- ADR-0048: the research settings are explained in plain words, each with a small example, because
-- the administrators who read them are not engineers. Only the wording changes.
UPDATE setting_definitions SET
  description_fa = 'تحقیق علاوه بر دانش تأییدشده، در اینترنت هم بگردد. اگر خاموش باشد، فقط از دانش داخلی استفاده می‌شود.',
  description_en = 'Let research also look on the internet, besides approved knowledge. When off, only internal knowledge is used.'
 WHERE key = 'research.web_enabled';

UPDATE setting_definitions SET
  description_fa = 'دست‌کم چند بار جستجو شود. مثال: ۲ یعنی حتی اگر زود جواب پیدا شد، دست‌کم دو بار جستجو می‌کند.',
  description_en = 'The least number of searches. Example: 2 means it searches at least twice even if an answer turns up early.'
 WHERE key = 'research.web_min_searches';

UPDATE setting_definitions SET
  description_fa = 'حداکثر چند بار جستجو شود؛ سقف هزینه هم هست. مثال: ۸ یعنی هرگز بیش از هشت جستجو نمی‌کند.',
  description_en = 'The most searches, which is also a cost ceiling. Example: 8 means it never searches more than eight times.'
 WHERE key = 'research.web_max_searches';

UPDATE setting_definitions SET
  description_fa = 'دست‌کم چند دور تحقیق شود. هر دور بر اساس کمبودهای دور قبل دوباره جستجو می‌کند. مثال: ۲ یعنی دست‌کم یک بار دوباره برای پر کردن کمبودها می‌گردد.',
  description_en = 'The least number of research rounds. Each round searches again for what the last one left missing. Example: 2 means at least one more search to fill the gaps.'
 WHERE key = 'research.web_min_rounds';

UPDATE setting_definitions SET
  description_fa = 'حداکثر چند بار دوباره جستجو شود (دور). مثال: ۳ یعنی بعد از جستجوی اول، حداکثر دو بار دیگر برای پر کردن کمبودها می‌گردد.',
  description_en = 'The most rounds of searching again. Example: 3 means after the first search it goes at most twice more to fill the gaps.'
 WHERE key = 'research.web_max_rounds';

UPDATE setting_definitions SET
  description_fa = 'با رسیدن به این تعداد صفحهٔ منبع، جستجو متوقف شود (بعد از تأمین حداقل‌ها). ۰ یعنی همیشه تا سقف ادامه بده. مثال: ۱۵ یعنی بعد از یافتن ۱۵ صفحه دیگر نمی‌گردد.',
  description_en = 'Stop searching once this many source pages are found (after the minimums are met). 0 means always go on to the ceiling. Example: 15 means it stops after finding 15 pages.'
 WHERE key = 'research.web_target_sources';

UPDATE setting_definitions SET
  description_fa = 'حداکثر چند صفحهٔ وب برای نوشتن گزارش نگه داشته شود. عدد بالاتر یعنی جزئیات بیشتر ولی هزینهٔ بیشتر.',
  description_en = 'The most web pages kept to write the report from. A higher number means more detail and more cost.'
 WHERE key = 'research.web_source_limit';
