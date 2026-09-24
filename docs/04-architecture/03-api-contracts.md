---
doc_id: DOCOO-API-CONTRACTS
title: اصول و سطح قرارداد API
status: proposed
version: 1.0.0
owner: API Architecture
last_updated: 2026-09-24
notion_sync: true
---

# اصول و سطح قرارداد API

## ۱. اصول

- REST/JSON برای control plane؛ event/stream برای status.
- OpenAPI منبع قرارداد HTTP و از CI validate می‌شود.
- URL نسخهٔ major مانند `/api/v1`.
- resource ID opaque UUID؛ code در filter/lookup مجاز.
- زمان ISO-8601 UTC؛ locale فقط نمایش.
- commandهای قابل‌تکرار `Idempotency-Key` می‌خواهند.
- update با `If-Match`/version برای optimistic concurrency.

## ۲. پاسخ و خطا

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
- `GET /me`
- `DELETE /me/sessions`

## ۴. حوزه‌ها

- `GET/POST /topics`
- `GET/PATCH /topics/{id}`
- `POST /topics/{id}:archive`
- `POST /topics/{id}:restore`
- `DELETE /topics/{id}`
- `GET/POST /topics/{id}/assets`
- `GET /topics/{id}/versions`

## ۵. پروژه‌ها

- `GET/POST /projects`
- `GET/PATCH /projects/{id}`
- `POST /projects/{id}:activate|pause|resume|complete|archive|restore`
- `DELETE /projects/{id}`
- `POST /projects/{id}:clone`
- `GET /projects/{id}/effective-config`
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

## ۸. دانش

- `GET/POST /knowledge`
- `GET /knowledge/{id}/versions/{versionId}`
- `POST /knowledge/{id}/versions`
- `POST /knowledge/{id}:submit-audit`
- `GET /audit-reviews`
- `POST /audit-reviews/{id}:override`
- `GET /knowledge-conflicts`
- `POST /knowledge-conflicts/{id}:resolve`

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
- `GET/PUT /settings/assignments`

## ۱۲. provider

- `GET /providers`
- `PUT /providers/{provider}/connection`
- `POST /providers/{provider}:test`
- `POST /providers/{provider}:rotate-secret`
- `GET /providers/{provider}/models`
- `POST /providers/{provider}/models:refresh`

Secret input write-only است.

## ۱۳. audit و گزارش

- `GET /audit-events`
- `POST /audit-events:export`
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
