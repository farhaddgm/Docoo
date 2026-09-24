---
doc_id: DOCOO-NONFUNCTIONAL-REQUIREMENTS
title: نیازمندی‌های غیرکارکردی Docoo
status: approved-baseline
version: 1.0.1
owner: Architecture & SRE
last_updated: 2026-09-24
notion_sync: true
---

# نیازمندی‌های غیرکارکردی Docoo

## ۱. امنیت و حریم خصوصی

- **NFR-SEC-001:** تمام ترافیک بیرونی TLS و تمام دادهٔ پایدار حساس رمزنگاری at rest باشد.
- **NFR-SEC-002:** جداسازی tenant با application authorization و PostgreSQL RLS، همراه آزمون منفی، enforce شود.
- **NFR-SEC-003:** کلیدها با envelope encryption و کلید master خارج پایگاه داده نگهداری شوند.
- **NFR-SEC-004:** گذرواژه با Argon2id و پارامتر قابل‌ارتقا hash شود.
- **NFR-SEC-005:** فایل‌ها پیش از پردازش scan و parserها در sandbox با حد CPU/memory/time اجرا شوند.
- **NFR-SEC-006:** URL fetch در برابر SSRF، redirect، DNS rebinding و شبکه‌های خصوصی محافظت شود.
- **NFR-SEC-007:** prompt injection محتوای منبع نباید دستور system/developer را تغییر دهد؛ داده و instruction در context تفکیک شوند.
- **NFR-SEC-008:** baseline آزمون امنیتی OWASP ASVS 5.0 سطح ۲ است؛ کنترل‌های حساس AI افزوده می‌شوند.

## ۲. دسترس‌پذیری و دوام

- **NFR-REL-001:** SLO ماهانهٔ control plane برابر ۹۹٫۵٪، با حذف outage مستند provider ثالث از محاسبهٔ داخلی.
- **NFR-REL-002:** هیچ workflow پذیرفته‌شده‌ای پس از restart، deploy یا worker crash گم نشود.
- **NFR-REL-003:** side effectهای فایل، provider و transition باید idempotent یا compensatable باشند.
- **NFR-REL-004:** RPO دادهٔ اصلی ۱۵ دقیقه و RTO ۴ ساعت.
- **NFR-REL-005:** backup restore حداقل ماهانه در محیط غیرتولید آزموده شود.
- **NFR-REL-006:** queue backlog و workflow stuck detection هشدار داشته باشند.

## ۳. کارایی و ظرفیت

- **NFR-PERF-001:** p95 API خواندنی معمول کمتر از ۵۰۰ms و صفحهٔ بک‌آفیس کمتر از ۲s، بدون زمان provider.
- **NFR-PERF-002:** عملیات طولانی در request وب اجرا نشود؛ job/workflow async و progress قابل‌مشاهده باشد.
- **NFR-PERF-003:** baseline ظرفیت ۲۵ اجرای هم‌زمان agent و ۱٬۰۰۰ پروژه در سه ماه نخست است.
- **NFR-PERF-004:** workerها مستقل و افقی scale شوند؛ concurrency per provider قابل‌تنظیم باشد.
- **NFR-PERF-005:** فهرست‌های پروژه، سند و audit pagination cursor-based داشته باشند.
- **NFR-PERF-006:** retrieval باید scope filter را پیش از semantic ranking اعمال کند.

## ۴. قابلیت نگهداری

- **NFR-MNT-001:** معماری modular monolith با boundary و dependency rule روشن باشد.
- **NFR-MNT-002:** domain core از SDK provider، UI framework و object storage مستقل باشد.
- **NFR-MNT-003:** migrationها forward-only، نسخه‌بندی‌شده و در CI آزموده شوند.
- **NFR-MNT-004:** configuration schema، API contract و event schema machine-readable باشند.
- **NFR-MNT-005:** test coverage عدد هدف کور نیست؛ مسیرهای امنیتی و state transition باید ۱۰۰٪ branchهای تعریف‌شده را آزمون کنند.

## ۵. قابلیت انتقال

- **NFR-PORT-001:** تمام componentهای محصول container image reproducible داشته باشند.
- **NFR-PORT-002:** توسعه و single-server production با Docker Compose قابل‌اجرا باشد.
- **NFR-PORT-003:** object storage از API سازگار S3 و پایگاه از PostgreSQL استاندارد استفاده کند.
- **NFR-PORT-004:** هیچ دادهٔ پایدار ضروری داخل filesystem container نگهداری نشود.
- **NFR-PORT-005:** export کامل database، object manifest، secrets reference و config برای مهاجرت فراهم شود.

## ۶. مشاهده‌پذیری

- **NFR-OBS-001:** log ساختاریافته با correlation، tenant، project، workflow، run و attempt ID تولید شود.
- **NFR-OBS-002:** distributed trace از درخواست UI تا workflow و provider call وجود داشته باشد.
- **NFR-OBS-003:** token، latency، retry، error class، queue age، document render و audit metrics ثبت شوند.
- **NFR-OBS-004:** محتوای مسئله، prompt و secret به‌طور پیش‌فرض در operational log ذخیره نشود.

## ۷. دسترس‌پذیری رابط و سازگاری

- **NFR-UX-001:** آخرین دو نسخهٔ پایدار Chrome، Firefox و Safari هدف پشتیبانی‌اند.
- **NFR-UX-002:** WCAG 2.2 AA برای مسیرهای اصلی هدف است.
- **NFR-UX-003:** keyboard navigation، focus visible، label، contrast و screen-reader status برای workflow رعایت شود.
- **NFR-UX-004:** RTL نباید صرفاً transform بصری باشد؛ ترتیب، icon جهت‌دار، جدول و نمودار locale-aware باشند.

## ۸. نگهداری داده

- **NFR-DATA-001:** retention پیش‌فرض پروژهٔ فعال نامحدود تا تصمیم ادمین است.
- **NFR-DATA-002:** soft-delete پروژه ۳۰ روز است و legal hold در طراحی آینده قابل‌افزودن.
- **NFR-DATA-003:** purge باید فایل، index، embedding و cache را پوشش دهد و tombstone ممیزی باقی بگذارد.
- **NFR-DATA-004:** provider retention باید در هر adapter مستند و در UI سیاست نمایش داده شود.

## ۹. کیفیت AI

- **NFR-AIQ-001:** هر output باید schema validation و policy validation را قبل از انتشار بگذراند.
- **NFR-AIQ-002:** مجموعهٔ eval ثابت برای فارسی و انگلیسی وجود داشته باشد.
- **NFR-AIQ-003:** تغییر مدل/prompt بدون اجرای regression eval قابل‌ترویج به production نباشد.
- **NFR-AIQ-004:** groundedness، citation correctness، coverage، contradiction و format adherence سنجیده شوند.
- **NFR-AIQ-005:** عدم قطعیت باید قابل‌بیان باشد؛ سیستم نباید confidence جعلی بسازد.

## ۱۰. اهداف عملیاتی اولیه

| شاخص              | هدف پایه | توضیح                  |
| ----------------- | -------: | ---------------------- |
| Availability      |    99.5% | control plane          |
| RPO               |   15 min | PostgreSQL PITR        |
| RTO               |      4 h | single-region baseline |
| Agent concurrency |       25 | قابل‌تنظیم و scale-out |
| Provider retries  |       10 | بدون fallback خودکار   |
| Max input file    |   100 MB | قابل‌تنظیم             |
| Audit delivery    |    < 5 s | پس از transaction      |
| Export success    |   >= 99% | corpus آزمون معتبر     |
