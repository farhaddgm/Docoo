---
doc_id: DOCOO-ROADMAP
title: نقشه راه توسعه Docoo
status: proposed
version: 1.0.0
owner: Product & Engineering
last_updated: 2026-09-24
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
