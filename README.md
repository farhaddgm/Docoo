# Docoo

Docoo یک سامانهٔ تحت وب برای تبدیل مسئلهٔ کامل یا ناقص مدیر کسب‌وکار به مجموعه‌ای از راه‌حل‌های علمی، قابل‌ارزیابی و مستندات اجرایی نسخه‌بندی‌شده است. سامانه با یک تیم شش‌نقشی از ایجنت‌های هوش مصنوعی کار می‌کند: تحلیلگر، تحقیق‌کننده، ایده‌پرداز، مستندساز، ارزیاب و Brain.

control plane، ingestion و دانش، گردش‌کار و ارائه‌دهندگان AI، راه‌حل و سند، گزارش‌ها، hardening و نصب یک‌فرمانهٔ production پیاده و در CI آزموده شده‌اند. مالک محصول هر شش تصمیم خط مبنای نسخهٔ اول را در گفت‌وگوی ۲۰۲۶-۰۹-۲۴ تأیید کرده و دسترسی GitHub برقرار است.

## مرجع مستندات

- [فهرست مستندات](docs/README.md)
- [تصمیم‌های حاصل از کشف نیاز](docs/00-foundation/01-discovery-decisions.md)
- [چشم‌انداز محصول](docs/00-foundation/02-product-vision.md)
- [دامنه و اصول طراحی](docs/00-foundation/03-scope-and-principles.md)
- [backlog اجرایی](docs/06-delivery/06-implementation-backlog.md)
- [راهنمای گام‌به‌گام مالک محصول](docs/06-delivery/07-owner-action-guide.md)
- [checklist آمادگی](docs/06-delivery/08-readiness-checklist.md)

## اجرای محلی

پیش‌نیاز: Node.js 24، pnpm 12 و Docker.

```bash
pnpm env:setup
pnpm install --frozen-lockfile
docker compose up -d postgres redis object-store temporal temporal-ui
pnpm db:migrate
pnpm verify
```

`pnpm env:setup` فایل `.env` را با مجوز محدود و pepper تصادفی می‌سازد و فایل موجود را بازنویسی نمی‌کند. برای اجرای applicationها از `pnpm dev` و برای telemetry از `pnpm stack:observability` استفاده کنید. provider key تا فاز integration لازم نیست؛ fixture محلی غیرحساس استفاده می‌شود.

پورت‌های سرویس‌های Compose برای توسعه فقط روی `127.0.0.1` منتشر می‌شوند و برای دسترسی شبکه‌ای/انتشار عمومی مناسب نیستند.

## سیاست منبع حقیقت

فایل‌های Markdown این مخزن منبع حقیقت مستندات هستند. انتشار در Notion به‌صورت یک‌طرفه از مخزن انجام می‌شود. تغییر مستقیم در Notion نباید بدون بازگرداندن تغییر به مخزن، مبنای توسعه قرار گیرد.

## وضعیت

- تاریخ مبنای تحلیل: ۲۰۲۶-۰۹-۲۴
- مالک محصول: ادمین کل Docoo
- مخزن مقصد: `https://github.com/farhaddgm/Docoo`
- وضعیت Notion: هر ۴۱ سند manifest در ۲۰۲۶-۱۰-۰۱ با موتور sync مستقیم (`scripts/notion/`) منتشر و در `docs/_meta/notion-state.json` با commit SHA ثبت شدند. هر تغییر در `docs/**` پس از merge به `main` خودکار در Notion به‌روز می‌شود؛ `pnpm docs:sync:plan` برنامهٔ انتشار بعدی را نشان می‌دهد.
- وضعیت توسعه (نسخهٔ 0.22.0): فازهای ۰ تا ۶ و نصب production کامل‌اند و بک‌آفیس مسیر اصلی را بدون ابزار توسعه پوشش می‌دهد: حوزه‌ها، پروژه‌ها با چرخهٔ عمر، گردش‌کار و بازبینی هر مرحله، پرسش‌وپاسخ تحلیلگر با ارزیابی کیفیت پرسش‌ها، ایجنت‌های نسخه‌دار با tool calling و پرسش از ادمین، دانش و تحقیق، نگارش سند، راه‌حل‌ها، اسناد با ارزیابی و export، داشبورد، اعلان‌ها، Audit Log، گزارش Brain، هزینه و ارائه‌دهندگان AI. هر نیازمندی FR/NFR در `qa/traceability.json` یک وضعیت صادقانه دارد (`pnpm qa:trace`). آنچه می‌ماند (پژوهش وب، اجرا با مدل واقعی و اقدام‌های مالک) در [گام‌های بعدی نقشهٔ راه](docs/06-delivery/04-roadmap.md)، [راهنمای مالک](docs/06-delivery/07-owner-action-guide.md) و [checklist آمادگی](docs/06-delivery/08-readiness-checklist.md) آمده است.
- دسترسی GitHub با حساب مالک تأیید شده است؛ وضعیت انتشار کد، Issueها و CI در خود GitHub دنبال می‌شود.
