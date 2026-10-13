---
doc_id: DOCOO-ADR-0027
title: ADR-0027 خط مبنای جاری حساب‌ها، نقش‌ها و Google
status: accepted
version: 1.0.0
owner: Product & Security
last_updated: 2026-10-13
notion_sync: true
---

# ADR-0027: خط مبنای جاری دسترسی

## زمینه و تصمیم

PR [#121](https://github.com/farhaddgm/Docoo/pull/121)، commit `3183404`، در v0.21.0 حساب‌های مدیریت‌شده، Google OIDC و دسترسی منابع را منتشر کرد. مستندات اولیه هنوز محدودیت تک‌ادمین را داشتند. درخواست رسیدگی به Issue #150، اصلاح این تناقض را تأیید کرده است؛ این ADR قابلیت منتشرشده را ثبت می‌کند.

خط مبنا اکنون شامل نقش‌های `super_admin`، `editor` و `viewer`، عضویت workspace، grant مستقل `READ`/`EDIT` و ورود Google برای حساب‌های مجاز است. کنترل مالک برنامه از نقش workspace جداست. ورود Google ثبت‌نام عمومی یا مجوز خواندن Drive نیست. MFA، SAML، SCIM و دعوت self-service در خط مبنای جاری فعال نیستند.

## اثر امنیتی و مهاجرت

این تغییر مستندات است و migration یا تغییر permission ایجاد نمی‌کند. authorization برنامه، RLS، بررسی مبدأ، revoke نشست پس از تغییر دسترسی و audit برقرارند. رفتار دقیق grantها در سند نقش‌ها ثبت می‌شود؛ به‌ویژه نام viewer به‌تنهایی مانع grant صریح EDIT نیست.

CodeQL پیشرفته در workflow Security و ۲۰ gate اجباری PR فعال‌اند. ابزار owner check باید تحلیل CodeQL روی commit فعلی و نتیجهٔ آخرین Security را بررسی کند. فقدان کلید پذیرش provider یک محدودیت مستقل است و اجرای سبز بدون کلید گواه پذیرش مدل واقعی نیست.

## شواهد و محدودیت

`apps/api/test/google-oauth.test.ts` امضا، issuer، audience، nonce، state و PKCE را بررسی می‌کند. `google-accounts.integration.test.ts` و `auth.authorization.test.ts` تغییر دسترسی و مجوزها را پوشش می‌دهند؛ آزمون‌های RLS دفاع پایگاه‌داده را بررسی می‌کنند.

[نگاشت ASVS 5.0.0 L2](../05-security/04-asvs-5-l2-control-map.md) کنترل‌ها، شواهد مرتبط و شکاف‌های باز را جدا ثبت می‌کند. این نگاشت ادعای گواهی یا پذیرش همهٔ کنترل‌های L2 نیست.
