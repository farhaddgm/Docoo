---
doc_id: DOCOO-DATA-ARCHITECTURE
title: معماری داده و جست‌وجو
status: proposed
version: 1.0.0
owner: Data Architecture
last_updated: 2026-09-24
notion_sync: true
---

# معماری داده و جست‌وجو

## ۱. طبقه‌بندی ذخیره‌سازی

- PostgreSQL: metadata، state، version graph، config، workflow references، audit index.
- Object storage: فایل اصلی، متن استخراج‌شدهٔ بزرگ، structured document snapshot، artifact و diagnostic encrypted blob.
- pgvector/PostgreSQL FTS: index retrieval نسخهٔ اول.
- Redis: cache، distributed limiter و ephemeral coordination.
- Temporal persistence: event history workflow؛ business source of truth همچنان domain stores است.

## ۲. tenant isolation

هر جدول business `workspace_id NOT NULL` دارد. connection context tenant را با transaction-scoped setting تنظیم می‌کند و RLS policy آن را بررسی می‌کند. jobها service role جدا دارند و باید workspace را صریحاً حمل کنند. superuser/database owner در request path استفاده نمی‌شود چون RLS را دور می‌زند.

کنترل‌های مکمل:

- composite unique شامل workspace؛
- object key prefix opaque per workspace؛
- encryption context شامل workspace ID؛
- cache key namespace؛
- metrics label بدون عنوان/PII؛
- test cross-tenant برای هر repository.

## ۳. مدل محتوا

Structured content JSON schema با blockهای typed ذخیره می‌شود. plain text مشتق‌شده برای search/length است. HTML/DOCX/PDF source of truth نیستند.

```text
Structured JSON -> canonical plain text -> count/index
               -> DOCX renderer
               -> HTML/PDF renderer
               -> PPTX executive renderer
```

## ۴. جست‌وجوی hybrid

Pipeline:

1. authorize workspace/project/role؛
2. resolve knowledge policy و approved versions؛
3. metadata filter؛
4. PostgreSQL full-text retrieval؛
5. vector similarity؛
6. reciprocal/rule-based fusion؛
7. rerank اختیاری؛
8. diversity و token budget؛
9. return claim/chunk با citation و conflict.

Embedding هر chunk به `embedding_model_version` و content hash وابسته است. تغییر مدل reindex job می‌سازد و index قدیم تا cutover حفظ می‌شود.

## ۵. chunking

- chunk بر اساس heading/table/page/slide/worksheet boundary؛
- اندازهٔ هدف configurable، overlap محدود؛
- locator پایدار: page، heading path، cell range، timestamp audio؛
- table schema و row meaning حفظ می‌شود؛
- chunk parent document و version را همیشه دارد.

## ۶. encryption

- disk/database/object server-side encryption؛
- field-level envelope encryption برای secret و در صورت لزوم raw provider diagnostic؛
- DEK per secret/version، KEK در secret manager؛
- rotation بدون rewrite فوری تمام داده با key version؛
- backup encryption مستقل.

## ۷. retention و purge

Retention engine policy effective را resolve می‌کند. default پروژه active نامحدود است. soft-delete، `purge_at=deleted_at+30d`. Purge graph:

1. legal/operational hold check؛
2. توقف workflow و revoke upload URL؛
3. حذف search/vector rows؛
4. حذف artifact/source objects؛
5. حذف/redact content rows؛
6. حفظ tombstone audit حداقلی؛
7. purge provider-side object در صورت امکان؛
8. report completion/failure.

Backup expiration ممکن است حذف فوری فیزیکی را به‌تأخیر اندازد؛ policy باید این واقعیت را شفاف کند.

## ۸. backup

- PostgreSQL base backup + WAL/PITR؛
- object versioning یا immutable backup؛
- manifest هماهنگ DB/object؛
- secrets backup جدا و محدود؛
- restore runbook و integrity check؛
- restore به محیط isolate و عدم اتصال تصادفی provider.

## ۹. دادهٔ تحلیلی

نسخهٔ اول warehouse جدا لازم ندارد. read model/materialized view برای metrics. محتوا و PII وارد metric label نمی‌شود. در آینده CDC فقط با data contract و privacy review.

## ۱۰. migration

- schema migration forward-only؛
- expand/migrate/contract برای zero/low downtime؛
- backfill idempotent با progress؛
- document/config schema reader حداقل N-2؛
- migration هر versioned JSON با fixture واقعی آزمون می‌شود.
