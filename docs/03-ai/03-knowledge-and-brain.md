---
doc_id: DOCOO-KNOWLEDGE-BRAIN
title: حاکمیت دانش و ممیزی Brain
status: proposed
version: 1.0.0
owner: AI Governance
last_updated: 2026-09-24
notion_sync: true
---

# حاکمیت دانش و ممیزی Brain

## ۱. هدف

Knowledge layer باید مانع ورود بی‌ردپای متن به context مدل شود. هر محتوای مصرفی باید معلوم کند از کجا آمده، برای چه scope مجاز است، چه نسخه‌ای دارد، چه کسی/چه چیزی آن را ممیزی کرده و چه تعارضی دارد.

## ۲. چرخهٔ دانش

```text
Acquire -> Quarantine -> Extract -> Normalize -> Candidate
 -> Brain Audit -> Approve/Reject/Revise -> Index
 -> Retrieve Snapshot -> Use -> Observe -> Expire/Supersede/Re-audit
```

## ۳. سه نوع منبع

### Admin-provided

مالک محتوا ادمین است. provenance حداقل actor، زمان، فایل/متن، scope و declaration منبع را ثبت می‌کند. «ادمین گفته» اعتبار خودکار علمی ایجاد نمی‌کند؛ Brain همچنان relevance/consistency را می‌سنجد.

### Clue-guided

سرنخ می‌تواند keyword، URL، نام شرکت، مقاله یا توضیح باشد. سرنخ خود knowledge نیست؛ Researcher باید source را بخواند و candidate بسازد.

### Autonomous research

از research plan پروژه تولید می‌شود. هر claim باید citation قابل‌بازبینی داشته باشد. query و زمان دسترسی بخشی از provenance است.

## ۴. ممیزی دو‌سطحی

### سطح سند

هویت، ناشر، تاریخ، integrity فایل، scope، completeness، malware/extraction، relevance کلان و supersession.

### سطح claim

درستی نسبت claim و citation، strength evidence، تازگی، applicability، conflict و confidence. همهٔ جمله‌ها claim نمی‌شوند؛ ادعاهای تصمیم‌ساز، عددی، علّی، مقایسه‌ای و توصیه‌ای اولویت دارند.

## ۵. امتیاز پیش‌فرض

| معیار | وزن | پرسش |
|---|---:|---|
| اعتبار منبع | 25 | منبع و روش چقدر قابل‌اعتماد است؟ |
| ارتباط | 20 | با مسئله و زمینه چقدر مرتبط است؟ |
| کفایت شواهد | 20 | claim واقعاً پشتیبانی می‌شود؟ |
| تازگی | 15 | برای ماهیت ادعا به‌روز است؟ |
| سوگیری | 10 | تضاد منافع/یک‌جانبه‌بودن کنترل شده؟ |
| تعارض | 10 | نسبت به دانش موجود چقدر سازگار/حل‌شده است؟ |

### تصمیم پایه

- `approved`: overall ≥ 75، اعتبار و شواهد هرکدام ≥ 60، بدون نقص بحرانی provenance/security.
- `needs_revision`: overall بین 55 و 74 یا نقص قابل‌رفع.
- `rejected`: overall < 55، منبع جعلی/نامعتبر، محتوای ممنوع یا claim بی‌شاهد حیاتی.
- `expired`: validity تمام شده است.
- `superseded`: نسخهٔ معتبر جدیدتر جایگزین شده است.

Threshold و وزن‌ها تنظیم‌پذیر و نسخه‌بندی‌شده‌اند.

## ۶. citation policy

برای تحقیق ماشینی اجباری:

- URL/شناسهٔ منبع؛
- عنوان و ناشر؛
- نویسنده در صورت وجود؛
- published_at و accessed_at؛
- locator صفحه/بخش/سطر یا fragment؛
- quote digest یا content fingerprint؛
- verification status.

نقل‌قول کامل طولانی ذخیره نمی‌شود؛ excerpt لازم با محدودیت حقوقی و digest ذخیره می‌شود.

## ۷. conflict policy

Conflict record شامل claim A/B، نوع تعارض، severity، scope، تحلیل Brain و وضعیت است. هر دو دانش approved می‌توانند باقی بمانند. retrieval هر دو را با `conflict_warning` و بدون انتخاب پنهان ارائه می‌کند. ادمین می‌تواند priority یا applicability condition تعیین کند.

## ۸. scope و precedence

پیش از vector/keyword search، فیلتر workspace و deny اعمال می‌شود. سپس project، topic و role scope بررسی می‌شود. نتیجهٔ semantic search هرگز مجوز ایجاد نمی‌کند.

تنظیمات تحقیق از system → workspace → topic priority order → project → agent → run resolve می‌شوند. در چند حوزه، ادمین priority را تعیین می‌کند؛ تعارض حل‌نشده warning دارد.

## ۹. retrieval snapshot

هر invocation manifest دقیق knowledge versionها، claimها، score، conflict و query را pin می‌کند. بازسازی اجرای گذشته به snapshot متکی است، نه index جاری.

## ۱۰. override انسانی

فرم override باید decision Brain، score، reason و اثر را نشان دهد. دلیل حداقل ۲۰ کاراکتر معنادار، actor، زمان و validity لازم است. override دائمی پیش‌فرض نیست؛ ادمین باید «تا تغییر نسخه» یا تاریخ انقضا را انتخاب کند. تغییر محتوا override را نیز stale می‌کند.

## ۱۱. گزارش Brain

Brain گزارش می‌دهد:

- distribution وضعیت و score؛
- منابع پرتکرار rejected؛
- claimهای بدون citation؛
- تعارض‌های باز؛
- دانش نزدیک expiry؛
- override rate و اختلاف انسان/Brain؛
- نقش‌هایی که از دانش نامجاز یا ضعیف استفاده کرده‌اند؛
- پیشنهاد اصلاح policy.

Brain حق تغییر policy بدون ادمین ندارد.

## ۱۲. حفاظت در برابر prompt injection

- content و instruction کانال/بلوک جدا دارند؛
- رشته‌هایی مانند «دستور قبلی را نادیده بگیر» در source به‌عنوان داده علامت می‌خورند؛
- tool permission خارج مدل enforce می‌شود؛
- retrieved content نمی‌تواند tool جدید فعال کند؛
- URL و attachment sandbox می‌شوند؛
- خروجی دارای اشاره به exfiltration یا secret با policy checker رد می‌شود.
