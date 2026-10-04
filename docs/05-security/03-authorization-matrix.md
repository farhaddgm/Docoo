---
doc_id: DOCOO-AUTHORIZATION-MATRIX
title: ماتریس مجوز endpointهای control plane
status: active
version: 1.3.0
owner: Security & Engineering
last_updated: 2026-10-04
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

| method و مسیر                                                        | permission               |
| -------------------------------------------------------------------- | ------------------------ |
| `GET /`                                                              | `workspace.read`         |
| `GET /topics`                                                        | `topic.read`             |
| `POST /topics`                                                       | `topic.create`           |
| `GET /topics/{id}`                                                   | `topic.read`             |
| `PATCH /topics/{id}`                                                 | `topic.update`           |
| `GET /topics/{id}/versions`                                          | `topic.read`             |
| `GET /topics/{id}/dependencies`                                      | `topic.read`             |
| `POST /topics/{id}/archive`                                          | `topic.archive`          |
| `POST /topics/{id}/restore`                                          | `topic.restore`          |
| `DELETE /topics/{id}`                                                | `topic.delete`           |
| `GET /projects`                                                      | `project.read`           |
| `POST /projects`                                                     | `project.create`         |
| `GET /projects/{id}`                                                 | `project.read`           |
| `PATCH /projects/{id}`                                               | `project.update`         |
| `POST /projects/{id}/activate`                                       | `project.run`            |
| `POST /projects/{id}/pause`                                          | `project.pause`          |
| `POST /projects/{id}/resume`                                         | `project.resume`         |
| `POST /projects/{id}/complete`                                       | `project.run`            |
| `POST /projects/{id}/reopen`                                         | `project.run`            |
| `POST /projects/{id}/archive`                                        | `project.archive`        |
| `POST /projects/{id}/unarchive`                                      | `project.archive`        |
| `POST /projects/{id}/restore`                                        | `project.restore`        |
| `DELETE /projects/{id}`                                              | `project.delete`         |
| `POST /projects/{id}/clone`                                          | `project.create`         |
| `GET /projects/{id}/timeline`                                        | `project.read`           |
| `GET /projects/{id}/effective-config`                                | `project.read`           |
| `GET /projects/{id}/config-snapshots`                                | `project.read`           |
| `GET /settings/definitions`                                          | `workspace.read`         |
| `GET /settings/assignments`                                          | `workspace.read`         |
| `GET /settings/assignments/history`                                  | `workspace.read`         |
| `PUT /settings/assignments`                                          | `workspace.configure`    |
| `POST /settings/assignments/restore`                                 | `workspace.configure`    |
| `GET /settings/effective`                                            | `workspace.read`         |
| `GET /audit-events`                                                  | `audit.read`             |
| `POST /audit-events/export`                                          | `audit.export`           |
| `POST /retention/purge`                                              | `retention.purge`        |
| `GET /sources`                                                       | `knowledge.read`         |
| `POST /sources/uploads`                                              | `knowledge.create`       |
| `POST /sources/text`                                                 | `knowledge.create`       |
| `POST /sources/url`                                                  | `knowledge.create`       |
| `GET /sources/{id}`                                                  | `knowledge.read`         |
| `POST /sources/{id}/versions`                                        | `knowledge.update`       |
| `POST /sources/{id}/versions/{versionId}/finalize`                   | `knowledge.create`       |
| `POST /sources/{id}/versions/{versionId}/retry`                      | `knowledge.update`       |
| `GET /sources/{id}/versions/{versionId}/segments`                    | `knowledge.read`         |
| `GET /knowledge`                                                     | `knowledge.read`         |
| `POST /knowledge`                                                    | `knowledge.create`       |
| `POST /knowledge/from-source`                                        | `knowledge.create`       |
| `POST /knowledge/retrieve`                                           | `knowledge.read`         |
| `GET /knowledge/{id}`                                                | `knowledge.read`         |
| `DELETE /knowledge/{id}`                                             | `knowledge.delete`       |
| `GET /knowledge/{id}/versions`                                       | `knowledge.read`         |
| `GET /knowledge/{id}/versions/{versionId}`                           | `knowledge.read`         |
| `POST /knowledge/{id}/versions`                                      | `knowledge.update`       |
| `POST /knowledge/{id}/submit-audit`                                  | `knowledge.audit`        |
| `GET /audit-reviews`                                                 | `knowledge.read`         |
| `POST /audit-reviews/{id}/override`                                  | `knowledge.override`     |
| `GET /knowledge-conflicts`                                           | `knowledge.read`         |
| `POST /knowledge-conflicts/{id}/resolve`                             | `knowledge.audit`        |
| `GET /retrieval-snapshots/{id}`                                      | `knowledge.read`         |
| `GET /provider-connections`                                          | `provider.read`          |
| `POST /provider-connections`                                         | `provider.configure`     |
| `GET /provider-connections/{id}`                                     | `provider.read`          |
| `PATCH /provider-connections/{id}`                                   | `provider.configure`     |
| `POST /provider-connections/{id}/rotate-secret`                      | `provider.rotate_secret` |
| `POST /provider-connections/{id}/disable`                            | `provider.configure`     |
| `POST /provider-connections/{id}/health-check`                       | `provider.test`          |
| `POST /provider-connections/{id}/models/refresh`                     | `provider.configure`     |
| `GET /provider-connections/{id}/models`                              | `provider.read`          |
| `GET /model-prices`                                                  | `provider.read`          |
| `POST /model-prices`                                                 | `provider.configure`     |
| `GET /model-invocations`                                             | `provider.read`          |
| `GET /projects/{id}/usage`                                           | `project.read`           |
| `GET /projects/{id}/workflow`                                        | `project.read`           |
| `POST /projects/{id}/workflow/start`                                 | `project.run`            |
| `POST /projects/{id}/workflow/sync`                                  | `project.run`            |
| `POST /projects/{id}/workflow/cancel`                                | `workflow.cancel`        |
| `GET /projects/{id}/stages/{stageRunId}`                             | `project.read`           |
| `POST /projects/{id}/stages/{stageRunId}/outputs/{outputId}/approve` | `workflow.approve`       |
| `POST /projects/{id}/stages/{stageRunId}/outputs/{outputId}/reject`  | `workflow.reject`        |
| `POST /projects/{id}/stages/{stageRunId}/outputs/{outputId}/comment` | `project.update`         |
| `POST /projects/{id}/stages/{stageRunId}/outputs/{outputId}/edit`    | `project.update`         |
| `POST /projects/{id}/stages/{stageRunId}/attempt-decision`           | `workflow.override`      |
| `GET /human-tasks`                                                   | `workspace.read`         |
| `GET /projects/{id}/analysis`                                        | `project.read`           |
| `GET /projects/{id}/analysis/question-batches`                       | `project.read`           |
| `GET /projects/{id}/problem-definitions`                             | `project.read`           |
| `POST /question-batches/{id}/answers`                                | `analysis.answer`        |
| `POST /projects/{id}/analysis/finish`                                | `workflow.approve`       |
| `GET /projects/{id}/solution-criteria`                               | `project.read`           |
| `PUT /projects/{id}/solution-criteria`                               | `project.update`         |
| `POST /projects/{id}/solutions/generate`                             | `project.run`            |
| `GET /projects/{id}/solutions`                                       | `project.read`           |
| `POST /projects/{id}/solution-selections`                            | `workflow.approve`       |
| `GET /projects/{id}/documents`                                       | `document.read`          |
| `GET /projects/{id}/rubric`                                          | `project.read`           |
| `PUT /projects/{id}/rubric`                                          | `project.update`         |
| `GET /documents/{id}`                                                | `document.read`          |
| `PUT /documents/{id}/content`                                        | `document.edit`          |
| `GET /documents/{id}/versions`                                       | `document.read`          |
| `GET /documents/{id}/versions/{versionId}`                           | `document.read`          |
| `GET /documents/{id}/diff`                                           | `document.read`          |
| `POST /documents/{id}/versions/{versionId}/restore`                  | `document.restore`       |
| `POST /documents/{id}/submit`                                        | `document.edit`          |
| `POST /documents/{id}/approve`                                       | `document.approve`       |
| `POST /documents/{id}/reject`                                        | `document.approve`       |
| `POST /documents/{id}/lock`                                          | `document.lock`          |
| `POST /documents/{id}/supersede`                                     | `document.lock`          |
| `POST /documents/{id}/exports`                                       | `document.export`        |
| `GET /documents/{id}/artifacts`                                      | `document.read`          |
| `GET /documents/{id}/artifacts/{artifactId}/download`                | `document.export`        |
| `POST /documents/{id}/evaluate`                                      | `document.approve`       |
| `GET /documents/{id}/artifacts/{artifactId}/verify`                  | `document.read`          |
| `GET /evaluations/{id}`                                              | `document.read`          |
| `POST /evaluations/{id}/accept-exception`                            | `workflow.override`      |
| `PATCH /evaluation-findings/{id}`                                    | `workflow.override`      |
| `GET /dashboard`                                                     | `workspace.read`         |
| `GET /reports/usage`                                                 | `provider.read`          |
| `POST /brain-reports`                                                | `knowledge.audit`        |
| `GET /brain-reports`                                                 | `knowledge.read`         |
| `GET /brain-reports/{id}`                                            | `knowledge.read`         |
| `GET /smart/summary`                                                 | `smart.read`             |
| `GET /smart/walker/progress`                                         | `smart.read`             |
| `POST /smart/errors`                                                 | `workspace.read`         |
| `GET /smart/errors`                                                  | `smart.read`             |
| `GET /smart/errors/feed`                                             | `smart.read`             |
| `GET /smart/errors/{id}`                                             | `smart.read`             |
| `PATCH /smart/errors/{id}`                                           | `smart.manage`           |
| `GET /smart/conversations`                                           | `smart.read`             |
| `POST /smart/conversations`                                          | `smart.chat`             |
| `GET /smart/conversations/{id}`                                      | `smart.read`             |
| `DELETE /smart/conversations/{id}`                                   | `smart.chat`             |
| `POST /smart/conversations/{id}/messages`                            | `smart.chat`             |
| `GET /smart/issues`                                                  | `smart.read`             |
| `POST /smart/issues`                                                 | `smart.manage`           |
| `GET /smart/issues/{id}`                                             | `smart.read`             |
| `PATCH /smart/issues/{id}`                                           | `smart.manage`           |
| `DELETE /smart/issues/{id}`                                          | `smart.manage`           |

## endpointهای هویت

`/v1/auth/*` و `/v1/me*` به workspace وابسته نیستند و فقط نشست خود کاربر را مدیریت می‌کنند: ورود، خروج، درخواست و انجام reset، تغییر گذرواژه و لغو همهٔ نشست‌ها. همهٔ عملیات تغییر‌دهندهٔ آن‌ها بررسی Origin دارند و ورود/reset محدودیت نرخ جداگانهٔ ۱۰ درخواست در دقیقه دارند.

## ریسک‌های پذیرفته‌شده

- قفل تدریجی حساب پس از ۵ تلاش ناموفق می‌تواند توسط مهاجم برای قفل‌کردن ادمین استفاده شود؛ پاسخ عمومی، rate limit، سقف ۲۴ ساعت و مسیر reset/CLI این ریسک را محدود می‌کنند.
- مسیر reset برای ایمیل موجود چند insert بیشتر دارد؛ تفاوت زمانی کوچک است و پاسخ و کد آن یکسان می‌ماند.
