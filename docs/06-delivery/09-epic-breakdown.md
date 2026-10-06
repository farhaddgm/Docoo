---
doc_id: DOCOO-EPIC-BREAKDOWN
title: شکست epicهای فاز ۲ تا ۶ به story
status: proposed
version: 1.2.0
owner: Product & Engineering
last_updated: 2026-10-06
notion_sync: true
---

# شکست epicهای فاز ۲ تا ۶ به story

این سند خروجی spike برای epicهای [backlog اجرایی](06-implementation-backlog.md) است. هر story یک vertical slice قابل‌آزمون با requirement، وابستگی و معیار پذیرش است و از همان [تعریف مشترک Done](06-implementation-backlog.md) پیروی می‌کند. Issue هر story فقط وقتی ساخته و شروع می‌شود که gate فاز قبل در [نقشهٔ راه](04-roadmap.md) بسته شده باشد؛ storyهای فاز ۲ بلافاصله قابل شروع‌اند و فازهای بعد پیش از شروع با یافته‌های فاز قبل بازبینی می‌شوند.

## پیش‌فرض‌های مشترک

- control plane فاز ۱ (هویت، workspace، موضوع، پروژه، تنظیمات نسخه‌دار، audit و RLS) آماده و آزموده است.
- fixtureهای ingest از [acceptance corpus v0](../../qa/acceptance-corpus/README.md) با شناسهٔ item (مثل `scan-fa-001`) استفاده می‌شوند.
- هر story که داده یا job جدید می‌سازد باید RLS، audit و آزمون منفی tenant داشته باشد.
- providerهای بیرونی (AI، OCR، transcription، search) پشت adapter و با fake قطعی در CI آزمون می‌شوند؛ credential واقعی فقط در محیط integration.

## ING — upload، quarantine، parsing و lineage (فاز ۲، epic #25)

| ID      | عنوان                                         | requirement             | وابستگی          | معیار پذیرش                                                                                       |
| ------- | --------------------------------------------- | ----------------------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| ING-001 | source asset و upload مستقیم به object store  | FR-ING-001..003         | TEN-001، CFG-001 | upload با URL امضاشده، حد حجم از تنظیمات، checksum و metadata ثبت و در audit دیده می‌شود          |
| ING-002 | quarantine، MIME sniff و malware scan         | FR-ING-004، NFR-SEC-005 | ING-001          | فایل آلوده یا MIME ناهمخوان quarantine می‌ماند و هرگز به parser نمی‌رسد؛ رویداد امنیتی ثبت می‌شود |
| ING-003 | worker ingestion با Temporal و parser sandbox | FR-ING-002، NFR-SEC-006 | ING-002          | PDF/DOCX/PPTX/XLSX/CSV/TXT/MD/JSON در sandbox بدون شبکه parse و متن با lineage ذخیره می‌شود       |
| ING-004 | OCR تصویر و PDF اسکن‌شده                      | FR-ING-005              | ING-003          | `scan-fa-001` و `scan-en-001` حداقل دقت corpus را می‌گیرند؛ متن به صفحه و فایل اصلی پیوند دارد    |
| ING-005 | transcription صوت                             | FR-ING-005              | ING-003          | `audio-fa-001` و `audio-en-001` حداقل دقت واژه را می‌گیرند؛ زمان‌بندی بخش‌ها ذخیره می‌شود         |
| ING-006 | ورود متن و URL                                | FR-ING-001              | ING-001          | URL با allowlist/SSRF guard دریافت، snapshot و مثل فایل وارد خط لوله می‌شود                       |
| ING-007 | نسخهٔ جدید سند و lineage                      | FR-ING-006              | ING-003          | بارگذاری نسخهٔ جدید lineage قبلی را حفظ و دانش وابسته را stale می‌کند                             |
| ING-008 | claim candidate از متن استخراج‌شده            | FR-KNO-003              | ING-003          | claimهای مؤثر با محل دقیق در منبع پیشنهاد می‌شوند و بدون ممیزی Brain قابل retrieval نیستند        |

## KNO — دانش، Brain و retrieval (فاز ۲، epic #26)

| ID      | عنوان                                       | requirement                 | وابستگی         | معیار پذیرش                                                                                |
| ------- | ------------------------------------------- | --------------------------- | --------------- | ------------------------------------------------------------------------------------------ |
| KNO-001 | knowledge item، version، scope و provenance | FR-KNO-001..002             | ING-003         | هر item نوع منبع، provenance، scope (workspace/topic/project)، confidentiality و نسخه دارد |
| KNO-002 | state machine ممیزی و gate retrieval        | FR-KNO-004، FR-KNO-006..007 | KNO-001         | فقط approved در retrieval است؛ تغییر محتوا status را pending و ارزیابی قبل را stale می‌کند |
| KNO-003 | ممیزی Brain سند و claim با score شش‌بعدی    | FR-KNO-003، FR-KNO-005      | KNO-002، AI-002 | score، reason و نسخهٔ rubric ذخیره می‌شود؛ fake provider در CI نتیجهٔ قطعی دارد            |
| KNO-004 | override ادمین با دلیل                      | FR-KNO-008                  | KNO-002         | override بدون دلیل رد می‌شود و نشان انسانی و audit critical دارد                           |
| KNO-005 | ثبت و نمایش تعارض دانش                      | FR-KNO-009                  | KNO-003         | تعارض دو claim ثبت و به هر مصرف‌کنندهٔ retrieval همراه هشدار داده می‌شود                   |
| KNO-006 | citation کامل                               | FR-KNO-010                  | KNO-001         | citation بدون URL/شناسه، عنوان، ناشر، تاریخ و accessed_at ناقص علامت می‌خورد               |
| KNO-007 | hybrid retrieval با snapshot                | FR-WF-002، FR-KNO-006       | KNO-002         | جست‌وجوی lexical+vector فقط approvedها را برمی‌گرداند و snapshot قابل‌تکرار ثبت می‌شود     |

## WF — Temporal workflows و human gate (فاز ۳، epic #27)

| ID     | عنوان                                        | requirement            | وابستگی         | معیار پذیرش                                                                               |
| ------ | -------------------------------------------- | ---------------------- | --------------- | ----------------------------------------------------------------------------------------- |
| WF-001 | workflow پروژه با مراحل ثابت                 | FR-WF-001              | PRJ-001         | activate پروژه یک workflow با ترتیب تحلیل→تحقیق→ایده→مستند→ارزیابی شروع می‌کند            |
| WF-002 | stage run، attempt و idempotency             | FR-WF-006، NFR-REL-002 | WF-001          | command تکراری side effect دوباره نمی‌سازد؛ replay همان نتیجه را می‌دهد                   |
| WF-003 | gate دستی/خودکار و waiting_for_human         | FR-WF-003، FR-WF-005   | WF-002، CFG-001 | gate پیش‌فرض دستی است؛ نیاز انسانی وضعیت را waiting_for_human و timeline را به‌روز می‌کند |
| WF-004 | pause، resume، cancel و retry بی‌اتلاف state | FR-WF-004، NFR-REL-003 | WF-002          | قطع worker در میانهٔ مرحله state را از دست نمی‌دهد و resume از مرز امن ادامه می‌دهد       |
| WF-005 | سقف ده attempt و عبور با تصمیم ادمین         | FR-WF-007              | WF-002          | attempt یازدهم فقط با تصمیم ثبت‌شده و دلیل ممکن است                                       |
| WF-006 | بازبینی خروجی مرحله و invalidation           | FR-WF-008..009         | WF-003          | approve/reject/edit/comment ثبت و edit ارزیابی و approval همان نسخه را باطل می‌کند        |

## AI — provider orchestration (فاز ۳، epic #28)

| ID     | عنوان                                             | requirement               | وابستگی        | معیار پذیرش                                                                                                                                                                                                                                                                                            |
| ------ | ------------------------------------------------- | ------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AI-001 | provider connection و secret write-only           | FR-AI-001، FR-AI-004      | TEN-001        | secret رمز و هرگز در API/UI/log بازگردانده نمی‌شود؛ rotate نسخهٔ قبلی را برنمی‌گرداند                                                                                                                                                                                                                  |
| AI-002 | قرارداد واحد و adapterهای OpenAI/Gemini/Anthropic | FR-AI-001، FR-AI-003      | AI-001         | یک فراخوانی ساختاریافته روی هر سه provider با fake و آزمون قرارداد سبز است                                                                                                                                                                                                                             |
| AI-003 | catalog مدل و capability snapshot                 | FR-AI-002                 | AI-002         | فهرست مدل refresh و snapshot می‌شود؛ هیچ نام مدلی در کد hardcode نیست                                                                                                                                                                                                                                  |
| AI-004 | health، retry schedule و pause                    | FR-AI-005..006، FR-AI-008 | AI-002، WF-004 | خطای پیاپی طبق schedule retry و سپس پروژه را pause می‌کند؛ fallback پیش‌فرض خاموش است                                                                                                                                                                                                                  |
| AI-005 | usage، latency و برآورد هزینه                     | FR-AI-007                 | AI-002         | هر invocation token، latency، finish reason و هزینه دارد و با سقف هزینهٔ پروژه مقایسه می‌شود                                                                                                                                                                                                           |
| AI-006 | آزمون خودکار مدل، قیمت و دلیل خطای provider       | FR-AI-005، FR-AI-007      | AI-002، AI-005 | ادمین با یک کلیک می‌بیند هر نوع تماس محصول روی مدل انتخابی کار می‌کند؛ مدل بی‌قیمت سقف هزینه را خاموش نمی‌کند؛ دلیل شکست sanitize‌شده ثبت و نشان داده می‌شود ([ADR-0020](../adr/0020-real-provider-readiness.md))                                                                                      |
| AI-007 | کسب‌وکار پروژه از Contenter                       | FR-AI-001، FR-AI-004      | AI-001، AI-006 | پروژه به کسب‌وکار Contenter وصل می‌شود؛ ایجنت‌ها فقط بخش لازم نقش خود را با سقف حجم می‌گیرند و هر اجرا، نگارش و تماس به snapshot نسخه‌دار خود سنجاق است؛ توکن سرویس write-only است؛ خاموشی Contenter کار را متوقف نمی‌کند؛ اصطلاحات را کد می‌سنجد ([ADR-0021](../adr/0021-business-from-contenter.md)) |
| AI-008 | قیمت مدل‌ها از کاتالوگ عمومی                      | FR-AI-007                 | AI-005، AI-006 | ادمین قیمت پیشنهادی هر مدل را کنار قیمت فعلی می‌بیند و خودش انتخاب می‌کند؛ ثبت از نسخهٔ خود سرور با `catalogHash`، منبع و audit انجام می‌شود؛ قیمت صفر یا نامعتبر هرگز پیشنهاد نمی‌شود؛ خاموشی کاتالوگ ثبت دستی را متوقف نمی‌کند ([ADR-0022](../adr/0022-model-prices-from-public-catalog.md))         |

## SOL/DOC/EVA — راه‌حل، سند و ارزیابی (فاز ۴، epic #29)

| ID      | عنوان                                    | requirement     | وابستگی         | معیار پذیرش                                                                       |
| ------- | ---------------------------------------- | --------------- | --------------- | --------------------------------------------------------------------------------- |
| SOL-001 | تولید راه‌حل‌های ساختاریافته             | FR-SOL-001..002 | WF-003، AI-002  | ۲ تا ۲۰ راه‌حل (پیش‌فرض ۵) با همهٔ بخش‌های الزامی ذخیره می‌شود                    |
| SOL-002 | معیار وزن‌دار و امتیاز قابل‌توضیح        | FR-SOL-003..004 | SOL-001         | وزن‌ها جمع ۱۰۰ دارند و امتیاز خام، وزن‌دار و توضیح محاسبه نمایش داده می‌شود       |
| SOL-003 | انتخاب و اولویت راه‌حل‌ها                | FR-SOL-005..006 | SOL-002         | هر راه‌حل منتخب lifecycle سند مستقل دارد                                          |
| DOC-101 | مدل ساختاری سند و سطح طول                | FR-DOC-001..005 | SOL-003         | شمارش فقط حرف و عدد Unicode است و سند خارج bounds قابل‌تأیید نهایی نیست           |
| DOC-102 | نسخه، diff، restore، lock و supersede    | FR-DOC-006      | DOC-101         | نسخهٔ قفل‌شده بی‌ردپا ویرایش نمی‌شود؛ restore نسخهٔ جدید می‌سازد                  |
| DOC-103 | export DOCX/PDF/PPTX با artifact امضاشده | FR-DOC-007..008 | DOC-102         | artifact checksum، renderer version و source version دارد                         |
| EVA-001 | rubric نسخه‌دار و ارزیابی شش‌بعدی        | FR-EVA-001..002 | DOC-101         | rubric سیستم و override پروژه نسخه دارند و هر بعد امتیاز و evidence دارد          |
| EVA-002 | finding و حلقهٔ اصلاح                    | FR-EVA-003..005 | EVA-001، WF-005 | finding با severity و target stage ثبت؛ accepted_with_exception از approved جداست |

شناسهٔ سند از `DOC-101` شروع می‌شود چون `DOC-001..003` در فاز ۰ برای تأیید مستندات استفاده شده‌اند.

## REP — dashboard، Brain report و audit explorer (فاز ۵، epic #30)

| ID      | عنوان                         | requirement     | وابستگی          | معیار پذیرش                                                                   |
| ------- | ----------------------------- | --------------- | ---------------- | ----------------------------------------------------------------------------- |
| REP-001 | dashboard عملیاتی             | NFR-UX-*        | WF-003، AI-004   | کارت‌های بخش ۳ [UX بک‌آفیس](../01-product/05-backoffice-ux.md) با دادهٔ واقعی |
| REP-002 | گزارش Brain پروژه و workspace | FR-BRN-001..005 | KNO-003، EVA-002 | انحراف از charter با evidence گزارش و هیچ تغییر خودکاری اعمال نمی‌شود         |
| REP-003 | UI audit explorer و export    | FR-AUD-001..005 | AUD-001، UX-001  | فیلترها و export API فاز ۱ در UI با RTL/LTR و کیبورد قابل‌استفاده‌اند         |
| REP-004 | گزارش هزینه و عملکرد پروژه    | FR-AI-007       | AI-005           | هزینه و token هر مرحله و پروژه با بازهٔ زمانی گزارش می‌شود                    |

## SEC/SRE/REL — hardening و private beta (فاز ۶، epic #31)

| ID      | عنوان                               | requirement | وابستگی                   | معیار پذیرش                                                            |
| ------- | ----------------------------------- | ----------- | ------------------------- | ---------------------------------------------------------------------- |
| SEC-001 | SAST/SCA/container scan اجباری      | NFR-SEC-*   | —                         | CodeQL (پس از Code Security)، `pnpm audit` و Trivy روی هر PR گیت هستند |
| SEC-002 | DAST و آزمون نفوذ مسیر احراز هویت   | NFR-SEC-*   | REP-003                   | گزارش DAST بدون یافتهٔ high/critical باز                               |
| SRE-001 | SLO، هشدار و dashboard مشاهده‌پذیری | NFR-OBS-*   | WF-004                    | SLOهای [SRE](03-observability-and-sre.md) اندازه‌گیری و هشدار دارند    |
| SRE-002 | آزمون بار مسیر اصلی                 | NFR-PERF-*  | WF-004، AI-004            | مسیر اصلی در بار هدف بدون نقض SLO می‌ماند                              |
| REL-001 | backup و restore آزموده             | NFR-REL-*   | —                         | restore کامل در محیط جدا با RPO/RTO هدف اثبات می‌شود                   |
| REL-002 | private beta و runbook              | NFR-REL-*   | SEC-002، SRE-001، REL-001 | runbook حادثه، rollback release و پذیرش مالک ثبت می‌شود                |
