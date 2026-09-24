# Docoo

Docoo یک سامانهٔ تحت وب برای تبدیل مسئلهٔ کامل یا ناقص مدیر کسب‌وکار به مجموعه‌ای از راه‌حل‌های علمی، قابل‌ارزیابی و مستندات اجرایی نسخه‌بندی‌شده است. سامانه با یک تیم شش‌نقشی از ایجنت‌های هوش مصنوعی کار می‌کند: تحلیلگر، تحقیق‌کننده، ایده‌پرداز، مستندساز، ارزیاب و Brain.

اسکلت Foundation، زیرساخت محلی و نخستین برش احراز هویت، مجوزدهی workspace و موضوعات آماده‌اند. migration/RLS و زنجیرهٔ build/test روی محیط ایزوله تأیید شده‌اند. مالک محصول هر شش تصمیم خط مبنای نسخهٔ اول را در گفت‌وگوی ۲۰۲۶-۰۹-۲۴ تأیید کرده و دسترسی GitHub برقرار است.

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
- وضعیت Notion: index زنده ۴۱ شناسهٔ سند دارد، اما state محلی هنوز فقط ۳۶ سند را ثبت می‌کند و نسخهٔ صفحه‌ها با فایل‌های جاری یکسان نیست. از branch کاری جاری sync انجام نشده است؛ همگام‌سازی معتبر باید پس از merge به `main` و با ثبت SHA واقعی انجام شود.
- وضعیت توسعه: stack محلی، migration/RLS و ورود ادمین در API آماده‌اند؛ مجوزدهی workspace، فهرست/ساخت موضوع و رابط ورود فارسی/انگلیسی نیز پیاده‌سازی شده‌اند. CRUD کامل موضوع، سایر بخش‌های محصول و workerها هنوز backlog باز هستند.
- دسترسی GitHub با حساب مالک تأیید شده است؛ وضعیت انتشار کد، Issueها و CI در خود GitHub دنبال می‌شود.
