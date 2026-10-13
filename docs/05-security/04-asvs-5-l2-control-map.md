---
doc_id: DOCOO-ASVS-L2-MAP
title: نگاشت کنترل‌های ASVS 5.0.0 سطح دو
status: active
version: 1.0.0
owner: Security
last_updated: 2026-10-13
notion_sync: true
---

# نگاشت ASVS 5.0.0 سطح دو

منبع رسمی نسخهٔ ثابت [OWASP ASVS 5.0.0](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv) است. فایل [نگاشت ماشین‌خوان](../../qa/security/asvs-5.0-l2.json) همهٔ 253 شناسهٔ L1 و L2، سطح، کاربردپذیری، مسیر شواهد مرتبط و وضعیت بررسی را ثبت می‌کند. hash منبع در همان فایل ثبت شده است. نگاشت شواهد، گواهی انطباق نیست؛ آزمون کلی یک خانواده همهٔ کنترل‌های آن را ثابت نمی‌کند.

وضعیت فعلی: 213 کنترل نیازمند بررسی مستقل، 7 شکاف صریح و 33 کنترل خارج از کاربرد. هیچ کنترل بررسی‌نشده‌ای PASS نام‌گذاری نشده است.

| خانواده | کنترل L1/L2 | محل بررسی |
| --- | --- |
| V1 | 27 | `packages/ingestion/src/html-security.test.ts`، `apps/api/test/sources.integration.test.ts` |
| V2 | 11 | `packages/contracts/src/index.ts`، `apps/api/test/workflow.integration.test.ts` |
| V3 | 19 | `apps/web/proxy.ts`، `apps/api/test/auth.authorization.test.ts` |
| V4 | 10 | `apps/api/src/main.ts`، `apps/api/test/authorization-matrix.test.ts` |
| V5 | 9 | `packages/ingestion/src/ingestion.test.ts`، `apps/api/test/sources.integration.test.ts` |
| V6 | 35 | `apps/api/test/auth.integration.test.ts`، `apps/api/test/google-oauth.test.ts` |
| V7 | 18 | `apps/api/test/auth.integration.test.ts`، `apps/api/test/auth.service.test.ts` |
| V8 | 7 | `apps/api/test/auth.authorization.test.ts`، `packages/database/test/rls.integration.mjs` |
| V9 | 7 | `apps/api/test/google-oauth.test.ts` |
| V10 | 29 | `apps/api/test/google-oauth.test.ts`، `apps/api/test/google-accounts.integration.test.ts` |
| V11 | 14 | `apps/api/test/auth.crypto.test.ts`، `apps/api/test/providers.integration.test.ts` |
| V12 | 9 | `docs/06-delivery/14-security-hardening.md`، `deploy/compose.production.yaml` |
| V13 | 13 | `.github/workflows/security.yml`، `scripts/deploy/prepare-secrets.test.mjs` |
| V14 | 9 | `docs/05-security/02-audit-and-compliance.md`، `apps/api/test/decision-intelligence.integration.test.ts` |
| V15 | 13 | `docs/05-security/01-security-and-threat-model.md`، `.github/workflows/security.yml` |
| V16 | 16 | `apps/api/test/audit.integration.test.ts`، `scripts/security/monitor.test.mjs` |
| V17 | 7 | |

## شکاف‌ها و پذیرش

MFA اجباری، prefix نام cookie و TLS همهٔ ارتباط‌های داخلی هنوز اثبات نشده‌اند. سیاست نگهداری و purge در #147، همبستگی telemetry در #148 و پذیرش عملیاتی در #94 شواهد بیشتری می‌خواهند. NFR-SEC-008 تا بررسی مستقل و رفع/پذیرش صریح شکاف‌ها waiver باقی می‌ماند.

برای هر کنترل قابل‌اعمال، بررسی‌کننده باید شرط دقیق منبع رسمی را بخواند، آزمون/شاهد مشخص و تاریخ بازبینی ثبت کند و فقط سپس وضعیت را ارتقا دهد. تغییر دامنهٔ API یا افزودن connector/export نیازمند بازبینی کاربردپذیری کنترل‌های OAuth و داده است.

منبع استاندارد متعلق به OWASP و تحت CC BY-SA 4.0 منتشر شده است؛ شناسه‌ها به نسخهٔ 5.0.0 مقیدند.
