---
doc_id: DOCOO-AUDIT-COMPLIANCE
title: ممیزی، نگهداری و شواهد عملیاتی
status: proposed
version: 1.0.0
owner: Security & Operations
last_updated: 2026-09-24
notion_sync: true
---

# ممیزی، نگهداری و شواهد عملیاتی

## ۱. هدف audit trail

Audit باید به پنج سؤال پاسخ دهد: چه کسی، چه کاری، روی کدام نسخه، چه زمانی و با چه دلیل/نتیجه‌ای. Audit جای operational log نیست و نباید برای debugging محتوای حساس اضافی ذخیره کند.

## ۲. رویدادهای اجباری

### هویت

login موفق/ناموفق، logout، reset، session revoke، lockout و تغییر credential.

### حوزه و پروژه

create/update/archive/delete/restore/purge، تغییر status، اتصال حوزه و اولویت تعارض.

### تنظیمات و ایجنت

create/activate/restore definition، تغییر principle/duty/prompt/model/tool/rubric، effective config snapshot.

### workflow

start/pause/resume/cancel، stage transition، human task، approve/reject، retry، سقف اضافه و accepted_with_exception.

### دانش

ingest، extraction result، audit، score، decision، override، conflict، expiry، retrieval snapshot و use reference.

### اسناد

create version، edit، validation، evaluation، approval، lock، restore، export و download حساس.

### provider و secret

configure، test، health، model refresh، rotate و disable؛ هیچ value ثبت نمی‌شود.

## ۳. ساختار رویداد

```json
{
  "eventId": "uuid",
  "workspaceId": "uuid",
  "actor": { "type": "user|service|agent", "id": "uuid" },
  "action": "knowledge.audit.override",
  "target": { "type": "knowledge_version", "id": "uuid", "version": "7" },
  "occurredAt": "RFC3339",
  "correlationId": "uuid",
  "reason": "...",
  "beforeDigest": "sha256",
  "afterDigest": "sha256",
  "metadata": {},
  "classification": "restricted"
}
```

## ۴. integrity

- app role INSERT-only برای audit.
- sequence per workspace یا batch.
- hash chaining `hash(prev_hash + canonical_event)` برای تشخیص تغییر.
- digest دوره‌ای به object storage immutable یا سامانهٔ بیرونی.
- clock sync و UTC.
- gap detector.

## ۵. نمایش بک‌آفیس

فیلتر زمان، actor، project، role، action، target و severity. نمای diff باید fieldهای secret را `[REDACTED]` نشان دهد. export CSV/JSON امضاشده یا checksumدار است و خود export audit می‌شود.

## ۶. retention

پیش‌فرض دادهٔ پروژه تا تصمیم ادمین نامحدود است. پیشنهاد operational:

- audit امنیتی: حداقل ۲ سال یا بیشتر طبق policy؛
- operational log: ۳۰ تا ۹۰ روز؛
- trace: ۱۴ تا ۳۰ روز؛
- metric aggregate: ۱۳ ماه؛
- raw provider diagnostic encrypted: حداکثر ۷ روز مگر incident hold؛
- deleted project content: ۳۰ روز تا purge؛
- tombstone حذف: حداقل شناسه، actor، زمان و reason بدون محتوا.

این مقادیر defaultهای قابل‌تغییرند. کاهش retention باید اثر و برگشت‌ناپذیری را نشان دهد.

## ۷. lineage شواهد

از output نهایی باید بتوان مسیر زیر را پیمود:

```text
Artifact -> DocumentVersion -> SolutionVersion -> StageRun/Attempt
 -> Invocation/PromptVersion/Model -> RetrievalSnapshot
 -> KnowledgeVersion/Claim -> Citation/SourceVersion -> AuditReview
```

این lineage پایهٔ reproducibility است، حتی اگر پاسخ model دقیقاً تکرارپذیر نباشد.

## ۸. گزارش انطباق داخلی

- پوشش ASVS کنترل‌های انتخابی؛
- وضعیت backup/restore؛
- secret rotation age؛
- RLS negative tests؛
- provider retention inventory؛
- knowledge gate bypass؛
- overrides و exceptionها؛
- critical findings باز؛
- دسترسی و دانلود دادهٔ حساس.

## ۹. حق حذف و backup

Purge online پس از ۳۰ روز انجام می‌شود. نسخه‌های backup تا پایان چرخهٔ backup قابل‌بازیابی فنی‌اند اما نباید به production عادی برگردند؛ restore باید suppression list حذف‌ها را دوباره اعمال کند. این محدودیت در privacy notice و runbook ثبت می‌شود.

## ۱۰. تغییرات سیاست

سیاست audit/retention نسخه‌بندی می‌شود. تغییر فقط رویدادهای آینده را تحت‌تأثیر قرار می‌دهد مگر migration صریح، preview اثر، تأیید ادمین و job قابل‌ردیابی وجود داشته باشد.
