---
doc_id: DOCOO-TESTING-STRATEGY
title: راهبرد آزمون و کیفیت مهندسی
status: proposed
version: 1.1.0
owner: Quality Engineering
last_updated: 2026-10-14
notion_sync: true
---

# راهبرد آزمون و کیفیت مهندسی

## ۱. هدف

آزمون Docoo باید هم نرم‌افزار deterministic و هم رفتار احتمالی AI را پوشش دهد. passشدن unit test به‌تنهایی کیفیت راه‌حل را اثبات نمی‌کند؛ LLM eval نیز امنیت transaction و tenant را اثبات نمی‌کند.

## ۲. لایه‌ها

### Unit

domain invariant، state transition، config resolution، score، character count، retry schedule، authorization decision و canonical hash. سریع و بدون network.

### Component/Integration

PostgreSQL/RLS، object storage، Redis، Temporal test server، parser/renderer sandbox و outbox. با container واقعی در CI.

### Contract

- OpenAPI consumer/provider؛
- adapter fixture برای OpenAI/Gemini/Anthropic؛
- webhook/event schema؛
- document schema backward compatibility؛
- model capability mapping.

Live provider test محدود، opt-in و بدون دادهٔ مشتری است.

### Workflow replay

تاریخچه‌های workflow از نسخه‌های قبل با کد جدید replay می‌شوند تا nondeterminism قبل از deploy کشف شود. سناریوهای pause، signal، crash، retry و config change fixture دارند.

### End-to-end

از UI تا artifact:

1. login؛
2. حوزه/پروژه؛
3. ۳۰+ سؤال در چند batch؛
4. research/audit؛
5. راه‌حل‌ها؛
6. سند/evaluation؛
7. انتخاب و export؛
8. archive/delete/restore.

Provider در E2E اصلی deterministic fake است؛ یک smoke جدا با provider واقعی.

Playwright پروژه‌های Chromium، Firefox و WebKit دارد. `pnpm --filter @docoo/web test:e2e` مسیر معمول Chromium است؛ `pnpm --filter @docoo/web test:e2e:cross-browser` دو موتور دیگر را اجرا می‌کند. برای انتخاب یک موتور از `pnpm --filter @docoo/web exec playwright test --project=firefox` یا `--project=webkit` استفاده می‌شود.

در CI دو موتور اضافی در jobهای مستقل و موازی، با PostgreSQL/RLS، Temporal، object store و scanner جداگانه، کل مجموعهٔ E2E موجود را اجرا می‌کنند. هر job یک worker و بدون retry دارد؛ report و trace خطا با نام موتور ذخیره می‌شود. Chromium نیز در این محیط‌ها نصب می‌شود چون export سند از renderer مبتنی بر Chromium در API استفاده می‌کند. این جداسازی جلوی رقابت تست‌ها بر سر تنظیمات و دادهٔ مشترک را می‌گیرد و زمان اجرای مرورگرها را پشت سر هم جمع نمی‌کند.

WebKit در Playwright شاهد پوشش موتور است؛ آزمون روی Safari واقعی یا دو نسخهٔ پایدار اخیر را اثبات نمی‌کند. بار ۲۵ اجرای هم‌زمان ایجنت، تنظیم concurrency هر provider و گزارش عددی SLO جدا از این آزمون‌ها هستند و تا داشتن نتیجهٔ واقعی زیر PRP-13 باز می‌مانند.

### AI eval

Dataset فارسی/انگلیسی، judge ترکیبی، groundedness، citation، role adherence، diversity، business fit، injection resistance و length compliance. baseline و confidence interval نگهداری می‌شود.

### Document golden

Structured fixture به DOCX/PDF/PPTX render و سپس parse/screenshot می‌شود. تفاوت بصری threshold، clipping، RTL، font، table و chart بررسی می‌شوند.

### Security

SAST، SCA، secret، image، IaC، DAST، RLS cross-tenant، IDOR، SSRF، upload، parser sandbox، prompt injection، exfiltration و authorization matrix.

### Performance

API list/search، upload finalize، retrieval، ۲۵ agent concurrency، queue burst، audit write، export بزرگ و recovery پس از worker kill.

## ۳. تست‌های invariant حیاتی

- knowledge rejected با gate فعال هرگز retrieval نمی‌شود.
- document خارج bounds approved نمی‌شود.
- edit version approval قبلی را invalidate می‌کند.
- tenant A هیچ row/object/cache از B نمی‌بیند.
- attempt retry side effect duplicate ایجاد نمی‌کند.
- provider secret در response/log نیست.
- workflow پس از kill از checkpoint ادامه می‌یابد.
- stage order دور زده نمی‌شود مگر override ثبت‌شدهٔ مجاز.

## ۴. محیط‌ها

- local: fake provider و sample non-sensitive.
- CI: ephemeral full stack.
- staging: production-like، secret و data مستقل.
- production: smoke read-only و synthetic project مشخص.

دادهٔ production بدون anonymization وارد staging نمی‌شود.

## ۵. quality gate PR

- format/lint/typecheck؛
- unit/component affected؛
- migration test؛
- contract diff؛
- security scan؛
- docs/ADR update برای تغییر؛
- AI eval subset اگر prompt/model/retrieval تغییر کرده؛
- workflow replay اگر workflow code تغییر کرده.

## ۶. release gate

- همهٔ critical path E2E؛
- full AI eval و مقایسه baseline؛
- dependency/image بدون critical شناخته‌شده یا exception؛
- backup/restore status معتبر؛
- rollback plan؛
- migration rehearsal؛
- observability dashboard/alert؛
- پذیرش ادمین برای milestone.

## ۷. مدیریت flaky

Flaky test پنهان یا retry نامحدود نمی‌شود. quarantine با owner و deadline؛ نتیجهٔ quarantine در release report دیده می‌شود. provider live test reliability جدا از product regression گزارش می‌شود.

## ۸. پوشش نیازمندی

هر test case شناسهٔ `TC-*` و آرایهٔ `requirements` دارد. CI ماتریس پوشش FR/NFR می‌سازد و requirement بدون test را fail یا warning طبق مرحلهٔ پروژه اعلام می‌کند.
