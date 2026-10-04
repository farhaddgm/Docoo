---
doc_id: DOCOO-ROADMAP
title: نقشه راه توسعه Docoo
status: proposed
version: 1.2.0
owner: Product & Engineering
last_updated: 2026-10-04
notion_sync: true
---

# نقشهٔ راه توسعه Docoo

این roadmap بر خروجی و gate متکی است، نه تاریخ حدسی. برآورد زمانی پس از spike و تشکیل تیم ثبت می‌شود.

## فاز ۰ — تصویب خط مبنا

### خروجی

- تصویب PRD، معماری، دامنه و charterها؛
- threat model و data flow؛
- backlog و traceability؛
- اتصال GitHub/Notion و CI skeleton؛
- spike تصمیم‌های فنی باز.

### Gate

ادمین اسناد خط مبنا و موارد خارج دامنه را تأیید کند.

## فاز ۱ — foundation و control plane

### خروجی

- monorepo، CI، Compose؛
- auth Super Admin؛
- workspace/topic/project؛
- config version/resolution؛
- audit foundation؛
- bilingual shell و design system؛
- PostgreSQL RLS.

### Gate

CRUD و isolation و audit E2E؛ restore backup اولیه.

## فاز ۲ — ingest و حاکمیت دانش

### خروجی

- upload/text/URL/audio؛
- scan/extract/OCR/transcription؛
- knowledge/version/scope؛
- Brain audit سند/claim؛
- conflict و override؛
- hybrid retrieval.

### Gate

دانش rejected هرگز retrieval نشود؛ lineage کامل یک claim.

## فاز ۳ — orchestration و تحلیل/تحقیق

### خروجی

- Temporal workflows؛
- OpenAI/Gemini/Anthropic adapters؛
- Agent Catalog؛
- Analysis batches ۳۰..۳۰۰؛
- human gate/pause/resume؛
- Research workflow و citations؛
- provider retry/health.

### Gate

workflow پس از kill/deploy ادامه یابد و provider outage state را از بین نبرد.

## فاز ۴ — راه‌حل، سند و ارزیابی

### خروجی

- ideation ۲..۲۰؛
- criterion/weight/selection؛
- structured document و پنج level؛
- DOCX/PDF/PPTX؛
- evaluator، correction loop و accepted exception؛
- version/diff/lock.

### Gate

پروژهٔ مرجع از مسئله تا final artifact کامل شود.

## فاز ۵ — بک‌آفیس حرفه‌ای و گزارش Brain

### خروجی

- dashboard، project workspace و knowledge queue؛
- agent/config editors؛
- Brain project/workspace report؛
- usage/cost؛
- audit explorer؛
- responsive/RTL/accessibility hardening.

### Gate

آزمون پذیرش ادمین بدون ابزار توسعه.

## فاز ۶ — hardening و private beta

### خروجی

- load/security/AI eval؛
- SLO dashboards/alerts/runbooks؛
- backup/restore/DR rehearsal؛
- migration/rollback؛
- policy/privacy؛
- private deployment.

### Gate

تمام معیارهای acceptance، zero critical open و sign-off ادمین.

## گام‌های بعدی پس از فاز ۶

فازهای ۰ تا ۶ و نصب production بسته شده‌اند؛ آنچه می‌ماند به این ترتیب اولویت دارد (هر مورد با story و Issue خودش وارد backlog می‌شود):

1. ~~**پرسش‌وپاسخ تحلیلگر**~~ — انجام شد در 0.12.0 ([ADR-0014](../adr/0014-analyst-questions-and-answers.md)): batchهای ۳۰ تا ۳۰۰ سؤال، پاسخ اتمیک، پوشش، تناقض، صف «بعداً»، پایان زودهنگام و تعریف مسئله با تأیید ادمین.
2. **ایجنت‌ها و پیکربندی پروژه** (§۱۱ قرارداد API، UX §۹): تعریف نسخه‌دار هر نقش، کپی مستقل برای پروژه، allowlist ابزار و صفحهٔ «ایجنت‌ها».
3. **دانش در بک‌آفیس** (UX §۸): بارگذاری منبع، صف ممیزی دو‌نمایی، override با دلیل و تعارض‌ها؛ API از فاز ۲ آماده است.
4. **نگارش سند**: عامل documentation سند کامل را با citation می‌نویسد (ADR-0010) و ویرایشگر ساختاریافتهٔ بلوک‌ها در صفحهٔ سند.
5. **تحقیق با دانش**: مرحلهٔ research از بازیابی دانش approved و citation استفاده کند، نه فقط فراخوانی مدل.
6. **ارزیابی مدل‌محور نقش‌ها** در گزارش Brain روی قرارداد ADR-0011.
7. **تنظیمات سامانه، قالب‌ها و سطوح سند** در UI و wizard ایجاد پروژه (UX §۵).
8. **پذیرش با provider واقعی** ([issue ING-005](https://github.com/farhaddgm/Docoo/issues/53) و workflow پذیرش provider) و اقدام‌های مالک: CodeQL، حفاظت شاخه، سرور واقعی و امضای private beta (#89، #94).

## spikeهای لازم

1. انتخاب نهایی API framework.
2. Temporal self-hosted footprint و upgrade.
3. کیفیت OCR فارسی و transcription.
4. renderer RTL برای DOCX/PDF/PPTX.
5. provider retention/region و ZDR.
6. Cursor SDK suitability.
7. pgvector hybrid retrieval در بار هدف.
8. Notion root publishing behavior.

## تعریف Done feature

کد، آزمون، security، telemetry، docs، migration، localization، accessibility، runbook/error behavior و traceability کامل؛ صرف کارکرد happy path Done نیست.
