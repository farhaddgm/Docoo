---
doc_id: DOCOO-NOTION-GITHUB
title: راهبرد GitHub و همگام‌سازی Notion
status: active
version: 1.1.0
owner: Documentation Engineering
last_updated: 2026-09-24
notion_sync: true
---

# راهبرد GitHub و همگام‌سازی Notion

## ۱. مقاصد

- GitHub خصوصی: `https://github.com/farhaddgm/Docoo`
- Notion: ریشهٔ Workspace حساب `farhad.dgm@gmail.com`
- جهت sync: فقط Repository → Notion.
- منبع حقیقت: فایل‌های Markdown مخزن.

## ۲. ساختار Notion

صفحهٔ ریشهٔ `Docoo — Product & Engineering` ساخته می‌شود و صفحات فرزند مطابق `docs/README.md` سازمان می‌یابند:

- 00 Foundation
- 01 Product
- 02 Domain
- 03 AI & Knowledge
- 04 Architecture
- 05 Security
- 06 Delivery & Operations
- 07 Integrations
- ADRs

فهرست سند باید database یا index page با فیلدهای Doc ID، Version، Status، Owner، Source Path، Commit SHA و Last Synced باشد.

## ۳. الگوریتم sync

1. خواندن manifest و front matter؛
2. validate doc_id یکتا و linkها؛
3. تبدیل Markdown به blockهای Notion با حفظ heading/list/table/code/link؛
4. پیدا کردن page با `doc_id`، نه title؛
5. ایجاد یا update محتوای managed region؛
6. ثبت commit SHA، content checksum و زمان؛
7. عدم تغییر pageهای خارج manifest؛
8. گزارش created/updated/unchanged/failed.

## ۴. جلوگیری از تعارض

Notion read-only واقعی ممکن است از نظر permission قابل‌تحمیل نباشد؛ بنابراین صفحه banner دارد: «این صفحه از GitHub تولید می‌شود». sync محتوای managed را جایگزین می‌کند. commentها می‌توانند باقی بمانند، اما تغییر محتوا باید به PR مخزن تبدیل شود.

## ۵. idempotency و rollback

- mapping `doc_id -> notion_page_id` در manifest state ذخیره می‌شود.
- checksum برابر، update نمی‌کند.
- هر sync یک run record دارد.
- rollback با checkout commit قبلی و sync مجدد.
- حذف فایل به‌طور خودکار صفحه را delete نمی‌کند؛ ابتدا archive candidate و approval لازم است.

## ۶. امنیت

- token/connection فقط insert/update content لازم دارد.
- secret در Git نیست.
- workspace/page allowlist.
- sync log بدون محتوای محرمانهٔ کامل.
- attachment upload از فایل‌های allowlisted مخزن.

## ۷. وضعیت فعلی

اتصال Notion با حساب `farhad.dgm@gmail.com` و Workspace `Farhad’s Space` تأیید شد. آخرین بررسی مستقیم index نشان می‌دهد هر ۴۱ `doc_id` فعلی در `Docoo Document Index` وجود دارد. با این حال، state ثبت‌شده در مخزن هنوز ۳۶ سند را می‌شمارد و checksum محتوای workspace با Notion برای ۱۵ سند متفاوت است؛ بنابراین وجود ردیف index به معنی همگام‌بودن محتوای صفحه نیست. state را دستی جلو نمی‌بریم تا گزارش sync ساختگی نشود.

گردش موجود پس از push تغییرات `docs/**` به `main` اجرا می‌شود؛ فقط manifest را validate می‌کند و در صورت پیکربندی `NOTION_SYNC_WEBHOOK_URL` درخواست sync می‌فرستد. در branch کاری فعلی sync اجرا نشده است. پس از دسترسی GitHub، تغییرات باید از مسیر PR/merge منتشر و سپس نتیجهٔ webhook و state تولیدشده بازبینی شود.

## ۸. GitHub

Repository باید private، branch اصلی `main` و تنظیمات زیر داشته باشد:

- branch protection؛
- PR review برای تغییر پس از bootstrap؛
- status checks؛
- secret scanning و dependency alerts؛
- release tags SemVer؛
- environments staging/production با approvals؛
- CODEOWNERS برای docs/security/infra در زمان اضافه‌شدن تیم.

## ۹. وضعیت bootstrap مخزن

- Git محلی معتبر و branch اصلی `main` است.
- هویت مقصد `farhaddgm` و خصوصی‌بودن `farhaddgm/Docoo` تأیید شد.
- commit اولیهٔ placeholder در GitHub بدون force-push و با حفظ تاریخچه ادغام شد.
- خط مبنای مستندات و state همگام‌سازی به `main` push شدند.
- Dependabot vulnerability alerts و automated security fixes فعال‌اند.
- branch protection و secret scanning برای private repository در پلن فعلی GitHub در دسترس نیستند و پس از ارتقای پلن باید فعال شوند.

هیچ push یا ساخت repo بدون احراز هویت حساب مقصد و بررسی عدم overwrite محتوای موجود انجام نمی‌شود.
