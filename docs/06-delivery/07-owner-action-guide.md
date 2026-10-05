---
doc_id: DOCOO-OWNER-ACTION-GUIDE
title: راهنمای گام‌به‌گام مالک محصول Docoo
status: active
version: 1.2.0
owner: Product & Engineering
last_updated: 2026-10-05
notion_sync: true
---

# راهنمای گام‌به‌گام مالک محصول

این راهنما برای کسی نوشته شده که متخصص فنی نیست. شما لازم نیست framework، SQL یا AI را انتخاب کنید؛ من انتخاب‌های فنی پیش‌فرض را در ADR ثبت کرده‌ام. شما فقط رفتار محصول، ریسک قابل‌قبول و پذیرش خروجی را تأیید می‌کنید.

## قدم ۱ — تأیید خط مبنا (انجام‌شده)

مالک محصول در گفت‌وگوی ۲۰۲۶-۰۹-۲۴ در پاسخ به شش مورد زیر نوشت: «همگی صحیح و مورد تایید هستن و برو جلو ... همه شون صحیحن و مورد تاییدن». این پیام، تأیید هر شش تصمیم برای شروع توسعهٔ نسخهٔ اول است:

1. چه کسی از Docoo استفاده می‌کند و موفقیت او چیست؟ ([PRD](../01-product/01-prd.md))
2. نسخهٔ اول چه چیزهایی انجام می‌دهد و چه چیزهایی نمی‌دهد؟ ([دامنه و اصول](../00-foundation/03-scope-and-principles.md))
3. پروژه، حوزه، دانش، سند و وضعیت‌هایشان درست تعریف شده‌اند؟ ([مدل دامنه](../02-domain/01-domain-model.md)، [ماشین‌های حالت](../02-domain/02-state-machines.md)، [فرهنگ داده](../02-domain/03-data-dictionary.md))
4. شش نقش ایجنتی و اختیار Brain درست است؟ ([منشور نقش‌ها](../03-ai/02-agent-charters.md)، [دانش و Brain](../03-ai/03-knowledge-and-brain.md))
5. وقتی provider یا workflow شکست خورد، pause و resume مورد قبول است؟ ([گردش‌کارها](../04-architecture/04-workflows-and-jobs.md)، [ارکستراسیون provider](../03-ai/04-provider-orchestration.md))
6. معیار قبولی سند، امنیت، privacy و خروجی نهایی چیست؟ ([NFR](../01-product/03-non-functional-requirements.md)، [امنیت](../05-security/01-security-and-threat-model.md)، [پذیرش](05-acceptance-and-traceability.md))

رکورد تصمیم `DEC-2026-09-24-BASELINE`: مالک، ادمین کل Docoo؛ تاریخ، ۲۰۲۶-۰۹-۲۴؛ دلیل، اعلام صریح موافقت با شش مورد بالا در همین گفت‌وگو؛ اثر، بازشدن گیت تصمیم مالک برای توسعهٔ control plane. این تأیید در همین مخزن ثبت شده و علامت‌زدن دوبارهٔ موارد در Notion لازم نیست. هنوز برای این پیام commit SHA یا رکورد sync در Notion وجود ندارد؛ این شواهد فقط پس از commit و اجرای workflow انتشار قابل ثبت‌اند. تأیید یعنی «برای شروع توسعهٔ همین نسخه کافی است»، نه اینکه همهٔ جزئیات آینده برای همیشه قفل شوند. هر تغییر بعدی با decision/ADR ثبت می‌شود.

## قدم ۲ — آماده‌کردن دسترسی‌ها

این‌ها را در `.env` محلی قرار دهید؛ هیچ‌کدام را در GitHub یا Notion ننویسید:

1. Node.js 24 و Docker Desktop/Engine را نصب کنید.
2. `pnpm env:setup` را اجرا کنید؛ `.env` محلی را با pepper تصادفی می‌سازد و فایل موجود را بازنویسی نمی‌کند.
3. `docker compose up -d postgres redis object-store temporal temporal-ui` را اجرا کنید. object store محلی S3-compatible است و bucket را خودکار می‌سازد.
4. `pnpm db:migrate` را اجرا کنید.
5. پس از migration، `pnpm admin:create` را اجرا کنید؛ رمز فقط در prompt مخفی گرفته می‌شود و این دستور در صورت وجود ادمین قبلی داده را تغییر نمی‌دهد.
6. اگر integration لازم شد، API keyهای OpenAI/Gemini/Anthropic و OCR/transcription را فقط در secret manager محیط مربوط بگذارید.

تا قبل از فاز integration، provider key لازم نیست؛ fake provider و fixture غیرحساس کافی است.

## قدم ۳ — شروع vertical slice

بعد از approve قدم ۱، ترتیب کار این است: health → migration/RLS → login/session → workspace/topic/project → audit → RTL shell. شما در پایان هر slice فقط سناریوی قابل‌مشاهده و evidence را بررسی می‌کنید؛ کد را لازم نیست بازبینی کنید.

## قدم ۴ — زمانی که UX لازم شد

پیش از ساخت صفحهٔ جدی، برای هر مسیر اصلی فقط این پنج چیز را تأیید کنید: هدف صفحه، نقش کاربر، اطلاعات لازم، اقدام اصلی، حالت خطا/خالی/درحال‌اجرا. سپس wireframe، token و component inventory ساخته می‌شود و با keyboard، RTL/LTR و WCAG 2.2 AA آزموده می‌شود.

## قدم ۵ — زمانی که تست و eval لازم شد

برای هر قابلیت، یک مثال «ورودی درست»، «ورودی ناقص» و «باید رد شود» بدهید. تیم آن را به `TC-*`، fixture و golden document تبدیل می‌کند. برای AI، corpus فارسی/انگلیسی و expected evidence را نسخه‌گذاری می‌کنیم؛ key واقعی برای regression لازم نیست.

## قدم ۶ — زمانی که امنیت و release لازم شد

قبل از پذیرش milestone، گزارش سادهٔ زیر را بخواهید: cross-tenant leak صفر، secret در log صفر، restore backup موفق، provider policy ثبت‌شده، critical/high باز صفر یا exception امضاشده، و سناریوی اصلی از login تا export قابل‌تکرار.

## قدم ۷ — Notion و GitHub

GitHub منبع حقیقت است و Notion نمایش/پیگیری است. بعد از هر merge، sync معتبر باید document ID، version، commit SHA، checksum و زمان sync را ثبت و محتوای صفحه را با فایل مخزن تطبیق دهد. workflow `Notion documentation sync` این کار را مستقیم با Notion API انجام می‌دهد و state را در `main` commit می‌کند. کار لازم از سمت مالک: ساخت internal integration در Notion، share کردن صفحهٔ ریشهٔ Docoo و `Docoo Document Index` با آن، ذخیرهٔ token به‌عنوان secret مخزن با نام `NOTION_TOKEN` و یک‌بار اجرای دستی workflow با گزینهٔ `force`. تا وقتی secret تنظیم نشده، workflow فقط plan را نشان می‌دهد و «سبز شدن» آن نشانهٔ sync نیست. در Notion محتوا را مستقل از مخزن ویرایش نکنید؛ اگر تغییری لازم است در GitHub Issue/PR ثبت شود.

## قدم ۸ — پذیرش private beta با شاهد

سه چیز فقط از شما برمی‌آید: کلید واقعی provider (و گفتار به متن) به‌عنوان secret مخزن، تنظیم حفاظت شاخه و CodeQL در GitHub، و سرور واقعی با دامنه. بعد از هر کدام، ابزار فقط‌خواندنی مربوط را اجرا کنید و خروجی‌اش را در Issue بچسبانید: `pnpm owner:check` برای GitHub، گردش‌کار **Provider acceptance** برای کلیدها، و `sudo ./scripts/deploy/acceptance.sh` روی سرور. هر خط `ACTION` همان گام لازم را می‌گوید. ترتیب و معنی وضعیت‌ها و بلوک امضا: [پذیرش private beta](12-private-beta-acceptance.md). پیش از آن چیزی «پذیرفته‌شده» نیست؛ فقط آماده است.

## چه چیزهایی از شما لازم نیست

انتخاب Nest/Fastify، Drizzle، Temporal، RLS، Vitest یا ساختار workerها را به تیم فنی بسپارید. فقط اگر رفتار محصول یا ریسک داده تغییر می‌کند، تصمیم شما لازم است.

## قدم ۹ — وصل‌کردن Docoo به Contenter (کسب‌وکار پروژه)

هدف: هر پروژهٔ Docoo به کسب‌وکاری که در Contenter تعریف شده وصل شود و ایجنت‌ها بر پایهٔ اطلاعات آن کار کنند. پروفایل کسب‌وکار فقط در Contenter ویرایش می‌شود؛ Docoo آن را می‌خواند و نسخه‌ای از آن نگه می‌دارد. **هر دو برنامه باید به‌روز باشند** (Docoo 0.19.0 و Contenter 0.9.0)؛ ترتیب زیر را رعایت کنید.

1. **به‌روزرسانی Contenter.** وقتی تغییر Contenter (نسخهٔ 0.9.0) در شاخهٔ اصلی ادغام شد، سرور Contenter خودش پس از سبزشدن CI استقرار می‌دهد. از `https://contenter.beeproject.ir` وارد شوید و ببینید همه‌چیز عادی است.
2. **ساخت توکن.** روی سرور Contenter (پوشهٔ `~/contenter`) این را بزنید و خروجی ۶۴ حرفی را کپی کنید:

   ```bash
   openssl rand -hex 32
   ```

3. **گذاشتن توکن در Contenter.** فایل `apps/api/.env` را باز کنید و این خط را اضافه کنید (به‌جای `…` همان رشته):

   ```bash
   INTEGRATION_TOKEN=…
   ```

   سپس اعمال کنید (اگر پس از آن Docoo «سرویس موجود نیست» گفت، `--force-recreate api` را هم بیفزایید):

   ```bash
   cd ~/contenter && docker compose --profile app up -d
   ```

4. **به‌روزرسانی Docoo** (پس از ادغام و انتشار 0.19.0؛ اگر به‌روزرسانی خودکار روشن است صبر کنید، وگرنه دستی):

   ```bash
   sudo /opt/docoo/scripts/deploy/install.sh update
   ```

   کلید رمزنگاری (`SECRET_MASTER_KEY`) را نصب‌کنندهٔ Docoo از قبل ساخته است؛ کاری نمی‌خواهد.

5. **ثبت اتصال در Docoo.** از منوی کناری «اتصال‌ها» را باز کنید. نشانی API را `https://contenter.beeproject.ir/api` بنویسید، نشانی سایت (اختیاری) را `https://contenter.beeproject.ir` و توکن را همان رشتهٔ قدم ۲. «ذخیره و بررسی اتصال» را بزنید؛ باید «سالم» ببینید. توکن دیگر نمایش داده نمی‌شود؛ اگر گم شد، توکن تازه بسازید و در هر دو جا بگذارید.
6. **وصل‌کردن پروژه.** هنگام ساخت پروژه (گام اول) کسب‌وکار را از فهرست انتخاب کنید، یا در پروژهٔ موجود تب «کسب‌وکار» را باز کنید و انتخاب کنید. همان‌جا همهٔ اطلاعات کسب‌وکار، «آنچه ایجنت‌ها می‌بینند» و نسخه‌ها را می‌بینید. تغییر پروفایل را در Contenter بدهید و در Docoo «همگام‌سازی با Contenter» را بزنید (پیش از شروع هر اجرا هم خودکار انجام می‌شود).
7. اگر می‌خواهید هر پروژه حتماً کسب‌وکار داشته باشد، در «تنظیمات سامانه» گروه «کسب‌وکار»، `business.required` را روشن کنید.

**دو نکته.** (الف) اطلاعات کسب‌وکار هنگام کار ایجنت‌ها به ارائه‌دهندهٔ مدل (OpenAI و مانند آن) فرستاده می‌شود؛ آنچه نباید به آنجا برسد در Contenter ننویسید. (ب) این قابلیت با مدل واقعی و Contenter واقعی هنوز اجرا نشده است؛ پس از وصل‌کردن، یک پروژهٔ آزمایشی بسازید و ببینید پاسخ‌ها با پروفایل هماهنگ‌اند.
