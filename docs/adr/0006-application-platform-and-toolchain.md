---
doc_id: DOCOO-ADR-0006
title: ADR-0006 پلتفرم اجرایی و toolchain
status: accepted
version: 1.0.0
owner: Architecture & Engineering
last_updated: 2026-09-24
notion_sync: true
---

# ADR-0006: پلتفرم اجرایی و toolchain

## زمینه

برای شروع توسعه چند انتخاب در معماری باز بود. انتخابی لازم است که برای یک تیم کوچک، قابلیت توسعهٔ سریع، مرزبندی دامنه، کنترل tenant و اجرای local/CI قابل تکرار داشته باشد.

## تصمیم

پیش‌فرض اجرایی Docoo این است:

| بخش            | انتخاب                                        | دلیل ساده                                                              |
| -------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| Runtime        | Node.js 24 LTS                                | نسخهٔ پشتیبانی‌شده و مناسب production                                  |
| Monorepo       | pnpm 12 workspace + Turborepo 2               | نصب یک‌باره و اجرای هماهنگ همهٔ بسته‌ها                                |
| Language       | TypeScript 5.9، strict                        | خطاهای قراردادی پیش از اجرا کشف می‌شوند                                |
| Web            | Next.js 16 App Router                         | SSR محدود، routing و دسترسی‌پذیری مناسب backoffice                     |
| API            | NestJS 12 روی Fastify                         | module/DI/guard استاندارد با HTTP سریع و upload مناسب                  |
| Data access    | Drizzle ORM + SQL migration                   | type safety بدون پنهان‌کردن SQL و RLS                                  |
| Database       | PostgreSQL 18 + pgvector                      | transaction، RLS و مسیر آمادهٔ retrieval                               |
| Cache          | Redis 8                                       | cache/rate-limit/coordination؛ هرگز منبع حقیقت نیست                    |
| Workflow       | Temporal self-hosted                          | pause، retry، human gate و resume پس از crash                          |
| Object storage | S3-compatible؛ SeaweedFS در local             | فایل از حافظهٔ API عبور نمی‌کند؛ backend محلی bucket را خودکار می‌سازد |
| Test           | Vitest + Playwright                           | unit/integration سریع و E2E مرورگر واقعی                               |
| Telemetry      | OpenTelemetry + Prometheus/Tempo/Loki/Grafana | trace/metric/log قابل‌ردیابی                                           |

API به‌صورت modular monolith باقی می‌ماند و چهار worker مستقل دارد: agent، ingestion، document و maintenance. وابستگی مجاز فقط `UI → contracts → application → domain` است؛ provider و database در infrastructure می‌مانند.

## مواردی که بسته شدند

- spike انتخاب API با NestJS + Fastify بسته شد.
- ORM/query layer با Drizzle + migration SQL بسته شد.
- task runner با Turborepo بسته شد.
- ابزار unit با Vitest و E2E با Playwright بسته شد.
- scaffold پایه، Compose، env schema و CI skeleton در همین branch ساخته شدند.

## مواردی که هنوز باید در spike مستقل اندازه‌گیری شوند

کیفیت OCR/ترنسکریپشن فارسی، renderer RTL، سیاست retention هر provider، suitability کلاینت Cursor و بار واقعی pgvector. این موارد دلیل توقف scaffold نیستند؛ قبل از فاز مربوط به integration باید fixture و معیار قبولی داشته باشند.

## پیامدها

این تصمیم شروع توسعه را ممکن می‌کند و بعداً استخراج سرویس را ممنوع نمی‌کند. هر تغییر باید ADR جدید، benchmark یا evidence، اثر migration و به‌روزرسانی backlog داشته باشد.
