---
doc_id: DOCOO-DOCUMENT-PIPELINE
title: خط لوله ورود و تولید اسناد
status: proposed
version: 1.0.0
owner: Document Platform
last_updated: 2026-09-24
notion_sync: true
---

# خط لولهٔ ورود و تولید اسناد

## ۱. ورودی فایل

1. API upload session و محدودیت را می‌سازد.
2. client مستقیم به quarantine bucket آپلود می‌کند.
3. finalize، size/checksum را تأیید می‌کند.
4. MIME واقعی sniff و extension mismatch flag می‌شود.
5. malware scan و archive bomb limit.
6. parser sandbox.
7. OCR/transcription در صورت نیاز.
8. structured extraction + plain text + preview.
9. admin quality check در partial/low confidence.
10. knowledge candidate.

## ۲. فرمت‌ها

- PDF: متن، صفحه، image و OCR layer.
- DOCX: heading، paragraph، list، table، footnote و relationship.
- PPTX: slide، title، speaker note و object text.
- XLSX/CSV: workbook/sheet/range، header inference با حفظ cell location.
- TXT/MD/JSON: encoding detect و parse امن.
- PNG/JPG: OCR و metadata امن؛ EXIF حساس حذف/محدود.
- Audio: MP3/WAV/M4A/OGG پیشنهادی؛ transcription با timestamp و زبان.

حد پایه ۱۰۰MB per file است؛ audio duration و archive expanded size limit جدا دارند.

## ۳. مدل سند تولیدی

Structured blocks:

- heading(level, id)
- paragraph(runs, citations)
- list(items)
- table(columns, rows, notes)
- figure(assetRef, caption, alt)
- chart(spec, dataRef, caption)
- callout(type, content)
- pageBreak
- appendix
- bibliography

Renderer باید block ناشناخته را fail کند، نه drop خاموش.

## ۴. شمارش رسمی کاراکتر

Algorithm:

1. از structured document، visible textual content canonical استخراج شود؛
2. citation label قابل‌مشاهده بخشی از متن است اما URL markup نیست؛
3. Unicode normalize با NFC؛
4. فقط code pointهایی با General Category `L*` یا `N*` شمارش شوند؛
5. hidden metadata، markup، style و binary alt داخلی شمارش نشوند؛ alt قابل‌مشاهده/خواندنی شمارش شود؛
6. count و algorithm version ذخیره شود.

مثال: «Docoo 2.0!» برابر ۷ کاراکتر شمرده‌شده است: `Docoo20`.

## ۵. کنترل سطح

| سطح |  حداقل | حداکثر |
| --: | -----: | -----: |
|   1 |  1,000 |  3,000 |
|   2 |  5,000 |  7,000 |
|   3 |  9,000 | 11,000 |
|   4 | 13,000 | 17,000 |
|   5 | 22,000 | 28,000 |

Bounds configuration version هستند. سند به version همان policy pin می‌شود. تغییر bounds اسناد approved قدیمی را retroactively نامعتبر نمی‌کند مگر revalidation درخواست شود.

## ۶. DOCX

- style map ثابت و template version؛
- heading واقعی، table header repeat، caption و page number؛
- RTL/LTR paragraph و font fallback؛
- hyperlink/citation؛
- accessibility alt text؛
- metadata شامل document ID/version.

## ۷. PDF

Structured source به HTML print-safe تبدیل و با Chromium sandbox render می‌شود. fontها داخل image موجود، header/footer و page number deterministic. PDF checksum و smoke parse برای تعداد صفحه/متن انجام می‌شود.

## ۸. PPTX

PPTX فقط خلاصهٔ مدیریتی final solution است، نه کپی تمام سند. template پایه:

1. عنوان؛
2. مسئله و هدف؛
3. insightهای کلیدی؛
4. راه‌حل؛
5. evidence/benchmark؛
6. plan و timeline؛
7. هزینه/منابع؛
8. ریسک و کنترل؛
9. KPI؛
10. تصمیم/اقدام بعدی.

تعداد slide با level و template قابل‌تنظیم. overflow text باید validation failure باشد.

## ۹. جدول و نمودار

AI فقط chart spec و data می‌سازد؛ renderer chart را deterministic تولید می‌کند. هر نمودار title، unit، source و alt summary دارد. chart بدون دادهٔ قابل‌ردیابی ممنوع است.

## ۹‌-الف. نگارش سند و ویرایشگر ساختاریافته

از 0.17.0 سند راه‌حل را مستندساز می‌نویسد ([ADR-0019](../adr/0019-document-writing-and-structured-editor.md)): گردش‌کار پایدار `documentWritingWorkflow` با آماده‌سازی، طرح، نگارش زیربخش به زیربخش، تنظیم طول و ذخیره. کد تعیین می‌کند چه چیزی نوشته شود و چه چیزی درست است؛ مدل فقط متن بلوک‌ها را می‌نویسد.

- **بودجه.** هدف کل میانهٔ بازهٔ سطح است؛ حرف‌های ثابتی که کد خودش می‌افزاید (عنوان، سرتیتر، جدول و نمودار امتیاز، منابع) کم می‌شوند و باقی به نسبت وزن بخش‌ها (مسئله ۱، خلاصه ۱، فرض‌ها ۱٫۲، شواهد ۲، برنامه ۲٫۵، ریسک‌ها ۱٫۵، امتیازها ۱) بین زیربخش‌ها (حدود ۲٬۵۰۰ حرف، حداکثر ۶ برای هر بخش) تقسیم می‌شود.
- **تنظیم طول.** تا `document.writing.fit_rounds` دور «گسترش» یا «فشرده‌سازی» زیربخش‌های دورتر از بودجه؛ هرگز پر کردن بی‌محتوا. نتیجهٔ خارج از بازه با `withinBounds=false` و گزارش می‌ماند.
- **ارجاع.** فقط `K#` از دانش approved داده‌شده با نقل‌قول عینی؛ هر نقل‌قول با متن قطعه سنجیده می‌شود و ارجاع ناپیدا دور ریخته و شمرده می‌شود. بلوک `bibliography` را کد از ارجاع‌های تأییدشده می‌سازد.
- **جدول و نمودار** امتیاز در قالب `detailed` ساختهٔ کد از امتیاز وزن‌دار راه‌حل است.
- **نتیجه** یک `DocumentVersion` عادی با `origin=model` است که همان `validateDocument` و شمارندهٔ رسمی را می‌گذراند.
- **ویرایشگر.** ویرایش دستی هر بلوک به نسخهٔ تازهٔ `origin=edit` با دلیل و `If-Match` می‌انجامد؛ `POST /documents/{id}/check` ساختار، شمارش، بازه و ارجاع‌های استفاده‌نشده را پیش از ذخیره می‌گوید.
- **همزمانی.** تا پایان نگارش زنده، هیچ تغییر دیگری روی سند پذیرفته نمی‌شود (409 `DOCUMENT_WRITING_ACTIVE`).

## ۱۰. نسخه و artifact

DocumentVersion source of truth است. Artifact به source version، template version، renderer version و checksum pin می‌شود. تغییر renderer به‌تنهایی می‌تواند artifact جدید همان document version بسازد؛ تغییر محتوا document version جدید می‌خواهد.

## ۱۱. quality checks

- parse/open artifact؛
- page/slide count sane؛
- font missing؛
- text clipping/overflow؛
- broken hyperlink؛
- citation unresolved؛
- image resolution و alt؛
- table width؛
- RTL visual fixture؛
- count compliance.
