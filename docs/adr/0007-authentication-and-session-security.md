---
doc_id: DOCOO-ADR-0007
title: ADR-0007 نشست و امنیت احراز هویت
status: accepted
version: 1.0.0
owner: Security & Engineering
last_updated: 2026-09-24
notion_sync: true
---

# ADR-0007: نشست و امنیت احراز هویت

## زمینه

نسخهٔ اول backoffice فقط Super Admin دارد، اما باید از ابتدا در برابر سرقت token، reset abuse، CSRF و log شدن secret مقاوم باشد. JWT در localStorage برای این پنل انتخاب مناسبی نیست چون revoke فوری، چرخش نشست و کنترل logout همه‌جا را سخت می‌کند.

## تصمیم

- نشست opaque و تصادفی در cookie با نام `docoo_session` نگه‌داری می‌شود؛ token خام هرگز در database ذخیره نمی‌شود.
- فقط digest peppered token در PostgreSQL ذخیره می‌شود. pepper از secret manager/env امن می‌آید.
- cookie در production برابر `HttpOnly`, `Secure`, `SameSite=Lax` و `Path=/` است؛ domain باز تنظیم نمی‌شود.
- idle timeout پیش‌فرض ۳۰ دقیقه و absolute timeout پیش‌فرض ۲۴ ساعت است؛ هر دو قابل‌تنظیم و قابل‌ممیزی‌اند.
- password با Argon2id hash می‌شود. reset پاسخ عمومی یکسان، token یک‌بارمصرف و revoke همهٔ نشست‌ها دارد.
- برای درخواست‌های تغییر‌دهنده، بررسی Origin و Fetch Metadata/CSRF در edge/API اجباری است؛ token در URL یا log ممنوع است.
- authorization در application service انجام می‌شود و RLS دفاع دوم tenant است. هر query tenant-scoped باید workspace context داشته باشد.
- login، logout، failure، lockout، reset، تغییر password و revoke نشست audit می‌شوند؛ محتوای password/token هرگز audit نمی‌شود.

## رد گزینه‌ها

JWT در localStorage، session token خام در database، و تکیه بر RLS بدون authorization برنامه رد شدند. MFA به‌عنوان extension آماده می‌شود اما تا نیاز نسخهٔ اول، gate محصول نیست.

## معیار پذیرش

`FR-AUTH-001..005`، `NFR-SEC-002..004` و آزمون‌های `TC-AUTH-*`, `TC-RLS-*` باید قبل از gate control plane سبز باشند.
