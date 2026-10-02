---
doc_id: DOCOO-ADR-0009
title: ADR-0009 workflow پروژه و runtime ارائه‌دهندهٔ AI
status: accepted
version: 1.0.0
owner: Platform & AI Architecture
last_updated: 2026-10-02
notion_sync: true
---

# ADR-0009: workflow پروژه و runtime ارائه‌دهندهٔ AI

## زمینه

فاز ۳ باید مراحل ثابت حل مسئله را با gate انسانی، pause/resume بی‌اتلاف، سقف attempt و idempotency اجرا کند و همهٔ فراخوانی‌های مدل را از قرارداد واحد OpenAI/Gemini/Anthropic با retry مصوب، ثبت usage/هزینه و secret امن عبور دهد؛ CI کلید provider ندارد.

## تصمیم

- **Temporal `projectWorkflow`** در صف `docoo.agent` (`apps/worker-agent`) با شناسهٔ `project-{projectId}-run-{n}`. state در history و پایگاه‌داده است؛ activityها idempotent هستند (کلید attempt `stageRunId:attemptNo`) و در تکرار، خروجی ذخیره‌شده را بدون فراخوانی دوبارهٔ provider برمی‌گردانند. آزمون replay در CI deterministic بودن را اثبات می‌کند.
- **مرز امن:** pause فقط پیش از attempt بعدی اثر دارد؛ فراخوانی جاری اتمیک است. سیگنال‌ها: `pause`، `resume`، `cancel`، `gate`، `attemptDecision`. API پس از commit تغییر پروژه سیگنال می‌فرستد و `workflow/sync` قطع موتور را جبران می‌کند.
- **gate و بازبینی:** gate پیش‌فرض دستی؛ approve/reject/comment/edit به نسخهٔ مشخص خروجی بسته‌اند. edit نسخهٔ جدید می‌سازد و gate/approval نسخهٔ قبل `expired` می‌شود. reject بازخورد را به attempt بعدی می‌دهد. پس از سقف attempt (حداکثر ۱۰) فقط تصمیم ثبت‌شده با دلیل (`extend` یا `pass`) ادامه می‌دهد.
- **idempotency command:** سرآیند `Idempotency-Key` و جدول `command_receipts`؛ تکرار، پاسخ ذخیره‌شده را بدون side effect برمی‌گرداند.
- **قرارداد provider:** `ModelProviderAdapter` با adapterهای Responses (OpenAI، `store=false`)، `generateContent` (Gemini) و Messages با tool اجباری برای خروجی ساختاریافته (Anthropic)، به‌همراه fake قطعی. نام مدل در کد نیست؛ catalog زنده snapshot می‌شود و مدل از `ai.model` و اتصال از `ai.connection_id` در snapshot تنظیمات اجرا خوانده می‌شود.
- **retry و توقف:** فقط خطای transient/rate-limit/timeout با جدول ۵،۵،۵،۱۰،۱۵،۲۰،۲۵،۳۰،۳۵،۴۰ ثانیه (`Retry-After` بزرگ‌تر با سقف ۳۰۰ ثانیه)؛ پس از آن پروژه pause و human task ساخته می‌شود. fallback خودکار وجود ندارد.
- **secret:** envelope encryption با AES-256-GCM؛ data key هر نسخه با `SECRET_MASTER_KEY` wrap و ciphertext با AAD به اتصال و نسخه بسته می‌شود. API فقط نسخه و fingerprint برمی‌گرداند؛ جدول secret append-only است.
- **هزینه:** هر invocation token (ورودی، خروجی، reasoning، cached)، latency، finish reason و هزینهٔ برآوردی از snapshot قیمت تاریخ‌دار دارد؛ هزینهٔ اجرا با `ai.max_cost_usd_per_run` مقایسه، از ۸۰٪ هشدار و در سقف pause می‌شود.

## پیامدها

- خروجی مراحل در این فاز ساختار حداقلی دارد؛ عامل‌های تخصصی هر مرحله (تحلیل، تحقیق، راه‌حل، سند، ارزیابی) در epicهای بعد روی همین قرارداد ساخته می‌شوند.
- `SECRET_MASTER_KEY` باید از secret manager بیاید و چرخش آن نیازمند re-wrap کلیدهای داده است.
- آزمون adapterها با mock هم‌شکل API رسمی است؛ پذیرش واقعی هر provider با کلید مالک انجام می‌شود.

## رد گزینه‌ها

retry داخل activity بدون جدول مصوب، fallback خودکار provider، نگه‌داری secret خام در پایگاه‌داده و نام مدل ثابت در کد رد شدند.
