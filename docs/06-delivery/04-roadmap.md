---
doc_id: DOCOO-ROADMAP
title: نقشه راه توسعه Docoo
status: proposed
version: 1.6.0
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
2. ~~**ایجنت‌ها و پیکربندی پروژه**~~ — انجام شد در 0.13.0 ([ADR-0015](../adr/0015-agent-definitions.md)): تعریف نسخه‌دار هر نقش از منشور مصوب، کپی مستقل برای پروژه، سنجاق‌شدن اجرا به نسخه، allowlist ابزار در سقف نقش و صفحهٔ «ایجنت‌ها».
3. ~~**دانش در بک‌آفیس**~~ — انجام شد در 0.14.0 ([ADR-0016](../adr/0016-knowledge-screens.md)): بارگذاری منبع (فایل، متن، نشانی) با پیگیری پردازش، ساخت دانش، صف ممیزی دو‌نمایی، ممیزی شش‌معیاره با دلیل، override دو‌گامی، تازه‌سازی دانش قدیمی، تعارض‌ها، آزمون بازیابی و تب «دانش» پروژه.
4. **نگارش سند**: عامل documentation سند کامل را با citation می‌نویسد (ADR-0010) و ویرایشگر ساختاریافتهٔ بلوک‌ها در صفحهٔ سند.
5. ~~**تحقیق با دانش**~~ — انجام شد در 0.15.0 ([ADR-0017](../adr/0017-research-with-knowledge-and-role-evaluation.md)): مرحلهٔ research دانش approved را از دروازهٔ ابزار بازیابی می‌کند (ledger تماس‌ها)، با ارجاع `K#` و نقل‌قول استناد می‌کند، کد هر نقل‌قول را با متن دانش می‌سنجد، دانش `restricted` پیش‌فرض به مدل نمی‌رسد و صفحهٔ دانش «کجا استفاده شد» دارد.
6. ~~**ارزیابی مدل‌محور نقش‌ها**~~ — انجام شد در 0.15.0 ([ADR-0017](../adr/0017-research-with-knowledge-and-role-evaluation.md)): Brain هر نقش را با مدل در برابر منشوری که با آن اجرا شد می‌سنجد؛ فقط یافتهٔ دارای بند منشور و شاهد می‌ماند و گزارش بدون اثر جانبی است.
7. ~~**تنظیمات سامانه، قالب‌ها و سطوح سند**~~ — انجام شد در 0.16.0 ([ADR-0018](../adr/0018-settings-templates-wizard-and-acceptance-tooling.md)): صفحهٔ «تنظیمات» با تاریخچه، بازگردانی و بازنشانی، تب «تنظیمات» پروژه، صفحهٔ «قالب‌ها و سطوح سند» با اعتبارسنجی بازه‌ها، قالب‌های نسخه‌دار که شکل پیش‌نویس سند را تعیین می‌کنند، و wizard هشت‌گامهٔ ساخت پروژه با مقدار مؤثر و منبع هر مقدار از سرور و ثبت اتمیک.
8. **پذیرش با provider واقعی و اقدام‌های مالک** — ابزار و شاهد در 0.16.0 آماده است ([ADR-0018](../adr/0018-settings-templates-wizard-and-acceptance-tooling.md)، [پذیرش private beta](12-private-beta-acceptance.md)): بررسی سازگاری schemaهای پلتفرم با قاعدهٔ strict، آزمون زندهٔ schemaهای پلتفرم در گردش‌کار Provider acceptance، `pnpm owner:check` برای حفاظت شاخه و CodeQL و secretها، و `scripts/deploy/acceptance.sh` برای سرور. **باقی‌مانده با مالک** (کد نمی‌تواند انجام دهد): کلید provider و transcription ([#53](https://github.com/farhaddgm/Docoo/issues/53))، CodeQL و حفاظت شاخه ([#89](https://github.com/farhaddgm/Docoo/issues/89))، سرور واقعی و امضای private beta ([#94](https://github.com/farhaddgm/Docoo/issues/94)). تا آن شواهد در Issueها نباشد این گام بسته نیست.

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
