---
doc_id: DOCOO-API-CONTRACTS
title: اصول و سطح قرارداد API
status: proposed
version: 1.2.0
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

## ۶. workflow و human task

- `POST /projects/{id}/workflow:start`
- `GET /workflows/{id}`
- `POST /workflows/{id}:pause|resume|cancel`
- `GET /workflows/{id}/stages`
- `POST /stage-runs/{id}:retry`
- `POST /stage-runs/{id}:approve|reject`
- `GET /human-tasks?status=pending`
- `POST /human-tasks/{id}:resolve`

شروع و transition طولانی `202` و operation reference برمی‌گرداند.

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

## ۹. راه‌حل و ارزیابی

- `GET /projects/{id}/solutions`
- `GET /solutions/{id}/versions`
- `POST /projects/{id}/solution-selections`
- `PUT /projects/{id}/criteria-weights`
- `GET /evaluations/{id}`
- `POST /evaluations/{id}:accept-exception`

## ۱۰. سند

- `GET /projects/{id}/documents`
- `GET/PATCH /documents/{id}`
- `GET /documents/{id}/versions`
- `POST /documents/{id}/versions/{versionId}:approve|lock|restore`
- `GET /documents/{id}/diff?from=&to=`
- `POST /documents/{id}/versions/{versionId}/exports`
- `GET /exports/{id}`

دانلود artifact با URL کوتاه‌عمر و authorization مجدد.

## ۱۱. ایجنت و config

- `GET /agent-roles`
- `GET/POST /agent-roles/{role}/definitions`
- `POST /agent-roles/{role}/definitions/{id}:activate`
- `GET/PATCH /projects/{id}/agents/{role}`
- `POST /projects/{id}/agents/{role}:copy-default`
- `GET /settings/definitions`
- `GET/PUT /settings/assignments`، `GET /settings/assignments/history`، `POST /settings/assignments/restore`
- `GET /settings/effective?scopeType=&scopeId=` (مقدار مؤثر و منبع هر مقدار)

## ۱۲. provider

- `GET /providers`
- `PUT /providers/{provider}/connection`
- `POST /providers/{provider}:test`
- `POST /providers/{provider}:rotate-secret`
- `GET /providers/{provider}/models`
- `POST /providers/{provider}/models:refresh`

Secret input write-only است.

## ۱۳. audit و گزارش

- `GET /audit-events` (فیلتر project، action یا خانوادهٔ `x.*`، target، actor، severity، بازهٔ زمان)
- `POST /audit-events/export` (JSON/CSV تا ۵۰۰۰ رویداد؛ خودِ export ممیزی می‌شود)
- `POST /retention/purge` (حذف دائمی موارد منقضی با tombstone ممیزی)
- `POST /brain-reports`
- `GET /brain-reports/{id}`
- `GET /reports/projects/{id}/performance`

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
