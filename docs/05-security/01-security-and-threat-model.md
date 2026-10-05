---
doc_id: DOCOO-SECURITY-THREAT-MODEL
title: معماری امنیت، حریم خصوصی و مدل تهدید
status: approved-baseline
version: 1.0.3
owner: Security
last_updated: 2026-10-05
notion_sync: true
---

# معماری امنیت، حریم خصوصی و مدل تهدید

## ۱. طبقه‌بندی

تمام دادهٔ مسئله، دانش، prompt، خروجی، فایل، token usage و audit در طبقهٔ `Restricted` است مگر policy خلاف آن را مشخص کند. secretها `Secret` هستند. telemetry عملیاتی باید تا حد ممکن فاقد content باشد.

## ۲. چارچوب مرجع

- baseline کنترل وب: OWASP ASVS 5.0 Level 2. مرجع رسمی: https://owasp.org/projects/asvs
- حاکمیت ریسک AI: NIST AI RMF با چهار تابع Govern، Map، Measure و Manage و پروفایل GenAI. مرجع رسمی: https://www.nist.gov/itl/ai-risk-management-framework

این چارچوب‌ها جای threat model اختصاصی Docoo را نمی‌گیرند.

## ۳. دارایی‌های حیاتی

- credentials و API keys؛
- داده و فایل پروژه؛
- knowledge base و embedding؛
- اصول/وظایف/promptهای فعال؛
- workflow state و approval؛
- audit trail؛
- اسناد نهایی و artifact؛
- backup و کلید رمزنگاری؛
- توکن سرویس Contenter و snapshotهای پروفایل کسب‌وکار.

## ۴. مرزهای اعتماد

1. مرورگر ادمین ↔ edge/API.
2. API ↔ database/object/Temporal/Redis.
3. worker ↔ AI providers.
4. ingestion ↔ فایل/URL غیرقابل‌اعتماد.
5. renderer ↔ structured content و assets.
6. repo ↔ Notion sync.
7. production ↔ backup/observability.
8. API ↔ Contenter (برنامهٔ خواهر: پروفایل کسب‌وکار و توکن سرویس).

هر عبور نیازمند authentication، authorization، validation، encryption و logging متناسب است.

## ۵. تهدیدهای اصلی و کنترل‌ها

### جعل هویت و نشست

تهدید: credential stuffing، session theft، reset abuse.

کنترل: Argon2id، rate limit، lockout progressive، secure cookie، CSRF، session rotation، generic reset response، revoke، audit و آماده‌سازی MFA.

### شکستن جداسازی tenant

تهدید: IDOR، query بدون workspace، job با scope اشتباه، cache collision.

کنترل: opaque ID، authorization مرکزی، repository requiring workspace، RLS/FORCE RLS مناسب، service role محدود، cache namespace، test خودکار cross-tenant و عدم استفاده DB owner در app.

### upload و parser

تهدید: malware، zip bomb، polyglot، macro، parser RCE، PDF exploit.

کنترل: direct quarantine، size/expanded-size، MIME sniff، AV scan، macro strip/no execution، sandbox بدون network، read-only filesystem، resource limits، patched parser و rejection reason.

### SSRF در URL research

کنترل: فقط http/https، resolve و block IP private/link-local/metadata، re-check پس از redirect، DNS pinning، port allowlist، response limit، content type و egress proxy.

### prompt injection

تهدید: منبع به مدل دستور دهد secret بخواند، tool اجرا کند یا policy را نادیده بگیرد.

کنترل: instruction/data separation، untrusted labels، tool authorization خارج مدل، retrieval scope، secret never in prompt، output policy scan، sandbox و human gate برای side effect پرریسک.

### data exfiltration توسط provider/tool

کنترل: data minimization، provider allowlist، retention/region review، store=false در اتصال مناسب، outbound network policy، DLP pattern، no cross-tenant context و audit payload digest.

مرحلهٔ research ([ADR-0017](../adr/0017-research-with-knowledge-and-role-evaluation.md)) متن دانش approved را به مدل می‌دهد: بازیابی فقط داخل workspace و scope پروژه و نقش است؛ دانش `restricted` پیش از رتبه‌بندی کنار می‌ماند مگر تنظیم صریح `research.allow_restricted_knowledge` (فقط سطح workspace) آن را باز کند؛ ledger `agent_tool_calls` فقط digest ورودی و ارجاع خروجی دارد، نه متن. ارزیابی مدل‌محور Brain (انتخاب‌شدنی) نمونهٔ خروجی نقش‌ها را برای داوری به همان provider می‌فرستد و فقط با مجوز `knowledge.audit` ساخته می‌شود؛ یافته‌های داور بدون شاهد دور ریخته می‌شود و گزارش هیچ چیز را تغییر نمی‌دهد.

### poisoned knowledge

کنترل: provenance، Brain audit، claim citation، conflict warning، source reputation، re-audit، admin override label و عدم یادگیری خودکار بی‌دروازه.

### اتصال به Contenter (کسب‌وکار پروژه)

تهدید: (الف) توکن سرویس لو برود و همهٔ کسب‌وکارهای Contenter خوانده شود؛ (ب) متن پروفایل (نوشتهٔ ادمین یا برگرفته از وب) به مدل دستور بدهد؛ (ج) اطلاعاتی که نباید از شرکت بیرون برود به provider برسد؛ (د) نشانی اتصال به سرویس داخلی اشاره کند؛ (ه) Contenter پاسخ ناسازگار یا عظیم بدهد؛ (و) snapshot یک tenant در tenant دیگر دیده یا با پروژه‌ای از tenant دیگر پیوند شود.

کنترل: توکن فقط نوشتنی و envelope-encrypted (`SECRET_MASTER_KEY`، AAD به اتصال و نسخه بسته) و فقط fingerprint برمی‌گردد؛ سمت Contenter بدون `INTEGRATION_TOKEN` مسیر ۴۰۴ است، مقایسهٔ توکن زمان‌ثابت و نرخ ۱۲۰ در دقیقه است و هر export audit می‌شود؛ پروفایل داخل `<data>` به‌عنوان `businessProfile` می‌رود و هرگز به دستور افزوده نمی‌شود، با دستورهای ثابت `BUSINESS_RULES`؛ هر نقش فقط بخش‌های لازم را با سقف حجم می‌گیرد و Brain هیچ؛ رابط محتوای دقیق هر نقش را نشان می‌دهد؛ نشانی را فقط `integration.configure` می‌نویسد، redirect دنبال نمی‌شود، مهلت ۱۵ ثانیه و سقف ۶ مگابایت دارد؛ خروجی نرمال‌سازی و کوتاه می‌شود و schema ناسازگار رد می‌شود؛ `business_snapshots` append-only با RLS و FK ترکیبی `(id, workspace_id)` است. **ریسک پذیرفته‌شده:** چون نشانی را ادمین می‌نویسد، ثبت نشانی داخلی ممکن است؛ ادمین مورد اعتماد است و هیچ محتوای پاسخ به او برنمی‌گردد جز وضعیت و خطای کوتاه. ([ADR-0021](../adr/0021-business-from-contenter.md))

### supply chain

کنترل: lockfile، signed/attested image، dependency/SBOM scan، secret scan، least privilege CI، pinned action digest، review migration و emergency patch process.

### document rendering

تهدید: HTML/script، external resource fetch، formula injection و malicious link.

کنترل: structured blocks، no arbitrary HTML، renderer network off، sanitize URL، prefix CSV formula، embedded asset allowlist و sandbox.

### audit tampering

کنترل: append-only API، restricted DB role، hash chain/batch digest، export to immutable storage اختیاری، alert gap و no update/delete application permission.

## ۶. secret management

- env plaintext فایل production ممنوع؛ secret manager یا Docker secret.
- envelope encryption برای API key و توکن سرویس Contenter.
- UI فقط `••••last4` و metadata.
- rotation با نسخه؛ old key grace محدود.
- secret در exception، trace، prompt و backup report redacted.
- access secret فقط adapter process و با audit metadata بدون value.

## ۷. encryption

- TLS 1.2+ با ترجیح 1.3؛
- HSTS و secure headers؛
- database/object/backup encryption؛
- signed short-lived download URL؛
- key separation محیط‌ها؛
- rotation و recovery key procedure.

## ۸. privacy و provider

پیش از فعال‌سازی provider، data flow record باید endpoint، subprocessors، retention، training policy، region، deletion و feature exception را ثبت کند. قابلیت‌هایی که state اضافی نگه می‌دارند مستقل بررسی می‌شوند. برای OpenAI، retention و Zero Data Retention بسته به endpoint/capability متفاوت است؛ policy اتصال نباید صرفاً به `store=false` اعتماد کند.

## ۹. logging امن

مجاز: شناسه‌های opaque، status، duration، token، error class، hash و correlation. ممنوع پیش‌فرض: متن مسئله، prompt کامل، output کامل، citation excerpt حساس، secret، cookie، auth header و presigned URL.

Debug content capture فقط با feature flag کوتاه‌عمر، محیط محدود، consent و auto purge.

## ۱۰. امنیت توسعه

- branch protection و review؛
- SAST، dependency، container، IaC و secret scan؛
- DAST روی staging؛
- test RLS و authorization؛
- abuse case test AI؛
- threat model update برای هر connector/tool؛
- release blocked در critical/high باز بدون acceptance رسمی.

### پیاده‌سازی گیت‌ها (0.8.0)

- گردش‌کار **Security** روی هر PR و push: SAST رایگان Semgrep با قواعد باز JavaScript/TypeScript در commit ثابت (روی مخزن خصوصی هم کار می‌کند)، `pnpm audit --audit-level=high`، Trivy روی مخزن (آسیب‌پذیری، secret و misconfiguration) و Trivy روی image هر سرویس؛ هر یافتهٔ high/critical قابل‌اصلاح گیت را قرمز می‌کند. CodeQL پس از فعال‌شدن Code Security توسط مالک اجرا می‌شود.
- imageها فقط وابستگی production دارند (`pnpm deploy --prod`) و npm/corepack از image اجرا حذف شده‌اند.
- گردش‌کار **Hardening**: ZAP baseline وب، ZAP API scan با نشست واقعی در workspace ادمین و گیت روی هشدار High (استثنا فقط با شناسهٔ قاعده، الگوی URL و دلیل در `scripts/security/zap-accepted.json`)، و `scripts/security/auth-probe.mjs` (عدم افشای کاربر، پرچم‌های cookie، session fixation، دست‌کاری token، CSRF، CORS، ورودی تزریقی، نشت خطا، brute force و جعل `X-Forwarded-For`).
- صفحه‌های وب Content-Security-Policy با منبع فقط same-origin دارند. سیاست در هر درخواست از `apps/web/proxy.ts` ساخته می‌شود (نه در زمان build) و تنها مبدأ بیرونیِ مجاز برای `connect-src` میزبان فایل (`S3_PUBLIC_ENDPOINT`، فقط http/https) است تا مرورگر فایل پاسخ را مستقیم با URL امضاشده بفرستد.

## ۱۱. incident response

طبقه‌بندی: credential، data exposure، provider، malware، integrity، availability. مراحل: detect، contain، preserve evidence، revoke/rotate، assess scope، recover، notify طبق الزام، postmortem و control update. Workflowهای مشکوک pause می‌شوند اما evidence حذف نمی‌شود.

## ۱۲. ریسک‌های پذیرفته‌نشده

- cross-tenant model context؛
- secret در prompt/log؛
- tool side effect صرفاً با تصمیم مدل؛
- استفاده از دانش ردشده بدون override ثبت‌شده؛
- parser با network و privilege بالا؛
- backup بدون آزمون restore؛
- provider ناشناخته بدون data processing review.
