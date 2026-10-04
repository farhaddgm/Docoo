---
doc_id: DOCOO-API-CONTRACTS
title: اصول و سطح قرارداد API
status: proposed
version: 1.3.0
owner: API Architecture
last_updated: 2026-10-02
notion_sync: true
---

# اصول و سطح قرارداد API

## ۱. اصول

- REST/JSON برای control plane؛ event/stream برای status.
- OpenAPI منبع قرارداد HTTP و از CI validate می‌شود.
- URL نسخهٔ major مانند `/v1` (وب از `/api/*` به آن proxy می‌کند)؛ منابع tenant زیر `/v1/workspaces/{workspaceId}/...` هستند.
- resource ID opaque UUID؛ code در filter/lookup مجاز.
- زمان ISO-8601 UTC؛ locale فقط نمایش.
- commandهای قابل‌تکرار `Idempotency-Key` می‌خواهند.
- update با `If-Match`/version برای optimistic concurrency: `GET` و `PATCH` سرآیند `ETag: "<version>"` دارند؛ `PATCH` بدون `If-Match` پاسخ 428 و با نسخهٔ قدیمی 412 می‌گیرد. commandهای وضعیت `expectedVersion` را در body می‌گیرند و تکرار command تحقق‌یافته no-op است.
- commandها به‌صورت زیرمسیر `POST /{resource}/{id}/{command}` پیاده شده‌اند (نه `:{command}`) چون router Fastify دونقطه را پارامتر تفسیر می‌کند.

## ۲. پاسخ و خطا

پیاده‌سازی فعلی بدنهٔ خطا را تخت برمی‌گرداند و `correlationId` همان `x-request-id` پاسخ است:

```json
{
  "status": 409,
  "title": "Conflict",
  "code": "PROJECT_STATE_CONFLICT",
  "detail": "A draft project cannot be changed with \"pause\"."
}
```

قالب هدف قرارداد که در نسخهٔ بعدی API به آن مهاجرت می‌شود:

```json
{
  "error": {
    "code": "PROJECT_STATE_CONFLICT",
    "message": "متن امن و قابل ترجمه",
    "details": {},
    "correlationId": "...",
    "retryable": false
  }
}
```

کدهای پایه: VALIDATION، AUTHENTICATION، AUTHORIZATION، NOT_FOUND، CONFLICT، RATE_LIMITED، PROVIDER_TRANSIENT، PROVIDER_PERMANENT، POLICY_DENIED، WORKFLOW_WAITING، INTERNAL.

## ۳. endpointهای هویت

- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/password/reset-request`
- `POST /auth/password/reset`
- `GET /auth/session` و `GET /me`
- `DELETE /me/sessions`
- `POST /me/password` (تغییر گذرواژه؛ همهٔ نشست‌ها revoke و نشست جاری rotate می‌شود)

`reset-request` همیشه پاسخ عمومی 202 می‌دهد؛ token یک‌بارمصرف فقط digest آن ذخیره و در fragment پیوند (`#token=`) ارسال می‌شود. تا افزودن adapter ایمیل، پیوند با `pnpm admin:reset-link` صادر می‌شود.

## ۴. حوزه‌ها

- `GET/POST /topics` (فیلتر `status=active|archived|deleted|all`)
- `GET/PATCH /topics/{id}`
- `POST /topics/{id}/archive`
- `POST /topics/{id}/restore`
- `DELETE /topics/{id}` (اگر پروژهٔ غیرحذف‌شده‌ای به آن وابسته باشد 409 با فهرست وابستگی)
- `GET /topics/{id}/versions`
- `GET /topics/{id}/dependencies`
- `GET/POST /topics/{id}/assets` (با epic ING)

## ۵. پروژه‌ها

- `GET/POST /projects` (فیلتر `status`، پیش‌فرض همهٔ وضعیت‌ها جز deleted)
- `GET/PATCH /projects/{id}`
- `POST /projects/{id}/activate|pause|resume|complete|reopen|archive|unarchive|restore`
- `DELETE /projects/{id}` (۳۰ روز قابل بازیابی)
- `POST /projects/{id}/clone`
- `GET /projects/{id}/effective-config`
- `GET /projects/{id}/config-snapshots`
- `GET /projects/{id}/timeline`

## ۶. workflow و human task (پیاده‌شده در 0.5.0)

- activate و reopen پروژه یک اجرای Temporal `projectWorkflow` (شناسهٔ `project-{id}-run-{n}`) با ترتیب ثابت تحلیل → تحقیق → ایده‌پردازی → مستندسازی → ارزیابی می‌سازند؛ pause/resume/archive/delete سیگنال متناظر را می‌فرستند.
- `GET /projects/{id}/workflow` — اجرای جاری، مراحل، gate در انتظار و human taskها.
- `POST /projects/{id}/workflow/start` و `POST /projects/{id}/workflow/sync` — شروع یا هم‌ترازکردن دوباره پس از قطع موتور (idempotent)؛ قطع موتور `503 WORKFLOW_ENGINE_UNAVAILABLE`.
- `POST /projects/{id}/workflow/cancel` — لغو با دلیل؛ خروجی‌ها می‌مانند ولی downstream مصرف نمی‌شوند.
- `GET /projects/{id}/stages/{stageRunId}` — همهٔ نسخه‌های خروجی، بازبینی‌ها، gateها و attemptها.
- `POST /projects/{id}/stages/{stageRunId}/outputs/{outputId}/approve|reject|comment|edit` — reject بازخورد لازم دارد و attempt بعدی را می‌سازد؛ edit نسخهٔ جدید می‌سازد و approval/gate نسخهٔ قبلی را `expired` می‌کند؛ بازبینی نسخهٔ جایگزین‌شده `409 WORKFLOW_OUTPUT_SUPERSEDED`.
- `POST /projects/{id}/stages/{stageRunId}/attempt-decision` — پس از سقف attempt (حداکثر ۱۰، قابل کاهش با `workflow.max_attempts_per_stage`) فقط با تصمیم `extend|pass` و دلیل.
- `GET /human-tasks?status=pending`.
- commandهای بازبینی و تصمیم سرآیند `Idempotency-Key` می‌پذیرند؛ تکرار همان کلید پاسخ ذخیره‌شده را با `replayed: true` برمی‌گرداند و کلید تکراری با بدنهٔ متفاوت `409 IDEMPOTENCY_KEY_REUSED` است.
- gate پیش‌فرض دستی است (`workflow.require_human_approval`)؛ در gate خودکار مرحله بدون human task جلو می‌رود.

## ۷. تحلیل

- `GET /projects/{id}/analysis/question-batches`
- `POST /question-batches/{id}/answers`
- `GET /projects/{id}/problem-definitions`
- `POST /problem-definitions/{id}:approve|reject`

Answer submission batch atomic و idempotent است.

## ۸. منابع و دانش (پیاده‌شده در 0.4.0)

### منابع (ING-*)

- `POST /sources/uploads` — اعلام فایل (`filename`, `mime`, `size`, `sha256`, `scope`)؛ پاسخ `201` با URL امضاشدهٔ `PUT` مستقیم به quarantine (اعتبار ۱۵ دقیقه). حجم بیش از `ingestion.max_file_mb` پاسخ `413 SOURCE_TOO_LARGE` و نوع پشتیبانی‌نشده `415 SOURCE_UNSUPPORTED_TYPE` است.
- `POST /sources/{id}/versions/{versionId}/finalize` — تأیید رسیدن فایل با همان حجم و شروع workflow `ingest-{versionId}`؛ پاسخ `202`. پیش از آپلود `409 SOURCE_UPLOAD_INCOMPLETE`.
- `POST /sources/text` و `POST /sources/url` — متن یا URL وارد همان خط لوله می‌شوند؛ URL پیش از ثبت با سیاست `ingestion.url_policy`/`ingestion.url_allowlist` و SSRF guard بررسی و رد آن `400 SOURCE_URL_REJECTED` و رویداد امنیتی است.
- `POST /sources/{id}/versions` — نسخهٔ جدید فایل با `If-Match`؛ lineage با `supersedesVersionId` حفظ و دانش وابسته به نسخهٔ قبلی پس از finalize، `stale` می‌شود.
- `POST /sources/{id}/versions/{versionId}/retry`، `GET /sources`، `GET /sources/{id}`، `GET /sources/{id}/versions/{versionId}/segments` (هر segment، locator صفحه/اسلاید/سلول/خط/بازهٔ زمانی دارد).
- اگر workflow engine در دسترس نباشد فایل در quarantine می‌ماند و پاسخ `503 SOURCE_INGESTION_UNAVAILABLE` است.

وضعیت نسخه: `uploaded → quarantined → scanning → accepted → extracting → indexed | partial`؛ رد در quarantine با `rejected` و `failureCode` (`malware_detected`, `mime_mismatch`, `extension_mismatch`, `unsupported_type`, `checksum_mismatch`, `size_mismatch`, `archive_*`, `url_*`). در نبود حکم «clean» از اسکنر، نسخه `quarantined` با `scan_unavailable` می‌ماند (fail closed).

### دانش (KNO-*)

- `GET/POST /knowledge` — item با `sourceType`، `confidentiality`، `scopes` (workspace/topic/project و نقش اختیاری)، `provenance`، اعتبار زمانی و claim/citation.
- `POST /knowledge/from-source` — دانش کاندید از منبع indexed با claimهای پیشنهادی و locator دقیق (`ING-008`)؛ منبع `partial` فقط با `acceptPartial`.
- `GET /knowledge/{id}`، `GET /knowledge/{id}/versions`، `GET /knowledge/{id}/versions/{versionId}`، `DELETE /knowledge/{id}`.
- `POST /knowledge/{id}/versions` — محتوای جدید با `If-Match`؛ نسخهٔ جدید `pending` و نسخهٔ قبلی `superseded` و ممیزی قبلی stale می‌شود.
- `POST /knowledge/{id}/submit-audit` — ممیزی Brain با rubric `brain-rubric-v1` (شش معیار وزن‌دار) و ثبت score، reason، نسخهٔ rubric و نتیجهٔ claimها.
- `GET /audit-reviews` و `POST /audit-reviews/{id}/override` — override با دلیل حداقل ۲۰ نویسهٔ معنادار، انقضای اختیاری، نشان `humanOverride` و رویداد audit با شدت `critical`.
- `GET /knowledge-conflicts` و `POST /knowledge-conflicts/{id}/resolve`.
- `POST /knowledge/retrieve` — بازیابی ترکیبی lexical (FTS) و vector (`hash-ngram-v1`، pgvector) فقط روی دانش approved، جاری، معتبر و داخل scope/نقش؛ هر نتیجه `conflictWarnings` دارد و کل پاسخ در `retrieval_snapshots` با hash ثابت pin می‌شود. `GET /retrieval-snapshots/{id}` همان نتیجه را برمی‌گرداند.

## ۹. راه‌حل و ارزیابی (پیاده‌شده در 0.6.0)

- `GET|PUT /projects/{id}/solution-criteria`: معیارهای نسخه‌دار؛ وزن معیارهای فعال باید ۱۰۰ شود (`SOLUTION_CRITERIA_INVALID`).
- `POST /projects/{id}/solutions/generate` با `{count?}` (۲ تا ۲۰، پیش‌فرض `solution.count`) → 201؛ خروجی ناقص 409 `SOLUTION_INCOMPLETE` و بدون ذخیره.
- `GET /projects/{id}/solutions`: آخرین مجموعه با امتیاز و توضیح هر معیار و اولویت انتخاب.
- `POST /projects/{id}/solution-selections` با `{solutionIds[], reason?}` به ترتیب اولویت → 201 و یک سند برای هر راه‌حل.
- `GET|PUT /projects/{id}/rubric`: rubric فعال (system یا نسخهٔ پروژه).
- `POST /documents/{id}/evaluate` → 201؛ `GET /evaluations/{id}`.
- `POST /evaluations/{id}/accept-exception` با `{reason}`؛ برای `technical_error` و `passed` مجاز نیست.
- `PATCH /evaluation-findings/{id}` با `{targetStage, reason}`.

## ۱۰. سند (پیاده‌شده در 0.6.0)

- `GET /projects/{id}/documents`؛ `GET /documents/{id}` با `ETag`.
- `PUT /documents/{id}/content` با `If-Match` و `{content, reason, level?}`؛ ساختار نامعتبر 422 `DOCUMENT_INVALID` با `problems`، سند locked 409 `DOCUMENT_LOCKED`.
- `GET /documents/{id}/versions`، `GET /documents/{id}/versions/{versionId}`، `GET /documents/{id}/diff?from=&to=`.
- `POST /documents/{id}/versions/{versionId}/restore` با `{reason}`.
- `POST /documents/{id}/submit|approve|reject|lock|supersede` (reject و supersede دلیل لازم دارند). approve بدون ارزیابی 409 `DOCUMENT_NOT_EVALUATED`، با ارزیابی ناموفق 409 `DOCUMENT_EVALUATION_FAILED` و خارج از سطح طول 409 `DOCUMENT_OUT_OF_BOUNDS`.
- `POST /documents/{id}/exports` با `{format: docx|pdf|pptx}` → 201 و manifest امضاشده؛ `GET /documents/{id}/artifacts`.
- `GET /documents/{id}/artifacts/{artifactId}/download` پس از بررسی دوبارهٔ امضا و authorization؛ بایت دست‌کاری‌شده 409 `DOCUMENT_ARTIFACT_TAMPERED`.
- `GET /documents/{id}/artifacts/{artifactId}/verify` → `{valid, sha256}`.

## ۱۱. ایجنت و config

- `GET /agent-roles`
- `GET/POST /agent-roles/{role}/definitions`
- `POST /agent-roles/{role}/definitions/{id}:activate`
- `GET/PATCH /projects/{id}/agents/{role}`
- `POST /projects/{id}/agents/{role}:copy-default`
- `GET /settings/definitions`
- `GET/PUT /settings/assignments`، `GET /settings/assignments/history`، `POST /settings/assignments/restore`
- `GET /settings/effective?scopeType=&scopeId=` (مقدار مؤثر و منبع هر مقدار)

## ۱۲. provider (پیاده‌شده در 0.5.0)

- `GET/POST /provider-connections` و `GET/PATCH /provider-connections/{id}` — OpenAI، Gemini، Anthropic و fake (غیر production)؛ secret فقط نوشتنی، با envelope encryption (`SECRET_MASTER_KEY`) ذخیره و در هیچ پاسخ، لاگ یا audit برنمی‌گردد؛ پاسخ فقط نسخه و fingerprint دارد. `fallback` همیشه خاموش است.
- `POST /provider-connections/{id}/rotate-secret` — نسخهٔ جدید secret؛ نسخهٔ قبلی قابل‌بازگردانی نیست.
- `POST /provider-connections/{id}/health-check` — بدون دادهٔ مشتری؛ وضعیت healthy/degraded/unavailable/invalid و خطای sanitize‌شده.
- `POST /provider-connections/{id}/models/refresh` و `GET /provider-connections/{id}/models` — catalog زنده به snapshot تاریخ‌دار؛ هیچ نام مدلی در کد نیست و مدل اجرا از تنظیم `ai.model` می‌آید.
- `GET/POST /model-prices` — snapshot قیمت تاریخ‌دار برای برآورد هزینه.
- `GET /model-invocations` و `GET /projects/{id}/usage` — token، latency، finish reason و هزینهٔ برآوردی هر invocation و جمع مرحله/پروژه در بازهٔ زمانی، مقایسه با `ai.max_cost_usd_per_run`.
- retry provider طبق جدول ۵،۵،۵،۱۰،۱۵،۲۰،۲۵،۳۰،۳۵،۴۰ ثانیه (یا `Retry-After` بزرگ‌تر) و پس از آن pause پروژه و human task.

## ۱۳. audit و گزارش (گزارش‌ها پیاده‌شده در 0.7.0)

- `GET /audit-events` (فیلتر project، action یا خانوادهٔ `x.*`، target، actor، severity، بازهٔ زمان)
- `POST /audit-events/export` (JSON/CSV تا ۵۰۰۰ رویداد؛ خودِ export ممیزی می‌شود)
- `POST /retention/purge` (حذف دائمی موارد منقضی با tombstone ممیزی)
- `GET /dashboard?from=&to=`: کارت‌های داشبورد با دادهٔ زنده (بازهٔ مصرف پیش‌فرض ۳۰ روز).
- `GET /reports/usage?from=&to=&projectId=&groupBy=project|stage|day|model`: token و هزینهٔ برآوردی؛ بازه حداکثر ۴۰۰ روز.
- `POST /brain-reports` با `{projectId?, from?, to?}` → 201؛ گزارش پروژه یا workspace با `deviations[]` (rule، clause، role، severity، count، detail، evidence) و `recommendations[]`. هیچ وضعیتی تغییر نمی‌کند.
- `GET /brain-reports?projectId=&limit=` و `GET /brain-reports/{id}`.
- `GET /projects/{id}/usage`: مصرف پروژه نسبت به سقف (از 0.5.0).

## ۱۴. pagination و filter

Cursor opaque، `limit` سقف ۱۰۰، sort allowlist. filter fieldها schema-defined تا query injection یا full scan ناخواسته رخ ندهد.

## ۱۵. operation resource

```json
{
  "id": "uuid",
  "type": "document_export",
  "status": "queued|running|waiting|succeeded|failed|cancelled",
  "progress": 42,
  "result": null,
  "error": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

## ۱۶. API security

- CSRF برای session-auth command؛
- rate limit بر identity/IP hash/route؛
- request size و MIME limit؛
- authorization در application service و RLS؛
- mass assignment ممنوع؛ DTO allowlist؛
- audit برای commandهای حساس؛
- no secret/stack/raw provider response در error.

## ۱۷. اسمارت (Unreleased)

مسیرها زیر `/smart` هستند؛ شرح کامل، مجوزها و کد خطاها در [اسمارت](../01-product/06-smart.md).

- `GET /smart/summary`، `GET /smart/walker/progress?projectId=`
- `POST /smart/errors`، `GET /smart/errors`، `GET /smart/errors/feed?since=`، `GET|PATCH /smart/errors/{id}`
- `GET|POST /smart/conversations`، `GET|DELETE /smart/conversations/{id}`، `POST /smart/conversations/{id}/messages` (۲۰۱؛ مدل همان لحظه و فقط‌خواندنی پاسخ می‌دهد؛ بدون تنظیم مدل `409 AI_NOT_CONFIGURED`)
- `GET|POST /smart/issues`، `GET|PATCH|DELETE /smart/issues/{id}`
- خطای 5xx پاسخ Nest را بدون تغییر می‌فرستد و پس از آن در خطایاب ثبت می‌شود؛ 4xx ثبت نمی‌شود.
