---
doc_id: DOCOO-ACCEPTANCE-TRACEABILITY
title: طرح پذیرش و ردیابی نیازمندی‌ها
status: proposed
version: 1.0.0
owner: Product Quality
last_updated: 2026-09-24
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

| قابلیت | نیازمندی‌ها | نوع آزمون | مدرک پذیرش |
|---|---|---|---|
| Auth | FR-AUTH-* | E2E/Security | report + audit |
| Topic/Project | FR-TOP-*, FR-PRJ-* | E2E/Integration | scenario log |
| Config | FR-CFG-* | Unit/E2E | resolution snapshot |
| Workflow | FR-WF-*, FR-ANL-* | Replay/E2E | Temporal history |
| Ingestion | FR-ING-* | Fixture/Security | extraction manifest |
| Knowledge | FR-KNO-*, FR-RES-* | Eval/E2E | lineage report |
| Solutions | FR-SOL-* | Unit/E2E | scorecard |
| Documents | FR-DOC-* | Golden/E2E | artifacts/checksum |
| Evaluation | FR-EVA-* | Eval/E2E | finding loop |
| Brain | FR-BRN-* | Eval/Report | performance report |
| Providers | FR-AI-* | Contract/Chaos | adapter report |
| Audit | FR-AUD-* | Integration/Security | gap check |
| NFR | NFR-* | Load/Security/DR | signed test report |

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
