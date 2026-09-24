---
doc_id: DOCOO-STATE-MACHINES
title: ماشین‌های حالت Docoo
status: proposed
version: 1.0.0
owner: Domain Architecture
last_updated: 2026-09-24
notion_sync: true
---

# ماشین‌های حالت Docoo

## ۱. پروژه

```text
draft -> active <-> paused -> completed -> archived
  |        |          |          |           |
  +--------+----------+----------+---------> deleted
deleted --restore(within 30d)--> previous_non_deleted_state
deleted --purge(after 30d)--> purged
```

قواعد:

- `draft -> active`: config معتبر، مسئله و حوزه موجود.
- `active -> paused`: ادمین، provider failure نهایی یا human gate.
- `paused -> active`: علت توقف resolved و resume command idempotent.
- `active/paused -> completed`: workflow پایان یافته و final approval موجود.
- `completed -> active`: reopen با دلیل، version workflow جدید.
- `archived`: read-only عملیاتی؛ unarchive ممکن.
- `deleted`: soft delete؛ execution ممنوع.
- `purged`: حالت منطقی tombstone؛ محتوای قابل‌شناسایی حذف شده است.

## ۲. StageRun

```text
pending -> ready -> running -> waiting_for_human
                     |  ^             |
                     v  |             v
                  retrying <------- resumed
                     |
          completed / rejected / failed / cancelled
```

- `running` فقط یک lease فعال دارد.
- `waiting_for_human` timeout حذف داده ندارد؛ reminder خارج دامنهٔ نسخهٔ اول است.
- `rejected` می‌تواند stage جدید اصلاحی بسازد.
- `failed` خطای فنی نهایی است؛ `rejected` شکست کیفیت است.
- `cancelled` خروجی partial را نگه می‌دارد ولی downstream مصرف نمی‌کند.

## ۳. Attempt

```text
created -> dispatched -> executing -> succeeded
                            |  |
                            |  +-> incomplete
                            +----> transient_failed -> scheduled_retry
                            +----> permanent_failed
```

هر attempt immutable است. retry attempt جدید با `retry_of` می‌سازد. invocationهای provider در attempt شناسهٔ جدا دارند.

## ۴. GateDecision

```text
not_required | pending -> approved
                    |-> rejected
                    |-> overridden
                    |-> expired
```

gate decision به artifact/version مشخص وابسته است. تولید version جدید gate قبلی را `superseded` می‌کند.

## ۵. KnowledgeVersion و AuditReview

```text
draft -> pending -> in_review -> approved
                        |       -> rejected
                        |       -> needs_revision -> draft(new version)
approved -> expired
approved -> superseded
any reviewed -> pending (only on new version)
```

Override حالت audit اصلی را پاک نمی‌کند؛ `effective_decision` جداگانه محاسبه می‌شود:

```text
brain=rejected + admin_override=approve => effective=approved_by_override
brain=approved + admin_override=reject  => effective=rejected_by_override
```

## ۶. سند

```text
draft -> validating -> ready_for_review -> approved -> locked
  ^          |               |               |
  |          v               v               +-> superseded
  +------ non_compliant    rejected ----------+
```

- `non_compliant`: طول/schema/citation/renderer problem.
- edit هر حالت غیر draft، draft version جدید می‌سازد.
- locked version تغییر نمی‌کند.

## ۷. Evaluation

```text
pending -> running -> passed
                   -> failed_quality
                   -> failed_compliance
                   -> needs_human_decision
                   -> technical_error
```

technical_error score کیفیت تولید نمی‌کند. accepted-with-exception یک `GateDecision` انسانی پس از failure است.

## ۸. ProviderConnection

```text
unconfigured -> configured -> checking -> healthy
                                  |        |
                                  v        v
                               invalid   degraded -> unavailable
```

- health هیچ‌گاه secret را log نمی‌کند.
- `degraded` می‌تواند درخواست بپذیرد ولی هشدار دارد.
- `unavailable` workflow موجود را pause می‌کند؛ provider جایگزین خودکار نیست.

## ۹. SourceAsset ingestion

```text
uploaded -> quarantined -> scanning -> accepted -> extracting -> indexed
                               |            |          |
                               v            v          v
                            rejected      failed     partial
```

`partial` یعنی برخی sheet/page/audio segmentها استخراج نشده‌اند و قبل از استفاده نیازمند تصمیم است.

## ۱۰. transition safety

هر transition نیاز دارد:

- command ID برای idempotency؛
- expected current state برای optimistic concurrency؛
- actor و authorization؛
- reason برای transitionهای حساس؛
- audit event؛
- outbox event؛
- rollback/compensation تعریف‌شده در side effectها.
