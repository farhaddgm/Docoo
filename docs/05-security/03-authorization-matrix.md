---
doc_id: DOCOO-AUTHORIZATION-MATRIX
title: ماتریس مجوز endpointهای control plane
status: active
version: 1.0.0
owner: Security & Engineering
last_updated: 2026-10-02
notion_sync: true
---

# ماتریس مجوز endpointهای control plane

این ماتریس `FR-AUTH-005` و `NFR-SEC-002` را برای نسخهٔ اول اجرایی می‌کند. منبع حقیقت کد است: `ROLE_PERMISSIONS` در `apps/api/src/auth/auth.authorization.ts` و آزمون `apps/api/test/authorization-matrix.test.ts` که هر route زیر `workspaces/:workspaceId` را با همین جدول مقایسه می‌کند. افزودن route بدون ثبت در این جدول CI را قرمز می‌کند.

## قواعد ارزیابی

دسترسی هر درخواست حاصل AND سه شرط است ([نقش‌ها و مجوزها](../01-product/04-roles-and-permissions.md)):

1. نشست معتبر (cookie `docoo_session`) و برای درخواست‌های تغییر‌دهنده Origin مجاز و `Sec-Fetch-Site` غیر cross-site؛
2. عضویت کاربر در workspace مسیر و داشتن permission در نقش آن عضویت؛
3. اجازهٔ وضعیت منبع (مثلاً پروژهٔ archived/deleted فقط‌خواندنی است) و RLS پایگاه‌داده به‌عنوان دفاع دوم.

| پاسخ | معنا                                                                                               |
| ---- | -------------------------------------------------------------------------------------------------- |
| 401  | نشست ندارد یا منقضی است (`AUTH_SESSION_INVALID`)                                                   |
| 403  | permission ندارد یا مبدأ درخواست مجاز نیست (`AUTH_PERMISSION_DENIED`, `AUTH_CROSS_ORIGIN_REQUEST`) |
| 404  | workspace مسیر متعلق به کاربر نیست؛ وجود آن افشا نمی‌شود (`AUTH_WORKSPACE_NOT_FOUND`)              |

## نقش‌ها

| نقش           | permissionها                      |
| ------------- | --------------------------------- |
| `super_admin` | همهٔ permissionهای workspace      |
| هر نقش دیگر   | هیچ؛ تا زمان تعریف صریح در ماتریس |

## endpointها

مسیرها نسبت به `/v1/workspaces/{workspaceId}` هستند.

| method و مسیر                         | permission            |
| ------------------------------------- | --------------------- |
| `GET /`                               | `workspace.read`      |
| `GET /topics`                         | `topic.read`          |
| `POST /topics`                        | `topic.create`        |
| `GET /topics/{id}`                    | `topic.read`          |
| `PATCH /topics/{id}`                  | `topic.update`        |
| `GET /topics/{id}/versions`           | `topic.read`          |
| `GET /topics/{id}/dependencies`       | `topic.read`          |
| `POST /topics/{id}/archive`           | `topic.archive`       |
| `POST /topics/{id}/restore`           | `topic.restore`       |
| `DELETE /topics/{id}`                 | `topic.delete`        |
| `GET /projects`                       | `project.read`        |
| `POST /projects`                      | `project.create`      |
| `GET /projects/{id}`                  | `project.read`        |
| `PATCH /projects/{id}`                | `project.update`      |
| `POST /projects/{id}/activate`        | `project.run`         |
| `POST /projects/{id}/pause`           | `project.pause`       |
| `POST /projects/{id}/resume`          | `project.resume`      |
| `POST /projects/{id}/complete`        | `project.run`         |
| `POST /projects/{id}/reopen`          | `project.run`         |
| `POST /projects/{id}/archive`         | `project.archive`     |
| `POST /projects/{id}/unarchive`       | `project.archive`     |
| `POST /projects/{id}/restore`         | `project.restore`     |
| `DELETE /projects/{id}`               | `project.delete`      |
| `POST /projects/{id}/clone`           | `project.create`      |
| `GET /projects/{id}/timeline`         | `project.read`        |
| `GET /projects/{id}/effective-config` | `project.read`        |
| `GET /projects/{id}/config-snapshots` | `project.read`        |
| `GET /settings/definitions`           | `workspace.read`      |
| `GET /settings/assignments`           | `workspace.read`      |
| `GET /settings/assignments/history`   | `workspace.read`      |
| `PUT /settings/assignments`           | `workspace.configure` |
| `POST /settings/assignments/restore`  | `workspace.configure` |
| `GET /settings/effective`             | `workspace.read`      |
| `GET /audit-events`                   | `audit.read`          |
| `POST /audit-events/export`           | `audit.export`        |
| `POST /retention/purge`               | `retention.purge`     |

## endpointهای هویت

`/v1/auth/*` و `/v1/me*` به workspace وابسته نیستند و فقط نشست خود کاربر را مدیریت می‌کنند: ورود، خروج، درخواست و انجام reset، تغییر گذرواژه و لغو همهٔ نشست‌ها. همهٔ عملیات تغییر‌دهندهٔ آن‌ها بررسی Origin دارند و ورود/reset محدودیت نرخ جداگانهٔ ۱۰ درخواست در دقیقه دارند.

## ریسک‌های پذیرفته‌شده

- قفل تدریجی حساب پس از ۵ تلاش ناموفق می‌تواند توسط مهاجم برای قفل‌کردن ادمین استفاده شود؛ پاسخ عمومی، rate limit، سقف ۲۴ ساعت و مسیر reset/CLI این ریسک را محدود می‌کنند.
- مسیر reset برای ایمیل موجود چند insert بیشتر دارد؛ تفاوت زمانی کوچک است و پاسخ و کد آن یکسان می‌ماند.
