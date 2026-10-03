---
doc_id: DOCOO-ADR-0012
title: ADR-0012 استقرار تک‌سرور production با نصب یک‌فرمانه
status: accepted
version: 1.0.0
owner: Platform & Operations
last_updated: 2026-10-03
notion_sync: true
---

# ADR-0012: استقرار تک‌سرور production با نصب یک‌فرمانه

## زمینه

مالک محصول متخصص فنی نیست و private beta باید روی یک سرور با HTTPS، پشتیبان خارج از سرور با RPO پانزده دقیقه و بدون دست‌کاری فایل‌های پیکربندی راه بیفتد (بخش ۳ سند استقرار، NFR-REL-004).

## تصمیم

- **`deploy/compose.production.yaml`:** همهٔ سرویس‌ها روی یک سرور: Caddy (HTTPS خودکار Let's Encrypt برای دامنهٔ اصلی و دامنهٔ فایل‌ها)، API، وب، workerهای agent و ingestion، PostgreSQL 18 + pgvector، Redis، SeaweedFS، ClamAV با امضای رسمی، Temporal تک‌نود با SQLite پایدار، و سرویس یک‌بارهٔ migration. imageها با همان `infra/docker/Dockerfile.node` ساخته می‌شوند که در CI اسکن می‌شود؛ image API شامل Chromium و فونت فارسی برای PDF است.
- **پشتیبان پیوسته:** image پایگاه‌داده WAL-G (نسخه و checksum ثابت) دارد؛ `archive_command` هر بخش WAL را حداکثر هر ۵ دقیقه به S3 خارج از سرور می‌فرستد و سرویس `backup` هر ۲۴ ساعت base backup می‌گیرد و ۷ نسخه نگه می‌دارد؛ `object-backup` (rclone) فایل‌ها را آینه می‌کند. `infra/postgres/pitr-drill.sh` بازگردانی دقیق به یک لحظه را روی سرور تازه در CI اثبات می‌کند.
- **نصب‌کننده:** `scripts/deploy/install.sh` Docker را نصب می‌کند، چند سؤال ساده می‌پرسد، همهٔ رمزها را با `openssl rand` می‌سازد و در `deploy/.env` و `deploy/.env.production` (۶۰۰، خارج از git و build context) نگه می‌دارد، firewall را فقط برای ۲۲/۸۰/۴۴۳ باز می‌کند، stack را بالا می‌آورد و مدیر را بدون پرسیدن گذرواژه می‌سازد؛ گذرواژهٔ تصادفی هرگز نمایش داده نمی‌شود و یک پیوند یک‌بارمصرف ۲۴ ساعته چاپ می‌شود. `install.sh update` آخرین release را نصب می‌کند.
- **پشت proxy:** API با `TRUST_PROXY_HOPS=1` فقط یک hop از `X-Forwarded-For` را می‌پذیرد تا rate limit هر کاربر واقعی جدا باشد و جعل سرآیند بی‌اثر بماند.
- **آزمون:** گردش‌کار Deploy smoke در هر PR و هر شب نصب‌کننده را روی ماشین تازه اجرا می‌کند و HTTPS، پیوند تعیین گذرواژه، ورود، داشبورد، Chromium، OCR فارسی، پشتیبان WAL-G و آرشیو WAL را می‌سنجد.

## پیامدها

- Temporal تک‌نود برای beta کافی است؛ برای مقیاس بالاتر Temporal با PostgreSQL جدا یا Temporal Cloud لازم است.
- امنیت سرور (به‌روزرسانی سیستم‌عامل، SSH با کلید) مسئولیت میزبان است و در راهنمای نصب آمده است.

## رد گزینه‌ها

Kubernetes برای beta تک‌مستاجره، ذخیرهٔ رمزها در مخزن، و ساخت حساب مدیر با گذرواژهٔ تایپ‌شده در ترمینال رد شدند.
