---
doc_id: DOCOO-DATA-DICTIONARY
title: فرهنگ داده هسته Docoo
status: approved-baseline
version: 1.2.0
owner: Data Architecture
last_updated: 2026-10-04
notion_sync: true
---

# فرهنگ دادهٔ هسته Docoo

## قرارداد عمومی همهٔ جدول‌های tenant-scoped

| فیلد           | نوع                  | قاعده                  |
| -------------- | -------------------- | ---------------------- |
| `id`           | uuid                 | UUIDv7، تغییرناپذیر    |
| `workspace_id` | uuid                 | اجباری، کلید RLS       |
| `created_at`   | timestamptz          | UTC، server-generated  |
| `created_by`   | uuid                 | user/service principal |
| `updated_at`   | timestamptz          | برای logical head      |
| `version`      | bigint               | optimistic concurrency |
| `deleted_at`   | timestamptz nullable | soft delete            |

## workspace

| فیلد                  | نوع  | توضیح                       |
| --------------------- | ---- | --------------------------- |
| `name`                | text | نام فنی workspace           |
| `default_locale`      | enum | `fa`, `en`                  |
| `retention_policy_id` | uuid | policy فعال                 |
| `status`              | enum | active, suspended, archived |

## topic_domain

| فیلد                  | نوع    | توضیح                     |
| --------------------- | ------ | ------------------------- |
| `code`                | citext | یکتا، قابل‌ویرایش         |
| `title`               | citext | یکتا در workspace         |
| `description_head_id` | uuid   | نسخهٔ شرح فعال            |
| `default_language`    | enum   | زبان محتوای ترجیحی        |
| `status`              | enum   | active, archived, deleted |

## project

| فیلد                          | نوع                  | توضیح                                         |
| ----------------------------- | -------------------- | --------------------------------------------- |
| `code`                        | citext               | یکتا در workspace                             |
| `title`                       | text                 | عنوان مدیرپسند                                |
| `status`                      | enum                 | state machine رسمی                            |
| `initial_problem`             | text                 | ورودی اصلی، immutable versioned               |
| `approved_problem_version_id` | uuid nullable        | خروجی تأییدشدهٔ مرحلهٔ تحلیل (`stage_output`) |
| `output_language`             | enum                 | fa یا en                                      |
| `current_stage`               | enum                 | analysis..evaluation                          |
| `workflow_id`                 | uuid                 | workflow فعال                                 |
| `purge_at`                    | timestamptz nullable | حذف دائمی برنامه‌ریزی‌شده                     |

## project_topic

`project_id`, `topic_id`, `priority` integer unique per project، `conflict_instruction` text nullable. حذف رابطه versioned و audit می‌شود.

## configuration

### setting_definition

`key`, `json_schema`, `default_value`, `allowed_scopes`, `merge_strategy`, `sensitivity`, `ui_schema`, `status`.

### config_assignment

`definition_id`, `scope_type`, `scope_id`, `value`, `value_hash`, `sequence`, `reason`, `effective_from`, `effective_until`.

### resolved_config_snapshot

`subject_type/id`, `resolved_json`, `source_map_json`, `hash`, `schema_version`. این snapshot immutable است.

## agent catalog

### agent_definition_versions

یک نسخهٔ تغییرناپذیر (append-only) از تعریف یک نقش: `role`، `project_id` (تهی = جریان پیش‌فرض workspace؛ پر = کپی همان پروژه)، `sequence` (جدا برای هر جریان)، `principles` و `duties` (فهرست متن)، `prompt_template`، `tools` (allowlist)، `model_policy` (تهی یا `{connectionId, model}`)، `output_schema_id`، `changed_sections`، `base_version_id`، `reason`، `created_by`. CHECK ها حد فهرست‌ها و طول متن‌ها و سقف ابزار هر نقش را حتی برای نویسندهٔ معیوب نگه می‌دارند.

### agent_roles

اشارهٔ نسخهٔ فعال پیش‌فرض هر نقش در workspace: `(workspace_id, role)`، `active_version_id` (باید نسخهٔ workspace از همان نقش باشد، trigger)، `activated_by`.

### project_agent_profiles

آنچه پروژه برای یک نقش اجرا می‌کند: `(project_id, role)`، `definition_version_id`، `customized` (false = نسخهٔ پیش‌فرض سنجاق‌شده؛ true = کپی خود پروژه؛ trigger پروژهٔ دیگر را رد می‌کند)، `pinned_by`.

### agent_tool_calls

ledger تغییرناپذیر (append-only، RLS) تماس‌های ابزار ایجنت‌ها (FR-AGT-005): `project_id`، `stage_run_id`، `attempt_id`، `role`، `agent_definition_version_id` (کلید ترکیبی با workspace)، `tool` (یکی از ابزارهای شناخته‌شده، CHECK)، `decision` (`allowed|denied`)، `input_sha256` (فقط digest ۶۴ هگزا، CHECK)، `output_ref` (مثلاً `{type: "retrieval_snapshot", id}`)، `result` (شمارش‌ها و شناسه‌ها؛ برای بازیابی `results` و `knowledgeIds`، برای `citation_verifier` شمارش‌های تأیید و `cited[{ref, knowledgeId, versionId}]`)، `latency_ms`، `error_code`. ایندکس GIN روی `result` صفحهٔ «کجا استفاده شد» دانش را می‌دهد.

### brain_reports.evaluations

آرایهٔ ارزیابی مدل‌محور نقش‌ها در گزارش Brain (پیش‌فرض `[]`، مثل بقیهٔ ستون‌های گزارش تغییرناپذیر): برای هر نقش `status` (`completed|skipped|failed`)، `reason`، `score` (۱ تا ۵)، `summary`، نسخهٔ منشور سنجیده‌شده، نمونه‌ها (`S#` با شناسهٔ خروجی مرحله)، `findings[]` با `kind`، `severity`، `clauses[]` (بند و متن منشور) و `evidence[]` (`stage_output` با شناسه)، شمار یافته‌های دورریخته، `invocation_id` و `errorCode`. خلاصه در `summary.modelEvaluation`.

### ثبت اجرا

`stage_attempts.agent_definition_version_id` و `model_invocations.agent_definition_version_id` به‌علاوهٔ `model_invocations.prompt_sha256` (هش دستور و پیام ارسال‌شده؛ متن ذخیره نمی‌شود). `model_invocations.error_detail` (مهاجرت 0027) دلیل خطای provider است: متن پاسخ پس از حذف رشته‌های شبیه کلید و کوتاه‌سازی به ۳۰۰ نویسه (قید `char_length <= 300`)؛ `null` برای تماس موفق یا خطایی که provider دلیلی نگفته. `price_id is null` یعنی هزینه با قیمت پیش‌فرض برآورد شده ([ADR-0020](../adr/0020-real-provider-readiness.md)).

## workflow

### stage_run

`workflow_id`, `stage_type`, `sequence`, `status`, `config_snapshot_id`, `input_manifest_id`, `output_manifest_id`, `started_at`, `ended_at`, `wait_reason`, `retry_count`.

### attempt

`stage_run_id`, `number`, `status`, `retry_of_id`, `checkpoint`, `error_class`, `error_code`, `error_message_safe`, `started_at`, `ended_at`.

### human_task

`stage_run_id`, `task_type`, `payload`, `status`, `due_at nullable`, `resolved_by/at`, `decision`, `reason`.

## analysis (ANL)

همهٔ جدول‌ها tenant-scoped با RLS و کلید ترکیبی `(id, workspace_id)` هستند؛ `analysis_rounds` و `analysis_answers` append-only‌اند.

- `analysis_sessions`: یک ردیف برای هر مرحلهٔ تحلیل (`stage_run_id` یکتا)؛ `minimum_questions` (۳۰)، `maximum_questions` (۳۰۰)، `batch_size` (۴۰)، `finish_requested_at/by/reason`.
- `analysis_rounds`: یک فراخوانی تحلیلگر؛ `round_no` یکتا در session، `based_on_batch_id`، `outcome` (`batch|definition`)، `reason` (`minimum|coverage|analyst|sufficient|nothing_new|finish_requested|maximum_reached`)، `understood`، `next_ambiguity`، `sufficient`، `sufficiency_reason`، `category_notes`، `invocation_id` (خالی وقتی دور بدون مدل به تعریف رسید).
- `question_batches`: `batch_no`، `status` (`open|submitted`)، `round_id` یکتا؛ حداکثر یک batch باز برای هر session.
- `analysis_questions`: `ordinal` (۱ تا ۳۰۰، شمارهٔ نمایش‌داده‌شده)، `category` (ده بُعد)، `text`، `rationale`، `follow_up_of_id`، `status` (`open|answered|unanswered|irrelevant|later`)، `current_answer_id`.
- `analysis_answers`: بازنگری‌های پاسخ؛ `revision_no`، `status`، `text`، `attachments` (`[{sourceId, versionId, title}]`)، `submission_id` (یک ارسال اتمیک).
- `analysis_contradictions`: `key` مرتب دو شمارهٔ سؤال، `description`، `status` (`open|resolved`)، دور کشف و دور برطرف‌شدن.

## source و knowledge

### source_asset

`kind` (file/url/text/audio), `original_name`, `declared_mime`, `detected_mime`, `size`, `sha256`, `storage_key`, `scan_status`, `confidentiality`.

### source_version

`source_asset_id`, `sequence`, `supersedes_id`, `ingestion_status`, `extractor_version`, `ocr_used`, `transcription_used`.

### knowledge_version

| فیلد               | توضیح                                     |
| ------------------ | ----------------------------------------- |
| `source_type`      | admin, clue_research, autonomous_research |
| `title`            | عنوان انسانی                              |
| `language`         | BCP-47 محدودشده                           |
| `content_ref`      | object/text structured content            |
| `content_hash`     | تشخیص تغییر                               |
| `provenance_json`  | creator, source, collected_at, method     |
| `confidentiality`  | restricted پیش‌فرض                        |
| `audit_status`     | وضعیت Brain                               |
| `valid_from/until` | اعتبار زمانی                              |
| `supersedes_id`    | lineage                                   |

### knowledge_scope

`knowledge_version_id`, `scope_type`, `scope_id`, `effect` allow/deny. deny بر allow مقدم است.

### claim

`knowledge_version_id`, `normalized_text`, `source_locator`, `importance`, `content_hash`, `language`.

### citation

`claim_id`, `source_version_id/url`, `title`, `publisher`, `author`, `published_at`, `accessed_at`, `locator`, `quote_digest`, `verification_status`.

### audit_review

`target_type/id/version`, `brain_definition_version_id`, شش score، `overall_score`, `decision`, `reason`, `evidence_manifest_id`, `reviewed_at`.

### audit_override

`review_id`, `decision`, `reason`, `actor_id`, `effective_until`, `created_at`.

## solution و evaluation

### solution_version

`project_id`, `sequence`, `title`, `summary`, `rationale`, `assumptions_json`, `plan_json`, `risk_json`, `evidence_manifest_id`, `status`.

### criterion_definition

`key`, `title_i18n`, `description_i18n`, `scale`, `direction`, `default_weight`, `status`.

### solution_score

`solution_version_id`, `criterion_id`, `raw_score`, `weight`, `weighted_score`, `reason`, `evidence_refs`.

### evaluation

`target_version_id`, `rubric_version_id`, `status`, `overall_score`, `coverage`, `decision`, `target_stage`, `report_document_version_id`.

## document

### document

`project_id`, `solution_id nullable`, `document_type`, `title`, `current_version_id`, `status`.

### document_version

`document_id`, `sequence`, `structured_content`, `plain_text`, `language`, `length_policy_id`, `counted_characters`, `validation_json`, `created_from_run_id`, `status`, `locked_at`.

### document_writings

یک نگارش سند توسط مستندساز ([ADR-0019](../adr/0019-document-writing-and-structured-editor.md)): `workspace_id`، `project_id`، `document_id`، `status` (`queued|running|paused|succeeded|failed|cancelled`)، `phase` (`preparing|outlining|writing|fitting|saving|done`)، `level`، `template_version`، `language`، `notes` (درخواست ادمین؛ داده است، نه قاعده)، `settings` (مقدارهای مؤثر پروژه که در شروع ثابت می‌شوند)، `base_version_id` (نسخه‌ای که نگارش از آن شروع شد)، `result_version_id`، `agent_definition_version_id`، `temporal_workflow_id`، `plan` (بودجه و تمرکز هر زیربخش)، `parts` (زیربخش‌های نوشته‌شده)، `bibliography` (آبجکت ارجاع‌ها: شناسه و نسخهٔ دانش و آمار هر ارجاع)، `report` (طول، انحراف، دور تنظیم، فراخوانی‌ها، ارجاع‌های پیشنهادی/تأییدشده/دورریخته، یادداشت‌ها)، `block_code`، `error_code`، `requested_by`، `started_at`، `ended_at`. فهرست یکتای جزئی روی `(document_id)` برای وضعیت‌های زنده، RLS و trigger رد حذف تاریخچه. `model_invocations.writing_id` و `agent_tool_calls.writing_id` نگارش را به تماس‌هایش وصل می‌کنند.

### artifact

`document_version_id`, `format`, `storage_key`, `sha256`, `size`, `renderer`, `renderer_version`, `render_status`, `created_at`.

## provider

### provider_connection

`provider`, `enabled`, `secret_ref`, `base_url nullable`, `region`, `retention_mode`, `health_status`, `last_checked_at`, `last_error_safe`.

### model_catalog_entry

`provider`, `external_model_id`, `display_name`, `capabilities_json`, `context_limit`, `parameter_schema`, `discovered_at`, `active`.

### invocation

`attempt_id`, `provider`, `model_id`, `config_snapshot_id`, `request_hash`, `external_request_id`, `status`, `started/ended`, `finish_reason`, `error_class`.

### usage_record

`invocation_id`, `input_tokens`, `cached_tokens`, `output_tokens`, `reasoning_tokens`, `tool_calls`, `estimated_cost`, `currency`, `price_snapshot_id`.

## smart

### app_error

`source` (`server`/`client`)، `category`، `fingerprint` (یکتا در workspace)، `message`، `status` (`new/seen/fixed/ignored`)، `occurrences`، `first_seen_at`، `last_seen_at`، `http_method`، `route`، `http_status`، `page`، `project_id nullable`، `correlation_id`، `stack`، `context` (scrub‌شده). بدنهٔ درخواست ذخیره نمی‌شود.

### smart_conversation و smart_message

گفتگوی یک ادمین: `user_id`، `kind` (`walker`/`error`)، `project_id nullable`، `error_id nullable`، `route`، `title`. پیام: `role`، `content`، `status` (`done`/`failed`)، `context`، `invocation_id nullable`. پیام تغییرناپذیر است.

### walker_issue

`title`، `body` (عین پاسخ ذخیره‌شده)، `status` (`open/in_progress/fixed/wont_fix`)، `note`، `context`، `source_message_id nullable` (یکتا در workspace)، `created_by`.

## audit_event

`event_id`, `workspace_id`, `actor_type/id`, `action`, `target_type/id/version`, `occurred_at`, `correlation_id`, `ip_hash`, `reason`, `before_digest`, `after_digest`, `metadata_redacted`.

Audit event append-only است؛ اصلاح event با compensating event انجام می‌شود.
