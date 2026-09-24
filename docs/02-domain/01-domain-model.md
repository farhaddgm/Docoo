---
doc_id: DOCOO-DOMAIN-MODEL
title: مدل دامنه Docoo
status: approved-baseline
version: 1.0.1
owner: Domain Architecture
last_updated: 2026-09-24
notion_sync: true
---

# مدل دامنه Docoo

## ۱. bounded contextها

### Identity & Access

User، Credential، Session، Role، Permission و Membership. این context tenant و مجوز را تعیین می‌کند اما دربارهٔ پروژه یا AI تصمیم نمی‌گیرد.

### Workspace & Topics

Workspace مرز فنی است. TopicDomain زمینهٔ کسب‌وکاری تخت است. Project به چند TopicDomain متصل می‌شود و join آن `ProjectTopic` دارای priority و conflict policy است.

### Configuration

تعریف schema، نسخه، override و resolution تنظیمات. هیچ context دیگری مجاز نیست با merge دلخواه تنظیمات را resolve کند.

### Agent Catalog

AgentRole، PrincipleSet، DutySet، PromptTemplate، ToolPolicy، OutputSchema و ModelPolicy را نگهداری می‌کند.

### Workflow

ProjectWorkflow، StageRun، Attempt، GateDecision، HumanTask، Feedback و Transition. منبع حقیقت وضعیت اجرای فرایند است.

### Knowledge

SourceAsset، ExtractedContent، KnowledgeItem، Claim، Citation، AuditReview، Conflict و RetrievalSnapshot.

### Solutions & Evaluation

Solution، Criterion، WeightProfile، Score، Evaluation، Finding و Selection.

### Documents

Document، DocumentVersion، StructuredBlock، Artifact، Template، LengthPolicy، Approval و Lock.

### Provider & Usage

ProviderConnection، ModelCatalogEntry، Invocation، ToolCall، UsageRecord، RetryState و HealthCheck.

### Audit & Reporting

AuditEvent، BrainReport، MetricSnapshot و ExportRecord.

## ۲. aggregateهای اصلی

## Workspace

ریشهٔ امنیتی همهٔ داده‌هاست.

**Invariantها:**

- تمام aggregateهای business باید `workspace_id` داشته باشند.
- انتقال resource بین workspace ممنوع است؛ copy کنترل‌شده resource جدید می‌سازد.
- secret و retention policy به workspace تعلق دارند.

## TopicDomain

حوزه‌ای تخت با `id`, `code`, `title`, `description`, `default_language`, `status`.

**Invariantها:** عنوان canonical و کد در workspace یکتا؛ archive مانع خواندن تاریخچه نیست؛ تغییر شرح نسخهٔ جدید ایجاد می‌کند.

## Project

مرز اصلی اجرای مسئله.

**فیلدهای محوری:** identity، status، initial_problem، approved_problem_version، output_language، workflow_policy، retention_policy، solution_policy، current_stage، soft_delete_at/purge_at.

**Invariantها:**

- active شدن نیازمند حداقل یک حوزه، مسئله و config معتبر است.
- completed شدن نیازمند حداقل یک راه‌حل منتخب با سند نهایی approved است.
- project deleted قابل‌اجرا نیست.
- هر stage run فقط به یک project و یک workflow version تعلق دارد.

## AgentDefinition

برای یکی از شش enum role تعریف می‌شود. Definition نسخهٔ قابل‌استناد است و شامل reference به principle/duty/prompt/tool/output/model policy versions است.

**Invariant:** نسخهٔ مصرف‌شده پس از invocation تغییرناپذیر است.

## ProjectAgentProfile

snapshot یا override تعریف نقش در پروژه. اگر custom نشده باشد به default version pin می‌شود؛ update خودکار default فقط با تصمیم ادمین انجام می‌شود.

## Workflow

شامل پنج StageDefinition ثابت و gate policyهاست. Brain hookها بین رویدادها ثبت می‌شوند.

**Invariantها:**

- تنها transitionهای تعریف‌شده مجازند.
- یک stage completed بدون artifact معتبر و gate pass نمی‌شود.
- resume از آخرین checkpoint قطعی انجام می‌شود.

## KnowledgeItem

واحد منطقی دانش که می‌تواند یک سند کامل یا مجموعه claim باشد.

**فیلدها:** source_type، content_version، scopes، provenance، language، confidentiality، audit_status، scores، valid_from/until، supersedes.

**Invariantها:**

- content immutable؛ اصلاح نسخهٔ جدید.
- approved به review version مشخص وابسته است.
- retrieval snapshot فقط versionهای approved/override-approved مطابق policy را pin می‌کند.

## Claim

ادعای atomic یا نزدیک به atomic با متن normalized، location در source، citations و audit مستقل. ادعای اثرگذار باید حداقل یک citation یا provenance مستقیم ادمین داشته باشد.

## Solution

گزینهٔ مستقل با version، rationale، evidence links، assumptions، plan، risks و scores.

**Invariant:** score محاسبه‌ای و evaluation نظر ارزیاب از هم جدا هستند.

## Document

هویت منطقی سند؛ `DocumentVersion` محتوا را نگهداری می‌کند و `Artifact` rendition است.

**Invariantها:**

- approved version immutable و locked.
- edit approved، draft version جدید می‌سازد.
- artifact checksum باید با source version سازگار باشد.

## ۳. رابطه‌های کلیدی

```text
Workspace 1---* TopicDomain
Workspace 1---* Project
Project *---* TopicDomain (ProjectTopic.priority)
Project 1---1 ProjectWorkflow
Project 1---6 ProjectAgentProfile
ProjectWorkflow 1---* StageRun 1---* Attempt
StageRun 1---* InputReference / OutputReference
SourceAsset 1---* SourceVersion 1---* ExtractedContent
KnowledgeItem 1---* KnowledgeVersion 1---* Claim
KnowledgeVersion 1---* AuditReview
Project 1---* RetrievalSnapshot *---* KnowledgeVersion
Project 1---* Solution 1---* SolutionVersion
SolutionVersion 1---* CriterionScore
Solution 1---* Document
Document 1---* DocumentVersion 1---* Artifact
Invocation *---1 Attempt
Invocation 1---* ToolCall / UsageRecord
AuditEvent *---1 Workspace
```

## ۴. مدل scope دانش

Scope یک list از bindingهاست، نه column nullable مبهم:

- `SYSTEM`: قابل‌استفاده در تمام workspaceها فقط برای محتوای کنترل‌شدهٔ محصول؛
- `WORKSPACE`: همهٔ حوزه‌ها و پروژه‌های workspace؛
- `TOPIC`: یک حوزه؛
- `PROJECT`: یک پروژه؛
- `AGENT_ROLE`: محدود به نقش؛
- ترکیب‌ها با semantics AND، مگر policy صریحاً union کند.

دانش project+researcher فقط در همان پروژه و برای نقش تحقیق‌کننده مجاز است. visibility catalog می‌تواند گسترده‌تر از retrieval permission باشد.

## ۵. مدل تنظیمات

هر setting دارای key، JSON schema، merge strategy، sensitivity، default، allowed scopes و validation rule است. `ConfigAssignment` مقدار را در scope ثبت می‌کند. `ResolvedConfigSnapshot` نتیجهٔ deterministic resolution را با همهٔ source assignmentها pin می‌کند.

## ۶. مدل نسخه‌بندی

Versionها append-only هستند. الگوی مشترک:

- logical object ID؛
- version ID؛
- sequence؛
- content hash؛
- status؛
- created_by/at؛
- change_reason؛
- supersedes_version_id؛
- schema_version.

Restore محتوا را copy و sequence جدید می‌سازد. حذف versionهای استفاده‌شده توسط run ممنوع است؛ فقط redaction قانونی با tombstone و audit ممکن است.

## ۷. شناسه‌ها

- primary ID: UUIDv7 برای locality زمانی و یکتایی.
- public code: prefix + random/base32، مانند `PRJ-8H4K2M` و `TOP-3D9Q7A`.
- code قابل‌ویرایش است اما alias history نگهداری می‌شود.
- URLها بر UUID یا opaque public ID متکی‌اند، نه title.

## ۸. consistency و transaction

- تغییر aggregate و outbox event در یک transaction.
- عملیات cross-context eventual consistency با saga/workflow.
- read modelهای داشبورد می‌توانند eventual باشند؛ gate و permission باید strong consistency داشته باشند.
- object upload ابتدا quarantine و پس از تأیید metadata به source version commit می‌شود.
