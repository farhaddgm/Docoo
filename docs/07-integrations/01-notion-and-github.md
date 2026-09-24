---
doc_id: DOCOO-NOTION-GITHUB
title: راهبرد GitHub و همگام‌سازی Notion
status: proposed
version: 1.0.0
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

اتصال Notion در محیط فعلی هنوز نصب/متصل نیست؛ در نتیجه ساخت صفحه و sync انجام‌نشده و نباید موفق اعلام شود. پس از اتصال، ابزار باید identity حساب و Workspace را تأیید و سپس صفحهٔ ریشه را بسازد. اگر connector/API اجازهٔ ایجاد صفحه در root ندهد، یک parent page در UI با همان حساب ایجاد و به اتصال share می‌شود؛ این تنها اقدام دستی لازم است.

## ۸. GitHub

Repository باید private، branch اصلی `main` و تنظیمات زیر داشته باشد:

- branch protection؛
- PR review برای تغییر پس از bootstrap؛
- status checks؛
- secret scanning و dependency alerts؛
- release tags SemVer؛
- environments staging/production با approvals؛
- CODEOWNERS برای docs/security/infra در زمان اضافه‌شدن تیم.

## ۹. bootstrap مخزن

چون پوشهٔ فعلی Git معتبر ندارد، مراحل bootstrap:

1. initialize repository؛
2. commit خط مبنای مستندات؛
3. تأیید remote به URL مقصد؛
4. بررسی authentication و اینکه repo private است؛
5. push `main`؛
6. ثبت commit SHA در sync manifest؛
7. sync Notion.

هیچ push یا ساخت repo بدون احراز هویت حساب مقصد و بررسی عدم overwrite محتوای موجود انجام نمی‌شود.
