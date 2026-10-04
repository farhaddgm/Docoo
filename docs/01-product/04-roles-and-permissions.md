---
doc_id: DOCOO-ROLES-PERMISSIONS
title: نقش‌های انسانی و مدل دسترسی
status: proposed
version: 1.0.0
owner: Product & Security
last_updated: 2026-09-24
notion_sync: true
---

# نقش‌های انسانی و مدل دسترسی

## نسخهٔ اول

تنها نقش انسانی `SUPER_ADMIN` است. این نقش می‌تواند تمام منابع داخل workspace خود را مدیریت کند، providerها را پیکربندی کند، Brain را override کند، پروژه را عبور دهد و داده را حذف کند. وجود یک نقش به معنای حذف authorization نیست؛ هر endpoint همچنان permission صریح بررسی می‌کند.

## permissionهای پایه

- `workspace.read`, `workspace.configure`
- `topic.create/read/update/archive/delete/restore`
- `project.create/read/update/run/pause/resume/archive/delete/restore`
- `agent_definition.read/update/version/activate`
- `knowledge.create/read/update/audit/override/delete`
- `document.read/edit/approve/export/lock/restore`
- `provider.read/configure/test/rotate_secret`
- `workflow.approve/reject/override/retry/cancel`
- `audit.read/export`
- `retention.configure/purge`
- `smart.read/chat/manage` ([اسمارت](06-smart.md))؛ گزارش خطای مرورگر فقط به `workspace.read` نیاز دارد

## قواعد حساس

1. عملیات `rotate_secret` هرگز مقدار قبلی را برنمی‌گرداند.
2. `knowledge.override`، `workflow.override`، `purge` و عبور از سقف retry دلیل اجباری دارند.
3. login user و service worker principal جدا هستند.
4. worker فقط permission لازم برای task خود را دارد؛ document worker نباید provider secret تحقیق را بخواند.
5. support یا developer نباید با حساب production admin کار کند.

## مدل آینده

Schema از ابتدا role، permission، membership و resource scope دارد تا نقش‌های زیر بدون بازطراحی داده افزوده شوند:

- Workspace Admin
- Project Editor
- Reviewer/Approver
- Viewer/Auditor
- Knowledge Curator
- Provider Administrator

این نقش‌ها در UI نسخهٔ اول فعال نیستند و نباید معیار پذیرش را گسترش دهند.

## policy evaluation

دسترسی نهایی حاصل AND سه شرط است:

1. principal permission را دارد؛
2. resource در tenant مجاز است؛
3. وضعیت resource عملیات را اجازه می‌دهد.

برای نمونه، حتی Super Admin نمی‌تواند نسخهٔ locked را بی‌ردپا ویرایش کند؛ باید نسخهٔ جدید بسازد.
