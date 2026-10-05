---
doc_id: DOCOO-API-CONTRACTS
title: اصول و سطح قرارداد API
status: proposed
version: 1.7.0
owner: API Architecture
last_updated: 2026-10-04
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

- `GET/POST /projects` (فیلتر `status`، پیش‌فرض همهٔ وضعیت‌ها جز deleted؛ و از 0.17.0 `topicId`، `language` (`fa|en`)، `updatedFrom`/`updatedTo` (تاریخ ISO، بازهٔ بسته)، `waiting=true` (فقط پروژه‌هایی که تصمیم انسانی منتظرشان است) و `q` (جست‌وجو در کد و عنوان)؛ هر ردیف `owner` (`{id, displayName}`) و `waiting` (`{kind, stage}` قدیمی‌ترین human task باز یا `null`) دارد و cursor به مجموعهٔ فیلترها بسته است، نه صفحه‌ای که با فیلتر دیگر گرفته شده). `POST` فیلد اختیاری `solutionCriteria: [{key, label, weight, enabled}]` (۱ تا ۲۰؛ جمع وزن‌های فعال ۱۰۰ وگرنه `400 SOLUTION_CRITERIA_INVALID` و پروژه‌ای ساخته نمی‌شود) را هم می‌پذیرد که نسخهٔ ۱ معیارهای پروژه در همان تراکنش می‌شود (نیاز به `project.update`)؛ و فیلد اختیاری `settings: [{key, value}]` (حداکثر ۴۰) می‌پذیرد؛ تخصیص‌های سطح پروژه در همان تراکنش ساخت پروژه، با دلیل خودکار، افزوده می‌شوند. هر مقدار مثل `PUT /settings/assignments` اعتبار می‌شود (`400 CONFIG_VALUE_INVALID`، کلید ناشناخته `404 CONFIG_SETTING_NOT_FOUND`، کلیدی که سطح پروژه را نمی‌پذیرد `400 CONFIG_SCOPE_NOT_ALLOWED`، کلید تکراری یا حساس `400 CONFIG_VALUE_INVALID`) و فقط نقش دارای `workspace.configure` می‌تواند `settings` بدهد (`403`). حسابرسی فقط کلیدها را می‌نویسد.
- هر پروژه `availableCommands` دارد: فرمان‌هایی که ماشین حالت در وضعیت فعلی می‌پذیرد (پس از مهلت ۳۰روزه `restore` حذف می‌شود)؛ بک‌آفیس دقیقاً همین‌ها را پیشنهاد می‌دهد.
- `GET/PATCH /projects/{id}` (پاسخ `approvedProblemVersionId` دارد: خروجی تأییدشدهٔ مرحلهٔ تحلیل؛ بخش ۷)
- `POST /projects/{id}/activate|pause|resume|complete|reopen|archive|unarchive|restore`
- `DELETE /projects/{id}` (۳۰ روز قابل بازیابی)
- `POST /projects/{id}/clone`
- `GET /projects/{id}/effective-config`
- `GET /projects/{id}/config-snapshots`
- `GET /projects/{id}/timeline`

## ۶. workflow و human task (پیاده‌شده در 0.5.0)

- activate و reopen پروژه یک اجرای Temporal `projectWorkflow` (شناسهٔ `project-{id}-run-{n}`) با ترتیب ثابت تحلیل → تحقیق → ایده‌پردازی → مستندسازی → ارزیابی می‌سازند؛ pause/resume/archive/delete سیگنال متناظر را می‌فرستند.
- `GET /projects/{id}/workflow` — اجرای جاری، مراحل، gate در انتظار و human taskها.
- `POST /projects/{id}/workflow/start` و `POST /projects/{id}/workflow/sync` — شروع یا هم‌ترازکردن دوباره پس از قطع موتور (idempotent)؛ sync سیگنال `answers` گم‌شدهٔ یک batch کامل را هم دوباره می‌فرستد؛ قطع موتور `503 WORKFLOW_ENGINE_UNAVAILABLE`.
- `POST /projects/{id}/workflow/cancel` — لغو با دلیل؛ خروجی‌ها می‌مانند ولی downstream مصرف نمی‌شوند.
- `GET /projects/{id}/stages/{stageRunId}` — همهٔ نسخه‌های خروجی، بازبینی‌ها، gateها و attemptها.
- `POST /projects/{id}/stages/{stageRunId}/outputs/{outputId}/approve|reject|comment|edit` — reject بازخورد لازم دارد و attempt بعدی را می‌سازد؛ edit نسخهٔ جدید می‌سازد و approval/gate نسخهٔ قبلی را `expired` می‌کند؛ بازبینی نسخهٔ جایگزین‌شده `409 WORKFLOW_OUTPUT_SUPERSEDED`.
- `POST /projects/{id}/stages/{stageRunId}/attempt-decision` — پس از سقف attempt (حداکثر ۱۰، قابل کاهش با `workflow.max_attempts_per_stage`) فقط با تصمیم `extend|pass` و دلیل.
- `GET /human-tasks?status=pending`.
- commandهای بازبینی و تصمیم سرآیند `Idempotency-Key` می‌پذیرند؛ تکرار همان کلید پاسخ ذخیره‌شده را با `replayed: true` برمی‌گرداند و کلید تکراری با بدنهٔ متفاوت `409 IDEMPOTENCY_KEY_REUSED` است.
- gate پیش‌فرض دستی است (`workflow.require_human_approval`)؛ در gate خودکار مرحله بدون human task جلو می‌رود.

## ۷. تحلیل (پیاده‌شده در 0.12.0، [ADR-0014](../adr/0014-analyst-questions-and-answers.md))

- `GET /projects/{id}/analysis` — وضعیت (`phase`: `not_started|answering|analysing|awaiting_approval|approved|cancelled`)، حدها (`minimum` ۳۰، `maximum` ۳۰۰، `batchSize` ۴۰)، `progress` (پرسیده، پاسخ‌داده، بی‌پاسخ، نامربوط، بعداً، منتظر)، `coverage` ده بُعد با سطح (`none|pending|not_applicable|gap|partial|covered`) و `coverageGaps`، `openBatchId`، `understanding` («آنچه فهمیدم» و «ابهام بعدی» آخرین دور)، `contradictions`، صف `followUps` («بعداً») و `definition` جاری با `unresolvedQuestions`. همهٔ بخش‌ها از یک snapshot خوانده می‌شوند.
- `GET /projects/{id}/analysis/question-batches` — batchهای اجرای جاری با سؤال‌ها (شماره، بُعد، دلیل پرسش، ادامهٔ کدام سؤال)، پاسخ جاری هر سؤال و تعداد بازنگری‌ها.
- `POST /question-batches/{id}/answers` با `{answers: [{questionId, status: answered|unanswered|irrelevant|later, text?, attachments?: [{sourceId}]}]}` (۱ تا ۴۰ پاسخ) و `Idempotency-Key` اختیاری → 200 با `{saved, counts, remainingOpen, batchStatus, replayed}`. همه یا هیچ: یک پاسخ نامعتبر چیزی ذخیره نمی‌کند. `answered` متن یا فایل می‌خواهد (`ANSWER_EMPTY`)، متن تا ۸۰۰۰ نویسه (`ANSWER_TOO_LONG`)، تا ۵ فایل (`ANSWER_TOO_MANY_ATTACHMENTS`)، سه وضعیت دیگر فایل ندارند (`ANSWER_STATUS_HAS_ATTACHMENTS`) → 422. فایل باید source همین پروژه باشد (404 `ANALYSIS_ATTACHMENT_NOT_FOUND`، 409 `ANALYSIS_ATTACHMENT_NOT_READY` پیش از finalize، 409 `ANALYSIS_ATTACHMENT_UNUSABLE` برای ردشده/ناموفق). بعد از بسته‌شدن batch فقط سؤال‌های `later` پاسخ می‌گیرند (409 `ANALYSIS_QUESTION_CLOSED`)؛ تعریف منتظر تصمیم (409 `ANALYSIS_AWAITING_APPROVAL`) یا مرحلهٔ بسته (409 `ANALYSIS_CLOSED`) پاسخ نمی‌پذیرد. با کامل‌شدن batch (هیچ سؤال `open` نماند) سیگنال `answers` به workflow می‌رود.
- `POST /projects/{id}/analysis/finish` با `{reason}` (حداقل ۳ نویسه) → درخواست تعریف مسئله به‌جای پرسش بیشتر؛ فقط از ۳۰ سؤال به بعد (409 `ANALYSIS_MINIMUM_NOT_REACHED`) و بدون سؤال باز (409 `ANALYSIS_ANSWERS_PENDING`).
- `GET /projects/{id}/problem-definitions` — نسخه‌های تعریف مسئله (خروجی‌های مرحلهٔ تحلیل در همهٔ اجراها) با `status` (`draft|awaiting_approval|approved|rejected|superseded`)، `approved` و `approvedOutputId`.
- تأیید و رد تعریف همان فرمان‌های بازبینی مرحله است (`POST /projects/{id}/stages/{stageRunId}/outputs/{outputId}/approve|reject`، بخش ۶)؛ ویرایش دستی آن `…/edit` است. gate تحلیل همیشه دستی است. رد، تحلیل را با بازخورد به تحلیلگر برمی‌گرداند.

مجوزها: خواندن `project.read`، پاسخ `analysis.answer`، پایان زودهنگام `workflow.approve` ([ماتریس](../05-security/03-authorization-matrix.md)).

## ۸. منابع و دانش (پیاده‌شده در 0.4.0؛ افزوده‌های رابط در 0.14.0، [ADR-0016](../adr/0016-knowledge-screens.md))

### منابع (ING-*)

- `POST /sources/uploads` — اعلام فایل (`filename`, `mime`, `size`, `sha256`, `scope`)؛ پاسخ `201` با URL امضاشدهٔ `PUT` مستقیم به quarantine (اعتبار ۱۵ دقیقه). حجم بیش از `ingestion.max_file_mb` پاسخ `413 SOURCE_TOO_LARGE` و نوع پشتیبانی‌نشده `415 SOURCE_UNSUPPORTED_TYPE` است.
- `POST /sources/{id}/versions/{versionId}/finalize` — تأیید رسیدن فایل با همان حجم و شروع workflow `ingest-{versionId}`؛ پاسخ `202`. پیش از آپلود `409 SOURCE_UPLOAD_INCOMPLETE`.
- `POST /sources/text` و `POST /sources/url` — متن یا URL وارد همان خط لوله می‌شوند؛ URL پیش از ثبت با سیاست `ingestion.url_policy`/`ingestion.url_allowlist` و SSRF guard بررسی و رد آن `400 SOURCE_URL_REJECTED` و رویداد امنیتی است.
- `POST /sources/{id}/versions` — نسخهٔ جدید فایل با `If-Match`؛ lineage با `supersedesVersionId` حفظ و دانش وابسته به نسخهٔ قبلی پس از finalize، `stale` می‌شود.
- `POST /sources/{id}/versions/{versionId}/retry`، `GET /sources`، `GET /sources/{id}`، `GET /sources/{id}/versions/{versionId}/segments` (هر segment، locator صفحه/اسلاید/سلول/خط/بازهٔ زمانی دارد).
- `GET /sources` علاوه بر `status` فیلتر `scopeType`+`scopeId` (هر دو یا هیچ) و `q` (عنوان؛ wildcardها داده‌اند نه الگو) دارد. هر منبع `scope.title` (حوزه یا پروژه) و `knowledge` (دانش ساخته‌شده از آن: `id`، `title`، `status`، `stale`) را می‌دهد؛ `GET /sources/{id}` نیز.
- اگر workflow engine در دسترس نباشد فایل در quarantine می‌ماند و پاسخ `503 SOURCE_INGESTION_UNAVAILABLE` است.

وضعیت نسخه: `uploaded → quarantined → scanning → accepted → extracting → indexed | partial`؛ رد در quarantine با `rejected` و `failureCode` (`malware_detected`, `mime_mismatch`, `extension_mismatch`, `unsupported_type`, `checksum_mismatch`, `size_mismatch`, `archive_*`, `url_*`). در نبود حکم «clean» از اسکنر، نسخه `quarantined` با `scan_unavailable` می‌ماند (fail closed).

### دانش (KNO-*)

- `GET/POST /knowledge` — item با `sourceType`، `confidentiality`، `scopes` (workspace/topic/project و نقش اختیاری)، `provenance`، اعتبار زمانی و claim/citation. فهرست علاوه بر `status` (وضعیت دیده‌شده؛ `expired` برای تأییدشدهٔ دارای اعتبار تمام‌شده) فیلتر `sourceType`، `scopeType`+`scopeId` و `q` دارد و هر ردیف `versionNo`، `overall`، `decision`، `effectiveDecision`، `scopes` (با `title`)، `claimCount`، `openConflicts`، `validUntil` و `staleReason` می‌دهد.
- `POST /knowledge/from-source` — دانش کاندید از منبع indexed با claimهای پیشنهادی و locator دقیق (`ING-008`)؛ منبع `partial` فقط با `acceptPartial`.
- `GET /knowledge/{id}/uses?limit=` — بازیابی‌هایی که ایجنت‌ها از این دانش کردند: `items[]` با `projectId/projectTitle`، `stage`، `attemptNo`، `role`، `query`، `versionNos`، `snapshotId`، `cited` (ارجاع تأییدشدهٔ همان attempt) و `totals` ({`retrievals`، `cited`}). آزمون بازیابی دستی حساب نمی‌شود ([ADR-0017](../adr/0017-research-with-knowledge-and-role-evaluation.md)).
- `GET /knowledge/{id}`، `GET /knowledge/{id}/versions`، `GET /knowledge/{id}/versions/{versionId}`، `DELETE /knowledge/{id}`.
- `GET /knowledge-claims` — نمای ادعای صف ممیزی: ادعای نسخه‌های جاری با `supported`/`supportReason` (نتیجهٔ Brain؛ `null` پیش از ممیزی)، `citations` (`total`، `complete`)، `openConflicts` و `effectiveDecision`؛ فیلتر `status`، `supported` (`yes|no|unaudited`)، `conflicted`، `kind`، `knowledgeId`.
- `POST /knowledge/{id}/versions` — محتوای جدید با `If-Match`؛ نسخهٔ جدید `pending` و نسخهٔ قبلی `superseded` و ممیزی قبلی stale می‌شود. به‌جای `content` می‌توان `sourceVersionId` (و `acceptPartial`) داد تا متن و ادعاها از نسخهٔ جدید همان منبع بیایند (تازه‌سازی دانش `stale`)؛ دقیقاً یکی از این دو، و `claims` فقط با `content`. دانشی که از منبع نیامده `409 KNOWLEDGE_NO_SOURCE` و نسخهٔ منبعی دیگر `404 SOURCE_VERSION_NOT_FOUND` می‌گیرد.
- `POST /knowledge/{id}/submit-audit` — ممیزی Brain با rubric `brain-rubric-v1` (شش معیار وزن‌دار) و ثبت score، reason، نسخهٔ rubric و نتیجهٔ claimها.
- `GET /audit-reviews` و `POST /audit-reviews/{id}/override` — override با دلیل حداقل ۲۰ نویسهٔ معنادار، انقضای اختیاری، نشان `humanOverride` و رویداد audit با شدت `critical`.
- `GET /knowledge-conflicts` و `POST /knowledge-conflicts/{id}/resolve`. فهرست فقط تعارض میان ادعاهای در حال استفاده (نسخهٔ جاری دانش حذف‌نشده) را می‌دهد، مگر `all=true`؛ فیلتر `status` و `knowledgeId`؛ هر طرف `title` سندش را دارد.
- هر فهرست دانش، ادعا و منبع cursor بسته به فیلترهایش دارد؛ cursor یک فیلتر با فیلتر دیگر `400 *_CURSOR_INVALID` می‌گیرد.
- `POST /knowledge/retrieve` — بازیابی ترکیبی lexical (FTS) و vector (`hash-ngram-v1`، pgvector) فقط روی دانش approved، جاری، معتبر و داخل scope/نقش؛ هر نتیجه `conflictWarnings` دارد و کل پاسخ در `retrieval_snapshots` با hash ثابت pin می‌شود. `GET /retrieval-snapshots/{id}` همان نتیجه را برمی‌گرداند.

## ۹. راه‌حل و ارزیابی (پیاده‌شده در 0.6.0)

- `GET /solution-criteria/defaults` (`workspace.read`): معیارهای پیش‌فرضی که پروژهٔ تازه با آن‌ها شروع می‌کند (برای wizard)؛ `GET|PUT /projects/{id}/solution-criteria`: معیارهای نسخه‌دار؛ وزن معیارهای فعال باید ۱۰۰ شود (`SOLUTION_CRITERIA_INVALID`).
- `POST /projects/{id}/solutions/generate` با `{count?}` (۲ تا ۲۰، پیش‌فرض `solution.count`) → 201؛ خروجی ناقص 409 `SOLUTION_INCOMPLETE` و بدون ذخیره.
- `GET /projects/{id}/solutions`: آخرین مجموعه با امتیاز و توضیح هر معیار و اولویت انتخاب.
- `POST /projects/{id}/solution-selections` با `{solutionIds[], reason?}` به ترتیب اولویت → 201 و یک سند برای هر راه‌حل.
- `GET|PUT /projects/{id}/rubric`: rubric فعال (system یا نسخهٔ پروژه).
- `POST /documents/{id}/evaluate` → 201؛ `GET /evaluations/{id}`.
- `POST /evaluations/{id}/accept-exception` با `{reason}`؛ برای `technical_error` و `passed` مجاز نیست.
- `PATCH /evaluation-findings/{id}` با `{targetStage, reason}`.

## ۱۰. سند (پیاده‌شده در 0.6.0)

- `GET /projects/{id}/documents`؛ `GET /documents/{id}` با `ETag` و `defaultExportFormat` (از `document.default_export_format`؛ همهٔ قالب‌ها مجازند، فقط اولی پیشنهاد می‌شود).
- `PUT /documents/{id}/content` با `If-Match` و `{content, reason, level?}`؛ ساختار نامعتبر 422 `DOCUMENT_INVALID` با `problems`، سند locked 409 `DOCUMENT_LOCKED`.
- `GET /documents/{id}/versions`، `GET /documents/{id}/versions/{versionId}`، `GET /documents/{id}/diff?from=&to=`.
- `POST /documents/{id}/versions/{versionId}/restore` با `{reason}`.
- `POST /documents/{id}/submit|approve|reject|lock|supersede` (reject و supersede دلیل لازم دارند). approve بدون ارزیابی 409 `DOCUMENT_NOT_EVALUATED`، با ارزیابی ناموفق 409 `DOCUMENT_EVALUATION_FAILED` و خارج از سطح طول 409 `DOCUMENT_OUT_OF_BOUNDS`.
- نگارش با مستندساز (از 0.17.0، [ADR-0019](../adr/0019-document-writing-and-structured-editor.md)، `document.edit`): `POST /documents/{id}/writings` با `{level?, template?, notes?}` → 201 با `writing` (`status`: `queued|running|paused|succeeded|failed|cancelled`، `phase`: `preparing|outlining|writing|fitting|saving|done`، `blockCode`، `errorCode`، `plan`، پیشرفت، `report` پس از پایان)؛ فقط یک نگارش زنده برای هر سند (409 `DOCUMENT_WRITING_ACTIVE`)، سند قفل‌شده 409 `DOCUMENT_LOCKED`، سند بدون راه‌حل 409 `DOCUMENT_HAS_NO_SOLUTION`، نبودن اتصال/مدل 409 `AI_NOT_CONFIGURED`، قالب نامعتبر 400 `DOCUMENT_TEMPLATE_UNKNOWN`. `GET /documents/{id}/writings` و `GET …/writings/{writingId}` (`document.read`) برای فهرست و جزئیات؛ `POST …/writings/{writingId}/pause|resume|cancel` سیگنال گردش‌کارند (`409 DOCUMENT_WRITING_FINISHED|DOCUMENT_WRITING_PAUSED|DOCUMENT_WRITING_NOT_PAUSED`). تا پایان نگارش، `PUT content`، restore، فرمان‌های وضعیت و supersede 409 `DOCUMENT_WRITING_ACTIVE` می‌دهند. نتیجه نسخهٔ جدیدی با `origin=model` است.
- `POST /documents/{id}/check` (`document.edit`، بدون اثر جانبی) با `{content, level?}` → `{check: {valid, problems[], compliance?, references?}}`: همان اعتبارسنجی ساختار و شمارش رسمی و بازهٔ سطح که ذخیره می‌کند، برای ویرایشگر ساختاریافته.
- `POST /documents/{id}/exports` با `{format: docx|pdf|pptx}` → 201 و manifest امضاشده؛ `GET /documents/{id}/artifacts`.
- `GET /documents/{id}/artifacts/{artifactId}/download` پس از بررسی دوبارهٔ امضا و authorization؛ بایت دست‌کاری‌شده 409 `DOCUMENT_ARTIFACT_TAMPERED`.
- `GET /documents/{id}/artifacts/{artifactId}/verify` → `{valid, sha256}`.

## ۱۱. ایجنت و config (ایجنت‌ها پیاده‌شده در 0.13.0، [ADR-0015](../adr/0015-agent-definitions.md))

همهٔ مسیرها زیر `/workspaces/{workspaceId}` هستند. فرمان‌های نوشتن `Idempotency-Key` می‌پذیرند و خطا با `code` پایدار برمی‌گردد.

### نقش‌ها و نسخه‌ها

- `GET /agent-roles` (`agent_definition.read`) — شش نقش با نسخهٔ فعال، شمارش اصول/وظایف/ابزار و سقف ابزار.
- `GET /agent-roles/{role}` — تعریف فعال کامل، `latestSequence`، سقف ابزار، قالب خروجی (فقط‌خواندنی؛ `null` برای brain)، `modelWarnings` و `performance` (آخرین گزارش Brain workspace دربارهٔ همین نقش).
- `GET /agent-roles/{role}/definitions?limit=&before=` — تاریخچهٔ نسخه‌ها از جدید به قدیم با `active` و `changedSections`.
- `POST /agent-roles/{role}/definitions` (`agent_definition.version`) — بدنه `{changes: {principles?, duties?, promptTemplate?, tools?, modelPolicy?}, reason, baseVersionId?, expectedSequence?}`؛ نسخهٔ تازه می‌سازد و فعال نمی‌کند. خطاها: `422 AGENT_INVALID_DEFINITION` با `issues` و `problems` (`field:code[:index]`)، `400 AGENT_NO_CHANGES`، `412 AGENT_VERSION_STALE`.
- `POST /agent-roles/{role}/definitions/{definitionId}/activate` (`agent_definition.activate`) — `{reason}`؛ برگشتی `{definition, changed}`. فعال‌کردن نسخهٔ قدیمی‌تر همان بازگشت است.
- `GET /agent-roles/{role}/outputs?limit=&cursor=` — خروجی‌های نقش در workspace؛ فقط فراداده (پروژه، مرحله، نسخه، نسخهٔ تعریف)، هرگز محتوا.

### پروژه

- `GET /projects/{id}/agents` — برای هر نقش: نسخهٔ مؤثر، `pinned`، `customized`، پیش‌فرض فعلی و `behindDefault`.
- `GET /projects/{id}/agents/{role}` — تعریف مؤثر، پیش‌فرض فعلی، نسخه‌های کپی پروژه و هشدارهای مدل.
- `POST /projects/{id}/agents/{role}/copy-default` (`agent_definition.update`) — `{reason}`؛ کپی مستقل از پیش‌فرض فعلی (`409 AGENT_ALREADY_CUSTOMIZED` اگر کپی دارد).
- `PATCH /projects/{id}/agents/{role}` — ویرایش کپی پروژه (نسخهٔ تازهٔ همان کپی)؛ `409 AGENT_NOT_CUSTOMIZED` پیش از کپی.
- `POST /projects/{id}/agents/{role}/pin` — `{reason, versionId?}`؛ بدون `versionId` پروژه به پیش‌فرض فعلی می‌رود، با آن به نسخهٔ پیش‌فرض یا کپی قبلی خودش (`404 AGENT_VERSION_NOT_FOUND` برای نسخهٔ نقش یا پروژهٔ دیگر).

### تنظیمات

- `GET /settings/definitions`
- `GET/PUT /settings/assignments`، `GET /settings/assignments/history`، `POST /settings/assignments/restore`
- `GET /settings/effective?scopeType=&scopeId=` (مقدار مؤثر و منبع هر مقدار)
- `POST /settings/preview` (`workspace.read`، پاسخ ۲۰۰، بدون اثر جانبی) با `{topicIds: [≤۲۰], settings: [{key, value} ≤۴۰]}` → `{config}`: مقدار مؤثر و منبع هر کلید برای پروژه‌ای که هنوز ساخته نشده است. منبع انتخاب‌های ارسالی `{scope: 'project', pending: true}` است. حوزه‌ها به ترتیب اعمال می‌شوند (اولویت ۱ برنده)؛ مقدار نامعتبر همان `400 CONFIG_VALUE_INVALID` را می‌دهد.
- قاعدهٔ معنایی علاوه بر schema: `document.level_bounds` باید ده عدد باشد که برای هر سطح کمینه < بیشینه و هر سطح بالاتر از بیشینهٔ سطح قبل شروع شود؛ نقض آن `400 CONFIG_VALUE_INVALID` با شرح مشکل است (قاعدهٔ همان `levelBoundsProblem` در `@docoo/documents`).
- تنظیم‌های افزوده‌شده در 0.17.0: `document.default_export_format` (`docx|pdf|pptx`)، `document.writing.knowledge_limit` (۰ تا ۳۰)، `document.writing.fit_rounds` (۰ تا ۳)، `analysis.require_risk_dimension` و `analysis.require_out_of_scope_dimension` (بولی؛ هشت بُعد لازم همیشه لازم می‌مانند). `research.max_sources` و `knowledge.min_audit_score` از همین نسخه اعمال می‌شوند.
- `GET /document-templates` (`workspace.read`) → `{templates: [{key, version, sections}], levelDefaults, countAlgorithm}`. قالب‌ها متن کد و نسخه‌دارند (`brief-v1`، `standard-v1`، `detailed-v1`)؛ `document.default_template` یکی از `brief|standard|detailed` است و شکل پیش‌نویس اول سند راه‌حل را تعیین می‌کند.

## ۱۲. provider (پیاده‌شده در 0.5.0)

- `GET/POST /provider-connections` و `GET/PATCH /provider-connections/{id}` — OpenAI، Gemini، Anthropic و fake (غیر production)؛ secret فقط نوشتنی، با envelope encryption (`SECRET_MASTER_KEY`) ذخیره و در هیچ پاسخ، لاگ یا audit برنمی‌گردد؛ پاسخ فقط نسخه و fingerprint دارد. `fallback` همیشه خاموش است.
- `POST /provider-connections/{id}/rotate-secret` — نسخهٔ جدید secret؛ نسخهٔ قبلی قابل‌بازگردانی نیست.
- `POST /provider-connections/{id}/health-check` — بدون دادهٔ مشتری؛ وضعیت healthy/degraded/unavailable/invalid و خطای sanitize‌شده.
- `POST /provider-connections/{id}/models/refresh` و `GET /provider-connections/{id}/models` — catalog زنده به snapshot تاریخ‌دار؛ هیچ نام مدلی در کد نیست و مدل اجرا از تنظیم `ai.model` می‌آید.
- `GET/POST /model-prices` — snapshot قیمت تاریخ‌دار برای برآورد هزینه. `GET` علاوه بر `items` این‌ها را دارد: `fallback` (`{inputPerMillion, outputPerMillion}` که برای مدل بی‌قیمت به کار می‌رود تا سقف هزینه خاموش نشود) و `defaultModel: {provider, model, priced} | null` (مدل پیش‌فرض و اینکه قیمت دارد یا نه). `POST` (`provider.configure`) ردیف تازه می‌سازد و ردیف قبلی را نمی‌نویسد ([ADR-0020](../adr/0020-real-provider-readiness.md)).
- `GET /model-invocations` و `GET /projects/{id}/usage` — token، latency، finish reason و هزینهٔ برآوردی هر invocation و جمع مرحله/پروژه در بازهٔ زمانی، مقایسه با `ai.max_cost_usd_per_run`. هر invocation `priced` (قیمت واقعی یا برآورد با قیمت پیش‌فرض) و در شکست `errorDetail` دارد: دلیلی که provider گفته، sanitize‌شده و حداکثر ۳۰۰ نویسه. جمع مصرف `unpricedInvocations` (شمار تماس‌های بی‌قیمت) را هم می‌دهد.
- `GET /provider-connections/{id}/self-check` (`provider.read`) → `{steps: [...]}`: نُه گام آزمون خودکار مدل. `POST` (`provider.test`، پاسخ ۲۰۰) با `{model, step, language: 'fa'|'en'}` یک گام را با یک تماس واقعی اجرا می‌کند و `{result}` می‌دهد: `step`، `status` (`passed|failed`)، `problem`، `errorKind`، `errorCode`، `errorDetail`، `finishReason`، `latencyMs`، `inputTokens`، `outputTokens`، `reasoningTokens`، `costUsd`، `priced`. شکست provider ۴xx/۵xx خطای HTTP نیست؛ `status = failed` با دلیلش است. تماس با `purpose = selfcheck:<گام>` و بدون پروژه ثبت می‌شود. گام ناشناخته ۴۰۰ می‌دهد.
- retry provider طبق جدول ۵،۵،۵،۱۰،۱۵،۲۰،۲۵،۳۰،۳۵،۴۰ ثانیه (یا `Retry-After` بزرگ‌تر) و پس از آن pause پروژه و human task.

## ۱۳. audit و گزارش (گزارش‌ها پیاده‌شده در 0.7.0)

- `GET /audit-events` (فیلتر project، action یا خانوادهٔ `x.*`، target، actor، severity، بازهٔ زمان)
- `POST /audit-events/export` (JSON/CSV تا ۵۰۰۰ رویداد؛ خودِ export ممیزی می‌شود)
- `POST /retention/purge` (حذف دائمی موارد منقضی با tombstone ممیزی)
- `GET /dashboard?from=&to=`: کارت‌های داشبورد با دادهٔ زنده (بازهٔ مصرف پیش‌فرض ۳۰ روز).
- `GET /reports/usage?from=&to=&projectId=&groupBy=project|stage|day|model`: token و هزینهٔ برآوردی؛ بازه حداکثر ۴۰۰ روز.
- `POST /brain-reports` با `{projectId?, from?, to?, modelEvaluation?}` → 201؛ گزارش پروژه یا workspace با `deviations[]` (rule، clause، role، severity، count، detail، evidence) و `recommendations[]`. هیچ وضعیتی تغییر نمی‌کند. با `modelEvaluation: true` (پیش‌فرض false؛ هر نقش یک فراخوانی مدل) گزارش `evaluations[]` هم دارد: برای هر یک از پنج نقش مرحله `status`، `reason`، `score` ۱ تا ۵، `summary`، `charterVersionId`، `samples[]`، `findings[]` (هر یافته با `clauses[]` و `evidence[]` ‌ـ یافتهٔ بی‌شاهد دور ریخته می‌شود)، `discarded` و `errorCode`؛ `summary.modelEvaluation` شمارهٔ نسخهٔ داور و شمارش‌ها را دارد. نقشی که نمی‌تواند سنجیده شود (`no_samples`، `ai_not_configured`، `provider_failure`، `invalid_output`) گزارش را از بین نمی‌برد ([ADR-0017](../adr/0017-research-with-knowledge-and-role-evaluation.md)).
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
