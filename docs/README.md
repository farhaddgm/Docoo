---
doc_id: DOCOO-DOC-INDEX
title: فهرست مرجع مستندات Docoo
status: active
version: 0.1.1
owner: Product & Architecture
last_updated: 2026-09-24
notion_sync: true
---

# فهرست مرجع مستندات Docoo

## هدف

این فهرست نقشهٔ رسمی مستندات توسعهٔ Docoo است. هر تصمیمی که بر دامنه، رفتار، داده، امنیت، معماری، تجربهٔ کاربری یا عملیات اثر می‌گذارد باید در یکی از اسناد این فهرست ثبت شود. هر سند دارای `doc_id` پایدار است؛ نام فایل می‌تواند تغییر کند اما شناسه نباید تغییر کند.

## ترتیب مطالعه

### ۰. مبانی

1. [تصمیم‌های کشف نیاز](00-foundation/01-discovery-decisions.md) — پاسخ تثبیت‌شده به ۱۰۰ سؤال و تصمیم‌های واگذارشده.
2. [چشم‌انداز محصول](00-foundation/02-product-vision.md) — مسئله، ارزش پیشنهادی، کاربران و تعریف موفقیت.
3. [دامنه و اصول](00-foundation/03-scope-and-principles.md) — محدودهٔ نسخهٔ اول، اصول غیرقابل‌مذاکره و موارد خارج از دامنه.

### ۱. محصول

4. [PRD جامع](01-product/01-prd.md) — تعریف محصول، قابلیت‌ها، سناریوهای اصلی و معیارهای پذیرش سطح محصول.
5. [نیازمندی‌های کارکردی](01-product/02-functional-requirements.md) — نیازمندی‌های شماره‌گذاری‌شده و قابل‌آزمون.
6. [نیازمندی‌های غیرکارکردی](01-product/03-non-functional-requirements.md) — امنیت، کارایی، مقیاس، دسترس‌پذیری، نگهداری و انتقال‌پذیری.
7. [نقش‌ها و دسترسی‌ها](01-product/04-roles-and-permissions.md) — ادمین کل نسخهٔ اول و مدل توسعه‌پذیر RBAC.
8. [معماری اطلاعات و UX بک‌آفیس](01-product/05-backoffice-ux.md) — صفحات، ناوبری، وضعیت‌ها و رفتارهای رابط فارسی/انگلیسی.

### ۲. دامنه و دادهٔ کسب‌وکار

9. [مدل دامنه](02-domain/01-domain-model.md) — موجودیت‌ها، aggregateها، مرزها و قواعد.
10. [ماشین‌های حالت](02-domain/02-state-machines.md) — وضعیت پروژه، مرحله، اجرا، دانش، سند و ممیزی.
11. [فرهنگ داده](02-domain/03-data-dictionary.md) — فیلدهای اصلی، شناسه‌ها، مالکیت و محدودیت‌ها.

### ۳. هوش مصنوعی و دانش

12. [معماری سامانهٔ ایجنتی](03-ai/01-agent-system.md) — نحوهٔ همکاری شش نقش و مرز اختیار هر نقش.
13. [منشور نقش‌های ایجنتی](03-ai/02-agent-charters.md) — اصول و شرح وظایف پیش‌فرض هر ایجنت.
14. [حاکمیت دانش و Brain](03-ai/03-knowledge-and-brain.md) — سه منبع دانش، ممیزی، تعارض، امتیاز و override.
15. [ارکستراسیون ارائه‌دهندگان AI](03-ai/04-provider-orchestration.md) — قرارداد داخلی، انتخاب مدل، خطا، retry و حریم خصوصی.
16. [ارزیابی و تضمین کیفیت](03-ai/05-evaluation-and-quality.md) — rubricها، معیار قبولی، بازگشت و گزارش عملکرد.

### ۴. معماری فنی

17. [معماری سامانه](04-architecture/01-system-architecture.md) — contextها، سرویس‌ها، تکنولوژی پایه و مرزهای استقرار.
18. [معماری داده](04-architecture/02-data-architecture.md) — PostgreSQL، فایل، جست‌وجو، بردار، نسخه و جداسازی.
19. [قراردادهای API](04-architecture/03-api-contracts.md) — اصول REST، idempotency، خطاها و endpointهای اصلی.
20. [گردش‌کارها و کارهای پس‌زمینه](04-architecture/04-workflows-and-jobs.md) — durable workflow، توقف انسانی و retry.
21. [خط لولهٔ اسناد](04-architecture/05-document-pipeline.md) — ingest، OCR، استخراج، تولید DOCX/PDF/PPTX و شمارش کاراکتر.

### ۵. امنیت، حریم خصوصی و ممیزی

22. [امنیت و threat model](05-security/01-security-and-threat-model.md) — کنترل‌های امنیتی، تهدیدهای AI و مرز اعتماد.
23. [ممیزی و انطباق](05-security/02-audit-and-compliance.md) — رویدادهای ممیزی، نگهداری، تغییرناپذیری و گزارش.

### ۶. تحویل و عملیات

24. [راهبرد آزمون](06-delivery/01-testing-strategy.md) — هرم آزمون، eval ایجنت‌ها، امنیت و بار.
25. [استقرار و عملیات](06-delivery/02-deployment-and-operations.md) — Docker، محیط‌ها، پشتیبان‌گیری و بازیابی.
26. [مشاهده‌پذیری و SRE](06-delivery/03-observability-and-sre.md) — لاگ، متریک، trace، SLO و هشدار.
27. [نقشهٔ راه توسعه](06-delivery/04-roadmap.md) — فازها، خروجی‌ها، دروازه‌ها و تعریف Done.
28. [پذیرش و ردیابی](06-delivery/05-acceptance-and-traceability.md) — اتصال نیازمندی به آزمون و سند.

### ۷. یکپارچه‌سازی‌ها

29. [همگام‌سازی Notion و GitHub](07-integrations/01-notion-and-github.md) — مخزن خصوصی، انتشار یک‌طرفه و کنترل تعارض.
30. [قرارداد آداپترهای بیرونی](07-integrations/02-external-adapters.md) — AI، وب، ذخیره‌سازی، OCR و export.

### ۸. تصمیم‌های معماری

31. [ADR-0001: modular monolith](adr/0001-modular-monolith.md)
32. [ADR-0002: اجرای بادوام گردش‌کار](adr/0002-durable-workflows.md)
33. [ADR-0003: مرز tenant و حوزهٔ موضوعی](adr/0003-tenant-and-topic-boundary.md)
34. [ADR-0004: تنظیمات نسخه‌بندی‌شده](adr/0004-versioned-configuration.md)
35. [ADR-0005: ممیزی دو‌سطحی دانش](adr/0005-two-level-knowledge-audit.md)

## وضعیت اسناد

وضعیت‌های مجاز عبارت‌اند از:

- `draft`: پیش‌نویس و غیرقابل‌استناد برای ساخت.
- `proposed`: آمادهٔ بازبینی ادمین.
- `approved-baseline`: خط مبنای تأییدشده برای شروع توسعه.
- `accepted`: تصمیم معماری پذیرفته‌شده و لازم‌الاجرا.
- `active`: سند عملیاتی که مرتب به‌روزرسانی می‌شود.
- `superseded`: با سند یا نسخهٔ جدید جایگزین شده است.
- `archived`: صرفاً برای تاریخچه نگهداری می‌شود.

## قاعدهٔ تغییر

هر تغییر معنادار باید شناسهٔ تصمیم، دلیل، اثر، تاریخ و مالک داشته باشد. تغییر در اصول ایجنت، وظایف، rubric، سیاست دانش، مدل، تنظیمات پروژه یا قالب سند باید نسخهٔ جدید ایجاد کند؛ بازنویسی بی‌ردپا ممنوع است.
