---
doc_id: DOCOO-DATA-DICTIONARY
title: فرهنگ داده هسته Docoo
status: approved-baseline
version: 1.0.1
owner: Data Architecture
last_updated: 2026-09-24
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

| فیلد                          | نوع                  | توضیح                           |
| ----------------------------- | -------------------- | ------------------------------- |
| `code`                        | citext               | یکتا در workspace               |
| `title`                       | text                 | عنوان مدیرپسند                  |
| `status`                      | enum                 | state machine رسمی              |
| `initial_problem`             | text                 | ورودی اصلی، immutable versioned |
| `approved_problem_version_id` | uuid nullable        | تعریف نهایی                     |
| `output_language`             | enum                 | fa یا en                        |
| `current_stage`               | enum                 | analysis..evaluation            |
| `workflow_id`                 | uuid                 | workflow فعال                   |
| `purge_at`                    | timestamptz nullable | حذف دائمی برنامه‌ریزی‌شده       |

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

### agent_definition_version

`role`, `sequence`, `principle_set_version_id`, `duty_set_version_id`, `prompt_template_version_id`, `tool_policy_version_id`, `output_schema_version_id`, `model_policy_version_id`, `status`.

### project_agent_profile

`project_id`, `role`, `base_definition_version_id`, `custom_config_assignment_id`, `effective_snapshot_id`.

## workflow

### stage_run

`workflow_id`, `stage_type`, `sequence`, `status`, `config_snapshot_id`, `input_manifest_id`, `output_manifest_id`, `started_at`, `ended_at`, `wait_reason`, `retry_count`.

### attempt

`stage_run_id`, `number`, `status`, `retry_of_id`, `checkpoint`, `error_class`, `error_code`, `error_message_safe`, `started_at`, `ended_at`.

### human_task

`stage_run_id`, `task_type`, `payload`, `status`, `due_at nullable`, `resolved_by/at`, `decision`, `reason`.

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

## audit_event

`event_id`, `workspace_id`, `actor_type/id`, `action`, `target_type/id/version`, `occurred_at`, `correlation_id`, `ip_hash`, `reason`, `before_digest`, `after_digest`, `metadata_redacted`.

Audit event append-only است؛ اصلاح event با compensating event انجام می‌شود.
