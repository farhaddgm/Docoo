---
doc_id: DOCOO-OBSERVABILITY-SRE
title: مشاهده‌پذیری و SRE
status: proposed
version: 1.1.0
owner: SRE
last_updated: 2026-10-02
notion_sync: true
---

# مشاهده‌پذیری و SRE

## ۱. telemetry contract

تمام componentها OpenTelemetry context را منتقل می‌کنند. correlation hierarchy:

`request_id -> workflow_id -> stage_run_id -> attempt_id -> invocation_id/tool_call_id`.

Workspace/project opaque ID در log مجاز است؛ title/content نیست.

## ۲. SLI/SLO

### Control plane availability

نسبت requestهای واجد شرایط غیر 5xx. هدف ۹۹٫۵٪ ماهانه.

### API latency

p95 query معمول < 500ms، p95 page interactive < 2s با شبکهٔ هدف.

### Workflow durability

نسبت workflowهای پذیرفته‌شده که بدون از‌دست‌رفتن state به terminal/human-wait می‌رسند؛ هدف ۱۰۰٪، هر loss incident بحرانی.

### Queue freshness

p95 زمان انتظار task عادی < 60s در بار هدف، جدا از provider rate limit.

### Export reliability

artifact موفق/درخواست معتبر ≥ 99٪.

### Audit completeness

رویداد اجباری ثبت‌شده ظرف ۵s؛ gap صفر.

## ۳. metrics

- HTTP rate/error/duration؛
- DB pool/query/lock/replication؛
- workflow count/state/age/retry/stuck؛
- task queue depth/age/concurrency؛
- provider latency/error/rate limit/token/cost؛
- retrieval latency/hit/empty/conflict؛
- audit decision distribution/override؛
- document validation/render duration/failure؛
- upload/scan/OCR/transcription؛
- cache و object storage؛
- backup age و restore test.

Label cardinality کنترل می‌شود؛ project ID در metric label عمومی استفاده نمی‌شود.

## ۴. log

JSON با timestamp، level، service، environment، version، correlation، event name، safe error. stack trace فقط backend access محدود. redaction test در CI.

## ۵. trace

Spanها: auth، API application service، DB query group، workflow command، activity، provider invocation، tool، retrieval، renderer. Prompt/output raw span attribute ممنوع است.

### پیاده‌سازی در API

سرویس‌ها ESM هستند؛ OpenTelemetry فقط وقتی http و pg را patch می‌کند که پیش از بارگذاری برنامه فعال شود. بنابراین API با `node --import ./dist/instrumentation.js dist/main.js` اجرا می‌شود (`pnpm --filter @docoo/api start`). با تنظیم `OTEL_EXPORTER_OTLP_ENDPOINT` spanهای HTTP ورودی (`url.path`، method، status) و PostgreSQL (`db.query.text` پارامتری بدون مقدار) و متریک‌های runtime صادر می‌شوند و لاگ‌ها `trace_id` دارند. `enhancedDatabaseReporting` خاموش است تا مقدار پارامترها، که ممکن است محتوای مسئله باشد، هرگز ثبت نشود.

### پیاده‌سازی SLI و هشدار (0.8.0)

- API با semantic convention پایدار HTTP متریک `http_server_request_duration_seconds` (با `http_route` و کد پاسخ) و متریک‌های برنامه `docoo_document_exports_total`، `docoo_audit_writes_total` و `docoo_audit_write_duration_seconds` را از راه OTLP به collector و Prometheus می‌فرستد.
- workerها با `TEMPORAL_METRICS_ADDRESS` متریک‌های SDK Temporal (`temporal_activity_schedule_to_start_latency_seconds`، `temporal_workflow_failed_total` و …) را برای scrape مستقیم باز می‌کنند.
- قواعد recording و هشدار در `infra/prometheus/rules/slo.yml` (burn rate چندپنجره‌ای برای دسترس‌پذیری، تأخیر، تازگی صف، دوام workflow، اعتبار export، کامل‌بودن audit و کهنگی backup) با `promtool test rules` در CI آزموده می‌شوند و هر هشدار به `docs/06-delivery/10-runbooks.md` پیوند دارد.
- داشبورد Grafana `docoo-slo` (فایل `infra/grafana/dashboards/docoo-slo.json`) SLIها و error budget را نشان می‌دهد.
- آزمون بار `scripts/load/main-path.js` (k6، ۲۵ کاربر هم‌زمان روی ۱٬۰۰۰ پروژه) با آستانهٔ همین SLOها در گردش‌کار Hardening اجرا می‌شود.

## ۶. dashboard

- Executive health؛
- Workflow operations؛
- Provider health/cost؛
- Knowledge/Brain quality؛
- Document pipeline؛
- Security/audit؛
- Database/storage؛
- SLO/error budget.

## ۷. alert

Alert باید action/runbook داشته باشد. نمونه:

- availability burn rate؛
- critical provider unavailable؛
- queue age threshold؛
- workflow بدون heartbeat؛
- audit gap؛
- RLS/security test production signal؛
- backup stale؛
- disk/object failure؛
- secret نزدیک expiry؛
- cost anomaly.

هشدار برای تک خطای گذرا ممنوع مگر امنیتی؛ aggregation و burn rate از alert fatigue جلوگیری می‌کند.

## ۸. provider outage

داشبورد retry schedule و پروژه‌های affected را نشان می‌دهد. بعد از تلاش دهم، incident annotation و human task. بازیابی provider bulk resume کنترل‌شده دارد تا thundering herd رخ ندهد.

## ۹. error budget

عبور از error budget feature rollout را متوقف و reliability work را مقدم می‌کند. outage provider ثالث جدا گزارش می‌شود اما تجربهٔ کاربر و backlog ناشی از آن همچنان اندازه‌گیری می‌شود.

## ۱۰. postmortem

بدون سرزنش، شامل timeline، impact، detection gap، root/contributing causes، چه چیزی خوب بود، action با owner/date و verification. incident AI علاوه بر فنی، data/prompt/model versions را ثبت می‌کند.
