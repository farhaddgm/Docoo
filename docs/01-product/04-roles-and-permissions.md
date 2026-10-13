---
doc_id: DOCOO-ROLES-PERMISSIONS
title: نقش‌های انسانی و مدل دسترسی
status: approved-baseline
version: 1.1.0
owner: Product & Security
last_updated: 2026-10-13
notion_sync: true
---

# نقش‌های انسانی و مدل دسترسی

## خط مبنای جاری

[ADR-0027](../adr/0027-current-access-baseline.md) محدودیت تاریخی «فقط یک Super Admin» را با قابلیت منتشرشده در v0.21.0 جایگزین می‌کند. نقش‌های ذخیره‌شده `super_admin`، `editor` و `viewer` هستند. عضویت workspace و اجازهٔ منبع جداگانه بررسی می‌شوند؛ صرف داشتن نقش به معنی دیدن همهٔ پروژه‌ها نیست.

| نقش           | رفتار جاری                                                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `super_admin` | مدیریت workspace و منابع آن؛ مدیریت دسترسی Google و منابع فقط برای مالک شناخته‌شدهٔ برنامه مجاز است.                                                                          |
| `editor`      | ساخت پروژه/حوزه؛ خواندن و تغییر منابعی که اجازهٔ کافی دارند. پیکربندی provider، retention، Smart و integration، حذف پروژه/حوزه و workflow override مجاز نیست.                 |
| `viewer`      | ساخت پروژه/حوزه مجاز نیست؛ دسترسی به منابع به grant صریح `READ` یا `EDIT` وابسته است. `READ` تغییر را رد می‌کند؛ grant `EDIT` در پیاده‌سازی جاری اجازهٔ تغییر منبع را می‌دهد. |

سازندهٔ منبع دسترسی `EDIT` دارد. منابع وابسته مانند سند، run و نسخهٔ دانش از پروژه/حوزهٔ مربوط مجوز می‌گیرند. منابع فاقد grant برای کاربر غیرمدیر با 404 مخفی می‌شوند. تغییر نقش، عضویت یا وضعیت حساب نشست‌ها را revoke می‌کند. حساب مالک حذف یا غیرفعال نمی‌شود.

ورود Google از حساب‌های ثبت‌شده و فعال استفاده می‌کند؛ scopeها فقط `openid email profile` هستند. ورود Google هیچ مجوز Drive یا Docs به برنامه نمی‌دهد. MFA، SAML و SCIM همچنان خارج از خط مبنا هستند.

## permissionهای پایه

- `workspace.read`, `workspace.configure`
- `topic.create/read/update/archive/delete/restore`
- `project.create/read/update/run/pause/resume/archive/delete/restore`
- `agent_definition.read/update/version/activate` — خواندن؛ کپی و ویرایش و سنجاق پروژه؛ ساخت نسخهٔ پیش‌فرض؛ فعال‌سازی و بازگشت ([ADR-0015](../adr/0015-agent-definitions.md))
- `knowledge.create/read/update/audit/override/delete`
- `document.read/edit/approve/export/lock/restore`
- `provider.read/configure/test/rotate_secret`
- `analysis.answer`
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

## توسعهٔ آینده

Reviewer، Knowledge Curator و Provider Administrator نقش‌های مستقل پیاده‌سازی‌شده نیستند. افزودن آن‌ها نیازمند permission، RLS، آزمون منفی و تغییر نسخهٔ baseline است.

## policy evaluation

دسترسی نهایی حاصل AND سه شرط است:

1. principal permission را دارد؛
2. resource در tenant مجاز است؛
3. وضعیت resource عملیات را اجازه می‌دهد.

برای نمونه، حتی Super Admin نمی‌تواند نسخهٔ locked را بی‌ردپا ویرایش کند؛ باید نسخهٔ جدید بسازد.
