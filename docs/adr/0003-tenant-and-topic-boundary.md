---
doc_id: DOCOO-ADR-0003
title: ADR-0003 تفکیک tenant فنی و حوزه موضوعی
status: accepted
version: 1.0.0
owner: Architecture & Security
last_updated: 2026-09-24
notion_sync: true
---

# ADR-0003: تفکیک tenant فنی و حوزهٔ موضوعی

## زمینه

محصول SaaS چندمستأجری است، ولی در مدل کسب‌وکاری «سازمان» یک نوع حوزهٔ موضوعی محسوب می‌شود. حذف tenant فنی موجب ناتوانی در جداسازی مشتریان آینده می‌شود.

## تصمیم

`Workspace/Tenant` مرز فنی مالکیت و امنیت و `TopicDomain` مفهوم قابل‌مشاهدهٔ کسب‌وکاری است. یک workspace می‌تواند حوزه‌هایی شامل شرکت، صنعت یا مفهوم داشته باشد. نسخهٔ اول یک workspace و یک Super Admin دارد.

## پیامد

نیاز کاربر حفظ می‌شود و RLS، secret، retention و billing آینده مرز روشن دارند. UI نسخهٔ اول از اصطلاح سازمان اجباری استفاده نمی‌کند.
