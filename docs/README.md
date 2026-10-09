---
doc_id: DOCOO-DOC-INDEX
title: فهرست مرجع مستندات Docoo
status: active
version: 0.3.2
owner: Product & Architecture
last_updated: 2026-10-06
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
   - [اسمارت](01-product/06-smart.md) — واکر، گفتگو با AI، خطایاب و دفتر خطاها؛ مرز محرمانگی و مجوزها.

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
24. [ماتریس مجوز](05-security/03-authorization-matrix.md) — permission هر endpoint، ترتیب ارزیابی و ریسک‌های پذیرفته‌شده.

### ۶. تحویل و عملیات

25. [راهبرد آزمون](06-delivery/01-testing-strategy.md) — هرم آزمون، eval ایجنت‌ها، امنیت و بار.
26. [استقرار و عملیات](06-delivery/02-deployment-and-operations.md) — Docker، محیط‌ها، پشتیبان‌گیری و بازیابی.
27. [مشاهده‌پذیری و SRE](06-delivery/03-observability-and-sre.md) — لاگ، متریک، trace، SLO و هشدار.
28. [نقشهٔ راه توسعه](06-delivery/04-roadmap.md) — فازها، خروجی‌ها، دروازه‌ها و تعریف Done.
29. [پذیرش و ردیابی](06-delivery/05-acceptance-and-traceability.md) — اتصال نیازمندی به آزمون و سند.
30. [backlog اجرایی](06-delivery/06-implementation-backlog.md) — Issueهای خرد، milestoneها و traceability.
31. [راهنمای مالک محصول](06-delivery/07-owner-action-guide.md) — اقدامات سادهٔ approve، دسترسی، UX، تست و release.
32. [checklist آمادگی](06-delivery/08-readiness-checklist.md) — وضعیت واقعی gate شروع توسعه.
33. [شکست epicها به story](06-delivery/09-epic-breakdown.md) — خروجی spike فازهای ۲ تا ۶ با وابستگی و معیار پذیرش.
34. [runbook عملیات و private beta](06-delivery/10-runbooks.md) — حادثه، هشدارها، backup/restore، rollback و پذیرش beta.
35. [راهنمای سادهٔ نصب روی سرور](06-delivery/11-production-install.md) — نصب یک‌فرمانه، HTTPS، کلید AI، به‌روزرسانی و پشتیبان.
36. [پذیرش private beta با شاهد](06-delivery/12-private-beta-acceptance.md) — سه ابزار فقط‌خواندنی (GitHub، provider، سرور)، وضعیت‌ها و بلوک امضا.

### ۷. یکپارچه‌سازی‌ها

37. [همگام‌سازی Notion و GitHub](07-integrations/01-notion-and-github.md) — مخزن خصوصی، انتشار یک‌طرفه و کنترل تعارض.
38. [قرارداد آداپترهای بیرونی](07-integrations/02-external-adapters.md) — AI، وب، ذخیره‌سازی، OCR و export.

### ۸. تصمیم‌های معماری

39. [ADR-0001: modular monolith](adr/0001-modular-monolith.md)
40. [ADR-0002: اجرای بادوام گردش‌کار](adr/0002-durable-workflows.md)
41. [ADR-0003: مرز tenant و حوزهٔ موضوعی](adr/0003-tenant-and-topic-boundary.md)
42. [ADR-0004: تنظیمات نسخه‌بندی‌شده](adr/0004-versioned-configuration.md)
43. [ADR-0005: ممیزی دو‌سطحی دانش](adr/0005-two-level-knowledge-audit.md)
44. [ADR-0006: پلتفرم و toolchain](adr/0006-application-platform-and-toolchain.md)
45. [ADR-0007: نشست و امنیت احراز هویت](adr/0007-authentication-and-session-security.md)
46. [ADR-0008: اجرای ingestion و حاکمیت دانش](adr/0008-ingestion-and-knowledge-runtime.md)
47. [ADR-0009: workflow پروژه و runtime ارائه‌دهندهٔ AI](adr/0009-project-workflow-and-provider-runtime.md)
48. [ADR-0010: راه‌حل، سند، artifact امضاشده و ارزیابی](adr/0010-documents-solutions-and-evaluation.md)
49. [ADR-0011: داشبورد، گزارش هزینه و گزارش Brain](adr/0011-reporting-and-brain-reports.md)
50. [ADR-0012: استقرار تک‌سرور با نصب یک‌فرمانه](adr/0012-single-server-production-deployment.md)
51. [ADR-0013: صفحه‌های اصلی بک‌آفیس](adr/0013-backoffice-core-screens.md)
52. [ADR-0014: پرسش‌وپاسخ تحلیلگر و تعریف نهایی مسئله](adr/0014-analyst-questions-and-answers.md)
53. [ADR-0015: تعریف نسخه‌دار ایجنت‌ها و سنجاق‌شدن به پروژه](adr/0015-agent-definitions.md)
54. [ADR-0016: صفحه‌های دانش و ممیزی در بک‌آفیس](adr/0016-knowledge-screens.md)
55. [ADR-0017: تحقیق با دانش تأییدشده و ارزیابی مدل‌محور نقش‌ها](adr/0017-research-with-knowledge-and-role-evaluation.md)
56. [ADR-0018: تنظیمات، قالب و سطح سند، wizard ساخت پروژه و ابزار پذیرش](adr/0018-settings-templates-wizard-and-acceptance-tooling.md)
57. [ADR-0019: نگارش سند توسط مستندساز و ویرایشگر ساختاریافتهٔ بلوک‌ها](adr/0019-document-writing-and-structured-editor.md)
58. [ADR-0020: آمادگی برای مدل واقعی: سقف خروجی، سقف هزینهٔ کارا، دلیل خطای provider و آزمون خودکار مدل](adr/0020-real-provider-readiness.md)
59. [ADR-0021: کسب‌وکار از Contenter: اتصال فقط‌خواندنی، snapshot نسخه‌دار، و کار ایجنت‌ها بر پایهٔ کسب‌وکار پروژه](adr/0021-business-from-contenter.md)
60. [ADR-0022: دریافت قیمت مدل‌ها از کاتالوگ عمومی: پیش‌نمایش، انتخاب انسان و ثبت ردیابی‌پذیر](adr/0022-model-prices-from-public-catalog.md)
61. [ADR-0023: فراخوانی ابزار توسط خود مدل: دروازه، دفتر ثبت، خواندن مواد پروژه، ماشین‌حساب و پرسش از ادمین](adr/0023-agent-tool-calling.md)
62. [ADR-0024: ارزیابی کیفیت پرسش‌های تحلیلگر توسط Brain با مدل](adr/0024-analyst-question-quality.md)
63. [ADR-0025: اعلان‌ها: ساخت با trigger، زنگ و صفحهٔ اعلان‌ها، و ایمیل اختیاری با صندوق خروجی](adr/0025-notifications.md)

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

- [بنچ‌مارک ۲۰ ایده و شش قابلیت منتخب](01-product/08-advanced-ideas-benchmark.md)
