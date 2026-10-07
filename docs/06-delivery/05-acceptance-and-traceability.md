---
doc_id: DOCOO-ACCEPTANCE-TRACEABILITY
title: طرح پذیرش و ردیابی نیازمندی‌ها
status: approved-baseline
version: 1.1.0
owner: Product Quality
last_updated: 2026-10-07
notion_sync: true
---

# طرح پذیرش و ردیابی نیازمندی‌ها

## ۱. سناریوی پذیرش اصلی

پروژه‌ای فارسی برای یک شرکت نرم‌افزاری ساخته می‌شود، به دو حوزه با اولویت متصل است، فایل PDF اسکن‌شده و صوت دارد، هر سه provider پیکربندی شده‌اند و Researcher روی Gemini، Analyst روی OpenAI و Evaluator روی Anthropic اجرا می‌شوند.

### مراحل و شواهد

1. login و ایجاد حوزه/پروژه — audit و RLS evidence.
2. ingest/OCR/transcription — source lineage و quality status.
3. تحلیل حداقل ۳۰ سؤال در دو batch — coverage و approval.
4. تحقیق با whitelist/blacklist — citation و knowledge candidate.
5. Brain audit و یک override — score/reason/audit.
6. پنج راه‌حل و score weight 100 — محاسبه و انتخاب دو گزینه.
7. تولید دو سند مستقل level متفاوت — count validator.
8. ارزیاب یک خروجی را رد و اصلاح می‌کند — feedback loop/version invalidation.
9. DOCX/PDF و PPTX مدیریتی — checksum/open/render evidence.
10. provider failure شبیه‌سازی و resume — durable history.
11. archive/delete/restore — ۳۰روز و audit.

## ۲. ماتریس سطح بالا

| قابلیت        | نیازمندی‌ها        | نوع آزمون            | مدرک پذیرش          |
| ------------- | ------------------ | -------------------- | ------------------- |
| Auth          | FR-AUTH-*          | E2E/Security         | report + audit      |
| Topic/Project | FR-TOP-_, FR-PRJ-_ | E2E/Integration      | scenario log        |
| Config        | FR-CFG-*           | Unit/E2E             | resolution snapshot |
| Workflow      | FR-WF-_, FR-ANL-_  | Replay/E2E           | Temporal history    |
| Ingestion     | FR-ING-*           | Fixture/Security     | extraction manifest |
| Knowledge     | FR-KNO-_, FR-RES-_ | Eval/E2E             | lineage report      |
| Solutions     | FR-SOL-*           | Unit/E2E             | scorecard           |
| Documents     | FR-DOC-*           | Golden/E2E           | artifacts/checksum  |
| Evaluation    | FR-EVA-*           | Eval/E2E             | finding loop        |
| Brain         | FR-BRN-*           | Eval/Report          | performance report  |
| Providers     | FR-AI-*            | Contract/Chaos       | adapter report      |
| Audit         | FR-AUD-*           | Integration/Security | gap check           |
| NFR           | NFR-*              | Load/Security/DR     | signed test report  |

## ۳. معیار رد release

- هر critical/high امنیتی باز؛
- cross-tenant leak؛
- state loss یا duplicate side effect؛
- دانش rejected مصرف‌شده؛
- citation جعلی در corpus؛
- artifact بازنشدنی یا length bypass؛
- restore آزمایش‌نشده؛
- عدم امکان rollback؛
- requirement بحرانی بدون test.

## ۴. sign-off

Sign-off شامل version مستندات، commit SHA، image digest، migration version، eval dataset version، known limitations و accepted exceptions است. «تأیید ادمین» باید در سامانه یا رکورد انتشار ثبت شود.

## ۵. trace change

هر change request باید requirement IDs affected، test update، migration، doc version و ADR احتمالی را مشخص کند. حذف requirement بدون تصمیم supersede ممنوع است.

## ۴. دروازهٔ ردیابی نیازمندی‌ها

`pnpm qa:trace` (گام CI در job کیفیت) هر `FR-*` و `NFR-*` سندهای نیازمندی را با `qa/traceability.json` تطبیق می‌دهد. هر نیازمندی یک ورودی با وضعیت و یادداشت یک‌جمله‌ای دارد:

- `tested`: دست‌کم یک فایل آزمون واقعی (که خودش آزمون دارد) رفتار را می‌سنجد؛ فایل‌های پشتیبان کنار آن مجازند. شکاف‌های شناخته‌شده در یادداشت نوشته می‌شوند.
- `operational`: با استقرار، drill، بار، promtool یا فرایند عملیاتی تأیید می‌شود؛ مدرک فایل‌های موجود در مخزن است.
- `waived`: چیزی آن را خودکار نمی‌سنجد یا پیاده نشده است؛ دلیل صادقانه لازم است.

دروازه fail می‌شود اگر نیازمندی‌ای ورودی نداشته باشد، ورودی‌ای نیازمندی نداشته باشد، مسیر مدرک وجود نداشته باشد، مدرک `tested` فایل آزمونِ دارای آزمون نباشد، یا شمار `waived` از `waiverBudget` بیشتر شود (کم کردن بودجه با پوشش دادن، و بالا بردنش فقط در بازبینی). گزارش تولیدشده در `qa/traceability-report.md` است (`pnpm qa:trace --write`) و کهنه‌بودنش هم خطاست؛ وضعیت فعلی: ۱۵۴ نیازمندی، ۱۲۴ `tested`، ۱۲ `operational`، ۱۸ `waived` (بیشتر: پژوهش وب، سیاست منبع، نگهداری داده‌ها، و ارزیابی کیفیت AI با مدل واقعی).
