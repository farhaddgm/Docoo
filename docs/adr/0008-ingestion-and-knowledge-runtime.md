---
doc_id: DOCOO-ADR-0008
title: ADR-0008 اجرای ingestion و حاکمیت دانش
status: accepted
version: 1.0.0
owner: Engineering & AI Governance
last_updated: 2026-10-02
notion_sync: true
---

# ADR-0008: اجرای ingestion و حاکمیت دانش

## زمینه

فاز ۲ باید فایل، متن و URL را بدون اعتماد به ورودی وارد کند، دانش را با provenance و ممیزی Brain حاکم کند و retrieval تکرارپذیر بدهد؛ در حالی که provider مدل‌های زبانی (epic AI-*) هنوز پیاده نشده و CI باید نتیجهٔ قطعی داشته باشد.

## تصمیم

- **آپلود مستقیم و quarantine:** API فقط URL امضاشدهٔ `PUT` می‌دهد؛ فایل هرگز از حافظهٔ API عبور نمی‌کند. کلید `quarantine/{workspace}/{asset}/{version}` است و فقط پس از تطبیق حجم و SHA-256، sniff واقعی MIME (همخوانی نوع اعلام‌شده، پسوند و محتوا)، محدودیت archive bomb و حکم `clean` از `clamd` به `sources/...` کپی می‌شود. نبود یا خطای اسکنر یعنی ماندن در quarantine (fail closed).
- **Temporal:** workflow `ingestSourceVersion` با شناسهٔ `ingest-{versionId}` دو activity idempotent دارد: `scanSource` و `extractSource`. API فقط شروع می‌کند؛ worker در صف `docoo.ingestion` اجرا می‌کند.
- **Parser sandbox:** parse در پروسهٔ جدای Node با permission model (`--permission`، خواندن فقط پوشهٔ ورودی و کد parser، بدون نوشتن، child process، worker و addon)، محیط خالی، سقف حافظه و timeout انجام می‌شود. چون Node 24 مجوز شبکه ندارد، همهٔ ورودی‌های شبکه (`net`, `tls`, `dns`, `http(s)`, `fetch`, `dgram`) پیش از parse غیرفعال می‌شوند و آزمون probe این محدودیت‌ها را در CI اثبات می‌کند.
- **OCR و گفتار:** Tesseract 5 (`fas`/`eng`) و poppler به‌صورت پروسهٔ جدا و محلی؛ گفتار با adapter سازگار با OpenAI (`/audio/transcriptions`, `verbose_json`) که بدون کلید، صوت را `partial` با دلیل `transcription_not_configured` نگه می‌دارد.
- **URL:** سیاست `deny | allowlist | public` از تنظیمات نسخه‌بندی‌شده؛ فقط http/https روی ۸۰/۴۴۳، بدون credential؛ هر hop دوباره بررسی، پاسخ DNS بررسی و برای اتصال pin می‌شود (بدون rebinding) و آدرس‌های خصوصی، loopback، link-local، metadata و IPv4-mapped رد می‌شوند.
- **Brain v1:** rubric `brain-rubric-v1` با وزن‌ها و آستانه‌های [سند دانش](../03-ai/03-knowledge-and-brain.md) در کد نسخه‌دار است. auditor پشت قرارداد `KnowledgeAuditor` است و پیاده‌سازی قطعی rule-based در CI و تا آمدن provider استفاده می‌شود؛ prompt injection، نبود provenance، منبع آلوده و claim تحقیق بی‌citation نقص بحرانی‌اند.
- **Retrieval:** فیلتر workspace، deny، وضعیت approved، نسخهٔ جاری، اعتبار زمانی، override فعال و scope/نقش پیش از هر رتبه‌بندی اعمال می‌شود. رتبه‌بندی lexical (`tsvector` روی متن نرمال‌شدهٔ فارسی) و vector (`hash-ngram-v1`، ۲۵۶ بعد، pgvector HNSW) با reciprocal rank fusion ترکیب و نتیجه با hash در `retrieval_snapshots` (append-only) pin می‌شود.
- **تغییرناپذیری:** segment، claim، citation، review، override، chunk و snapshot append-only هستند و محتوای نسخهٔ دانش با trigger قفل است؛ هر تغییر محتوا نسخهٔ جدید `pending` می‌سازد.

## پیامدها

- embedding محلی کیفیت معنایی مدل‌های provider را ندارد؛ جایگزینی آن با شناسهٔ مدل جدید و re-index انجام می‌شود و snapshotهای قدیمی معتبر می‌مانند.
- auditor قاعده‌محور جایگزین داوری انسانی/مدل نیست؛ override انسانی با دلیل و audit بحرانی مسیر استثناست.
- دقت گفتار تا تعیین provider و کلید قابل‌پذیرش نهایی نیست.

## رد گزینه‌ها

parse داخل پروسهٔ API، آپلود از طریق API، اتکا به MIME اعلام‌شده، اسکن fail-open و retrieval بدون snapshot رد شدند.
