---
doc_id: DOCOO-RUNBOOKS
title: runbook عملیات، حادثه و private beta
status: active
version: 1.0.1
owner: SRE
last_updated: 2026-10-04
notion_sync: true
---

# runbook عملیات، حادثه و private beta

هر هشدار در `infra/prometheus/rules/slo.yml` به یکی از بخش‌های این سند اشاره می‌کند. شواهد هر اجرای CI (بار، DAST، تست نفوذ احراز هویت و تمرین backup) در artifact گردش‌کار **Hardening** نگه داشته می‌شود.

## ۱. فرایند حادثه

1. **تشخیص و اعلام:** هشدار critical یعنی حادثه. یک incident commander تعیین و زمان شروع، هشدار و دامنهٔ اثر ثبت می‌شود.
2. **مهار:** اول اثر روی کاربر را کم کن (rollback، pause پروژه‌های متأثر، غیرفعال‌کردن اتصال provider خراب). داده یا audit را برای «حل سریع» دستی تغییر نده؛ همهٔ تاریخچه‌ها append-only است.
3. **ارتباط:** هر ۳۰ دقیقه وضعیت به مالک محصول گزارش می‌شود؛ نشت داده یا شکست RLS فوراً.
4. **بازیابی و تأیید:** SLI مربوط در داشبورد `Docoo — SLO and error budget` باید ۳۰ دقیقه پایدار بماند.
5. **postmortem بدون سرزنش** طبق بخش ۱۰ سند مشاهده‌پذیری، ظرف ۵ روز کاری، با action، owner و تاریخ.

<a id="availability-burn"></a>

## ۲. سوختن error budget دسترس‌پذیری

- **نشانه:** `DocooAvailabilityFastBurn` (۱۴٫۴ برابر، page) یا `DocooAvailabilitySlowBurn` (۶ برابر).
- **بررسی:** `sum by (http_route, http_response_status_code) (rate(http_server_request_duration_seconds_count{http_response_status_code=~"5.."}[5m]))`؛ لاگ API با همان `trace_id`؛ سلامت PostgreSQL و Temporal در `/v1/health/ready`.
- **اقدام:** اگر بعد از deploy شروع شده، rollback (بخش ۹). خطای pool پایگاه‌داده: تعداد اتصال و قفل‌ها؛ خطای provider در 5xx نباید دیده شود (به human task تبدیل می‌شود)؛ اگر دیده شد باگ است.

<a id="latency"></a>

## ۳. تأخیر API

- **نشانه:** `DocooApiLatencyHigh` (p95 خواندن بالای ۵۰۰ms).
- **بررسی:** کندترین route در trace؛ `db_client_operation_duration_seconds` برای query کند؛ اجرای `EXPLAIN (ANALYZE, BUFFERS)` روی query با فیلتر workspace.
- **اقدام:** ایندکس گمشده یا pagination بدون cursor را اصلاح کن؛ آزمون بار `scripts/load/main-path.js` را بعد از اصلاح دوباره اجرا کن.

<a id="queue-backlog"></a>

## ۴. صف کهنه

- **نشانه:** `DocooQueueStale` (p95 schedule-to-start بالای ۶۰ ثانیه).
- **بررسی:** `temporal_worker_task_slots_available` و تعداد worker؛ محدودیت نرخ provider (پروژه‌های paused با human task).
- **اقدام:** worker را افقی scale کن؛ اگر provider محدود است، صف را با resume کنترل‌شده خالی کن تا thundering herd رخ ندهد.

<a id="workflow-failure"></a>

## ۵. شکست workflow یا worker

- **نشانه:** `DocooWorkflowFailed` یا `DocooWorkerDown`. SLO دوام workflow صد درصد است.
- **بررسی:** تاریخچهٔ workflow در Temporal UI؛ `workflow_runs` و `stage_attempts` پروژه.
- **اقدام:** worker را بالا بیاور؛ state در Temporal و PostgreSQL می‌ماند. پروژهٔ متأثر را با `POST /projects/{id}/workflow/sync` همگام کن. شکست تکرارشونده = باگ و حادثهٔ critical.

<a id="export-failures"></a>

## ۶. شکست export

- **نشانه:** `DocooExportReliabilityLow`.
- **بررسی:** `docoo_document_exports_total` به تفکیک `format`؛ برای PDF در دسترس بودن Chromium (`PLAYWRIGHT_CHROMIUM_EXECUTABLE`)؛ برای همه، دسترسی object store.
- **اقدام:** renderer یا storage را درست کن؛ artifactهای امضاشدهٔ قبلی دست نمی‌خورند و با `verify` قابل بررسی‌اند.

<a id="audit-gap"></a>

## ۷. شکاف audit

- **نشانه:** `DocooAuditWriteFailed` (security-relevant، یک خطا هم page است) یا `DocooAuditWriteSlow`.
- **رفتار طراحی‌شده:** audit هر فرمان در همان تراکنش نوشته می‌شود؛ اگر نوشتن audit شکست بخورد، خود فرمان rollback می‌شود و شکاف ایجاد نمی‌شود.
- **اقدام:** فضای دیسک و قفل‌های جدول `audit_events`؛ trigger append-only را هرگز غیرفعال نکن.

<a id="backup-restore"></a>

## ۸. backup و restore

- **هدف:** RPO ۱۵ دقیقه با PITR و RTO ۴ ساعت (NFR-REL-004). در استقرار production (`deploy/compose.production.yaml`) WAL-G هر بخش WAL را حداکثر هر ۵ دقیقه و یک base backup را هر ۲۴ ساعت به S3 خارج از سرور می‌فرستد؛ `infra/postgres/pitr-drill.sh` در CI بازگردانی دقیق به یک لحظه را اثبات می‌کند.
- **backup روزانه و تمرین:** `pnpm --filter @docoo/database ops:backup-drill` نقش‌ها، کل پایگاه‌داده و همهٔ objectها را backup می‌گیرد، روی یک PostgreSQL 18 **جدا** و bucket جدا restore می‌کند و تعداد ردیف و checksum همهٔ جدول‌ها، RLS، triggerهای append-only، policyها، تاریخچهٔ migration و SHA-256 هر object را مقایسه می‌کند. گزارش JSON زمان backup، restore و RTO را دارد و در صورت موفقیت `docoo_backup_last_success_timestamp_seconds` را منتشر می‌کند (`PUSHGATEWAY_URL`). این تمرین در هر PR و هر شب در گردش‌کار Hardening اجرا می‌شود (NFR-REL-005).
- **restore واقعی:**
  1. سرویس‌های نویسنده (API و workerها) را متوقف کن.
  2. **بازگردانی به یک لحظه (PITR):** روی سرور تازه با همان image پایگاه‌داده و متغیرهای `BACKUP_S3_*`، `wal-g backup-fetch $PGDATA LATEST` را اجرا کن، در `postgresql.auto.conf` مقادیر `restore_command = 'wal-g wal-fetch %f %p'` و `recovery_target_time = '<زمان هدف>'` و `recovery_target_action = 'promote'` را بگذار، فایل `recovery.signal` را بساز و PostgreSQL را بالا بیاور (همان گام‌های `infra/postgres/pitr-drill.sh`). برای بازگردانی منطقی، `globals.sql` و `database.dump` تمرین backup هم قابل استفاده‌اند.
  3. objectها را از manifest بازگردان و SHA-256 هر کدام را بسنج.
  4. `pnpm db:test:rls` و `ops:backup-drill` را روی محیط بازیابی‌شده اجرا کن، بعد سرویس‌ها را با `DATABASE_URL` جدید بالا بیاور.

## ۹. rollback release

1. نسخهٔ قبلی را از GitHub Release (`vX.Y.Z`) انتخاب کن؛ imageها با همان tag ساخته می‌شوند (`install.sh update` بعد از هر به‌روزرسانی imageهای نسخه‌های قبلی را پاک می‌کند، پس بازگشت یک build تازه می‌سازد؛ cacheٔ ۷ روز اخیر آن را سریع می‌کند).
2. migrationها فقط افزایشی‌اند؛ rollback کد بدون rollback پایگاه‌داده امن است. اگر migration جدید داده را تغییر داده، به‌جای down migration، restore نقطه‌ای (بخش ۸) به زمان پیش از deploy انجام بده.
3. سرویس‌ها را به ترتیب worker، API و web به نسخهٔ قبلی برگردان؛ workflowهای در حال اجرا در Temporal ادامه می‌یابند چون نسخهٔ workflow deterministic است (آزمون replay در CI).
4. داشبورد SLO را ۳۰ دقیقه پایش کن و نتیجه را در Issue حادثه ثبت کن.

## ۱۰. private beta

### پیش‌شرط‌ها (همه در CI اثبات می‌شوند)

| گیت                        | شاهد                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| SAST/SCA/container scan    | گردش‌کار Security: `pnpm audit`، Trivy fs و Trivy image هر سرویس (CodeQL پس از فعال‌شدن Code Security) |
| DAST و تست نفوذ احراز هویت | گردش‌کار Hardening: ZAP baseline وب، ZAP API scan با نشست واقعی، `scripts/security/auth-probe.mjs`     |
| SLO و هشدار                | `promtool test rules`، داشبورد Grafana `docoo-slo`                                                     |
| آزمون بار مسیر اصلی        | k6 با ۲۵ کاربر هم‌زمان روی ۱٬۰۰۰ پروژه، p95 زیر ۵۰۰ms و خطای زیر ۰٫۵٪                                  |
| backup و restore           | `ops:backup-drill` با RTO اندازه‌گیری‌شده                                                              |

### اقدامات مالک پیش از شروع beta

موارد زیر خودکار شده‌اند و دیگر کار دستی ندارند: ساخت رمزهای production (`SESSION_PEPPER`، `SECRET_MASTER_KEY`، `ARTIFACT_SIGNING_KEY`، رمزهای پایگاه‌داده) توسط `scripts/deploy/install.sh`؛ HTTPS؛ آرشیو WAL و PITR؛ ساخت مدیر؛ صفحهٔ ورود کلید AI. باقی‌مانده‌ها (راهنمای گام‌به‌گام: [راهنمای نصب](11-production-install.md)):

- [ ] تهیهٔ سرور، دامنه و رکوردهای DNS و اجرای `install.sh`.
- [ ] تهیهٔ bucket S3 خارج از سرور برای پشتیبان و وارد کردن آن در نصب.
- [ ] وارد کردن کلید یکی از ارائه‌دهندگان AI در صفحهٔ «ارائه‌دهندگان AI».
- [ ] (اختیاری) SMTP برای ایمیل بازنشانی و کلید تبدیل گفتار به متن.
- [ ] branch protection روی `main` (نیازمند GitHub Pro یا عمومی‌کردن مخزن).
- [ ] تعریف کاربران beta و کانال گزارش مشکل.
- [ ] **پذیرش مالک:** امضای این بخش با تاریخ در Issue مربوط (REL-002).
