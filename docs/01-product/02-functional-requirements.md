---
doc_id: DOCOO-FUNCTIONAL-REQUIREMENTS
title: نیازمندی‌های کارکردی Docoo
status: proposed
version: 1.0.0
owner: Product Engineering
last_updated: 2026-09-24
notion_sync: true
---

# نیازمندی‌های کارکردی Docoo

هر نیازمندی شناسهٔ پایدار دارد و باید حداقل یک آزمون پذیرش به آن متصل شود. واژهٔ «باید» الزام نسخهٔ اول است.

## AUTH — هویت و نشست

- **FR-AUTH-001:** سامانه باید ورود ادمین کل با شناسه و گذرواژه را فراهم کند.
- **FR-AUTH-002:** گذرواژه باید تغییر، reset امن و revoke همهٔ نشست‌ها را پشتیبانی کند.
- **FR-AUTH-003:** نشست باید cookie امن، HttpOnly و SameSite مناسب داشته باشد و پس از inactivity قابل‌تنظیم منقضی شود.
- **FR-AUTH-004:** رویدادهای ورود موفق/ناموفق، خروج، reset و lockout باید audit شوند.
- **FR-AUTH-005:** مدل authorization باید role/permission داشته باشد، هرچند نسخهٔ اول فقط Super Admin دارد.

## LOC — زبان و نمایش

- **FR-LOC-001:** ادمین باید زبان بک‌آفیس را بین فارسی و انگلیسی تغییر دهد.
- **FR-LOC-002:** فارسی RTL و انگلیسی LTR باشد؛ تغییر بدون خروج از حساب ممکن باشد.
- **FR-LOC-003:** زبان خروجی پروژه مستقل از زبان UI انتخاب شود.
- **FR-LOC-004:** تاریخ، عدد و پیام خطا با locale نمایش داده شوند؛ مقادیر ذخیره‌شده locale-neutral باشند.

## TOP — حوزهٔ موضوعی

- **FR-TOP-001:** ادمین باید حوزه را با UUID، کد، عنوان، شرح، زبان و پیوست ایجاد کند.
- **FR-TOP-002:** عنوان و کد حوزه در workspace یکتا باشند.
- **FR-TOP-003:** حوزه باید ویرایش، archive، restore و soft-delete شود.
- **FR-TOP-004:** حوزه ساختار تخت دارد و رابطهٔ parent/child ارائه نمی‌شود.
- **FR-TOP-005:** تمام نسخه‌های شرح و پیوست حوزه حفظ شوند.
- **FR-TOP-006:** سامانه باید پروژه‌های وابسته را پیش از حذف حوزه نشان دهد و حذف نباید رابطهٔ پروژه را بی‌ردپا بشکند.

## PRJ — پروژه

- **FR-PRJ-001:** پروژه باید UUID داخلی و کد خوانای یکتا داشته باشد.
- **FR-PRJ-002:** ادمین باید عنوان، شرح، مسئلهٔ اولیه، زبان، حوزه‌ها و تنظیمات پروژه را ثبت کند.
- **FR-PRJ-003:** پروژه باید به چند حوزه متصل و ترتیب اولویت حوزه‌ها مشخص شود.
- **FR-PRJ-004:** وضعیت‌های draft، active، paused، completed، archived و deleted enforce شوند.
- **FR-PRJ-005:** حذف پروژه باید ۳۰ روز recoverable باشد و زمان purge نمایش داده شود.
- **FR-PRJ-006:** clone پروژه باید تنظیمات را بدون کپی audit/history و secrets ایجاد کند.
- **FR-PRJ-007:** صفحهٔ پروژه باید مرحلهٔ جاری، دلیل توقف، اقدام بعدی، timeline و outputها را نشان دهد.

## CFG — تنظیمات و نسخه

- **FR-CFG-001:** تنظیمات system، workspace، حوزه، پروژه، agent-in-project و run باید پشتیبانی شوند.
- **FR-CFG-002:** UI باید effective value و منبع هر مقدار را نشان دهد.
- **FR-CFG-003:** تغییر تنظیمات باید نسخه، diff، actor، reason و timestamp ایجاد کند.
- **FR-CFG-004:** ادمین باید default نقش را clone و برای پروژه تغییر دهد.
- **FR-CFG-005:** تغییر در حین اجرا از مرز امن بعدی اعمال و config version مصرف‌شده در هر call ثبت شود.
- **FR-CFG-006:** restore نسخهٔ قبل باید نسخهٔ جدید ایجاد کند، نه تاریخچه را بازنویسی کند.

## AGT — تعریف ایجنت

- **FR-AGT-001:** شش نقش ثابت باید definition فعال با اصول، وظایف، مدل پیش‌فرض، ابزارها و schema خروجی داشته باشند.
- **FR-AGT-002:** اصول و وظایف باید مستقل، نسخه‌بندی‌شده و قابل‌ویرایش باشند.
- **FR-AGT-003:** اجرای ایجنت باید نسخهٔ دقیق تعریف نقش، prompt و تنظیمات را ذخیره کند.
- **FR-AGT-004:** هر نقش باید فهرست outputهای خود را در workspace ببیند، اما retrieval محتوا باید به policy پروژه محدود باشد.
- **FR-AGT-005:** ابزارهای مجاز هر نقش باید allowlist باشند.

## WF — گردش‌کار

- **FR-WF-001:** ترتیب تحلیل → تحقیق → ایده‌پردازی → مستندسازی → ارزیابی ثابت باشد.
- **FR-WF-002:** Brain باید در نقاط ingest دانش، قبل از retrieval و گزارش‌گیری فراخوانی شود.
- **FR-WF-003:** هر transition باید gate دستی یا خودکار قابل‌تنظیم داشته باشد؛ پیش‌فرض دستی است.
- **FR-WF-004:** pause، resume، cancel و retry باید بدون از‌دست‌رفتن state کار کنند.
- **FR-WF-005:** نیاز به پاسخ انسانی باید workflow را به `waiting_for_human` ببرد.
- **FR-WF-006:** یک command تکراری نباید side effect را دوباره ایجاد کند.
- **FR-WF-007:** سقف اصلاح خروجی ده attempt است؛ عبور یا افزایش سقف فقط با تصمیم ثبت‌شدهٔ ادمین.
- **FR-WF-008:** ادمین باید stage output را مشاهده، comment، reject، approve یا edit کند.
- **FR-WF-009:** edit خروجی، approval و evaluation همان نسخه را invalidate کند.

## ANL — تحلیل مسئله

- **FR-ANL-001:** تحلیلگر باید سؤال‌ها را در batch حداکثر ۴۰تایی ارائه دهد.
- **FR-ANL-002:** کل سؤال‌ها حداقل ۳۰ و حداکثر ۳۰۰ باشد.
- **FR-ANL-003:** پاسخ می‌تواند متن، فایل یا یکی از وضعیت‌های unanswered، irrelevant و later باشد.
- **FR-ANL-004:** تحلیلگر باید coverage سؤال‌ها را بر اهداف، محدودیت، زمینه، ذی‌نفع، زمان، بودجه، داده و معیار موفقیت گزارش کند.
- **FR-ANL-005:** تعریف نهایی مسئله باید نسخه‌بندی و توسط ادمین تأیید شود.
- **FR-ANL-006:** unresolvedها و فرض‌ها باید در گزارش پایانی برجسته باشند.

## ING — ورود محتوا

- **FR-ING-001:** متن، URL، فایل و صوت قابل‌ورود باشند.
- **FR-ING-002:** PDF، DOCX، PPTX، XLSX، CSV، TXT، MD، JSON، PNG، JPG و فرمت‌های صوتی مصوب پشتیبانی شوند.
- **FR-ING-003:** حد فایل پیش‌فرض ۱۰۰MB و قابل‌تنظیم باشد.
- **FR-ING-004:** فایل malware scan، MIME sniff، checksum و metadata extraction شود.
- **FR-ING-005:** تصویر/PDF اسکن‌شده OCR و صوت transcription شود؛ متن استخراج‌شده به فایل اصلی پیوند بخورد.
- **FR-ING-006:** نسخهٔ جدید سند باید lineage نسخه را حفظ کند.

## KNO — دانش و ممیزی

- **FR-KNO-001:** knowledge source type باید admin، clue_research یا autonomous_research باشد.
- **FR-KNO-002:** هر knowledge item باید provenance، scope، version و confidentiality داشته باشد.
- **FR-KNO-003:** Brain باید ممیزی سند و claimهای مؤثر را انجام دهد.
- **FR-KNO-004:** وضعیت‌های ممیزی مصوب enforce شوند.
- **FR-KNO-005:** score شش‌بعدی و reason باید ذخیره شود.
- **FR-KNO-006:** با gate فعال فقط approved قابل retrieval باشد.
- **FR-KNO-007:** تغییر محتوا status را pending و ارزیابی قبل را stale کند.
- **FR-KNO-008:** override ادمین دلیل اجباری و نشان انسانی داشته باشد.
- **FR-KNO-009:** تعارض دانش باید ثبت و همراه هشدار به مصرف‌کننده ارائه شود.
- **FR-KNO-010:** citation تحقیقی بدون URL/شناسه، عنوان، ناشر، تاریخ و accessed_at کامل محسوب نشود.

## RES — تحقیق

- **FR-RES-001:** research plan باید query، زبان، کشور، time range، source policy و target count داشته باشد.
- **FR-RES-002:** unrestricted، whitelist و blacklist پشتیبانی شوند.
- **FR-RES-003:** یافته‌ها باید deduplicate و به source record تبدیل شوند.
- **FR-RES-004:** متن منبع، summary، claim و citation از هم تفکیک شوند.
- **FR-RES-005:** تعداد نمونه‌های مشابه و عمق تحقیق از پروژه قابل‌تنظیم باشد.
- **FR-RES-006:** عدم دسترسی، paywall یا محتوای ناکافی باید صریح گزارش شود.

## SOL — راه‌حل

- **FR-SOL-001:** تعداد راه‌حل ۲ تا ۲۰، پیش‌فرض ۵ باشد.
- **FR-SOL-002:** هر راه‌حل عنوان، summary، assumptions، evidence، plan، risks و score inputs داشته باشد.
- **FR-SOL-003:** معیارها قابل‌فعال‌سازی و وزن‌ها مجموعاً ۱۰۰ باشند.
- **FR-SOL-004:** score خام، وزن‌دار و توضیح محاسبه نمایش داده شود.
- **FR-SOL-005:** ادمین چند راه‌حل را انتخاب و اولویت‌بندی کند.
- **FR-SOL-006:** هر راه‌حل منتخب final-document lifecycle مستقل داشته باشد.

## DOC — اسناد

- **FR-DOC-001:** سطح ۱ تا ۵ با bounds قابل‌ویرایش سامانه تعریف شود.
- **FR-DOC-002:** level در سطح agent/project/output قابل‌انتخاب باشد.
- **FR-DOC-003:** شمارش فقط Unicode letter و number را لحاظ کند.
- **FR-DOC-004:** سند خارج bounds قابل‌تأیید نهایی نباشد.
- **FR-DOC-005:** سند باید heading، paragraph، list، table، citation، figure و chart مدل ساختاری داشته باشد.
- **FR-DOC-006:** version، diff، restore، lock و supersede پشتیبانی شوند.
- **FR-DOC-007:** export انتخابی DOCX/PDF و PPTX مدیریتی فراهم شود.
- **FR-DOC-008:** artifact باید checksum، renderer version و source document version داشته باشد.

## EVA — ارزیابی

- **FR-EVA-001:** rubric سیستم و override پروژه باید نسخه‌بندی شود.
- **FR-EVA-002:** ارزیاب باید requirement coverage، evidence، feasibility، consistency، risk و format compliance را امتیاز دهد.
- **FR-EVA-003:** هر failure باید finding با severity، evidence و target stage داشته باشد.
- **FR-EVA-004:** ادمین باید target stage را تغییر دهد؛ پیش‌فرض تولیدکننده است.
- **FR-EVA-005:** accepted_with_exception باید از approved عادی متمایز باشد.

## BRN — Brain و گزارش

- **FR-BRN-001:** Brain باید تمام نسخه‌های اصول و وظایف نقش‌ها را برای ارزیابی بخواند.
- **FR-BRN-002:** Brain باید انحراف نقش از charter را گزارش دهد.
- **FR-BRN-003:** Brain باید گزارش پروژه و گزارش تجمیعی workspace تولید کند.
- **FR-BRN-004:** Brain نباید بدون policy/ادمین پروژه را متوقف یا تنظیمات را تغییر دهد.
- **FR-BRN-005:** پیشنهاد Brain باید actionable، مستدل و به evidence پیوندخورده باشد.

## AI — مدل و provider

- **FR-AI-001:** OpenAI، Gemini و Anthropic از قرارداد واحد پشتیبانی شوند.
- **FR-AI-002:** فهرست مدل‌ها/capabilityها باید refresh و snapshot شود؛ نام مدل در کد hardcode نشود.
- **FR-AI-003:** پارامترهای مشترک و provider-specific با schema validate شوند.
- **FR-AI-004:** secret کامل هرگز در UI/API/log بازگردانده نشود.
- **FR-AI-005:** health status، آخرین بررسی و خطای sanitize‌شده نمایش داده شود.
- **FR-AI-006:** retry provider طبق schedule مصوب و پس از آن pause انجام شود.
- **FR-AI-007:** usage، latency، finish reason و cost estimate ذخیره شود.
- **FR-AI-008:** fallback خودکار پیش‌فرض خاموش باشد.

## AUD — ممیزی و مدیریت

- **FR-AUD-001:** عملیات حساس باید actor، action، target، before/after، reason، correlation ID و زمان داشته باشند.
- **FR-AUD-002:** audit از UI فقط خواندنی و exportپذیر باشد.
- **FR-AUD-003:** filter بر پروژه، نقش، نوع رویداد، بازهٔ زمان و severity فراهم شود.
- **FR-AUD-004:** دادهٔ secret و محتوای حساس غیرضروری در audit redacted شود.
- **FR-AUD-005:** purge خود نیز audit شود و audit حداقلی حذف را حفظ کند.
