---
doc_id: DOCOO-AGENT-SYSTEM
title: معماری سامانه ایجنتی Docoo
status: proposed
version: 1.0.0
owner: AI Architecture
last_updated: 2026-09-24
notion_sync: true
---

# معماری سامانهٔ ایجنتی Docoo

## ۱. اصل پایه

ایجنت در Docoo «مدل» نیست. ایجنت یک قرارداد نسخه‌بندی‌شده شامل نقش، اصول، وظایف، prompt، ابزار، سیاست دانش، schema خروجی، rubric و policy مدل است. مدل یکی از dependencyهای اجرای این قرارداد است. این تفکیک اجازه می‌دهد مدل تغییر کند بدون اینکه هویت و مسئولیت نقش از بین برود.

## ۲. شش نقش

| نقش | نوع | مأموریت |
|---|---|---|
| Analyst | مرحله‌ای | کشف نیاز واقعی و تعریف نهایی مسئله |
| Researcher | مرحله‌ای | جمع‌آوری شواهد و نمونه‌های مشابه |
| Ideator | مرحله‌ای | ساخت گزینه‌های متمایز و قابل‌اجرا |
| Documenter | مرحله‌ای | تبدیل راه‌حل به اسناد ساختاریافته |
| Evaluator | مرحله‌ای | سنجش انطباق، کیفیت و کفایت |
| Brain | حاکمیتی جانبی | ممیزی دانش و گزارش عملکرد نقش‌ها |

## ۳. بستهٔ زمینهٔ استاندارد

Orchestrator برای هر invocation یک `ContextEnvelope` می‌سازد:

1. شناسه‌های workspace/project/stage/run/attempt؛
2. زبان و زمان مرجع؛
3. نسخهٔ اصول و وظایف نقش؛
4. مسئلهٔ اولیه و آخرین تعریف تأییدشده؛
5. اسناد حوزه‌ها به ترتیب اولویت؛
6. خروجی‌های approved مرحلهٔ قبل؛
7. knowledge snapshot مجاز با citation و conflict flag؛
8. feedback و findings مرتبط؛
9. output schema و length policy؛
10. tool policy و budget؛
11. resolved model config؛
12. safety و confidentiality instructions.

Envelope immutable و hash‌شده است. تغییر ادمین envelope جدید برای call بعدی می‌سازد.

## ۴. لایه‌های prompt

ترتیب و authority:

1. platform safety؛
2. Docoo system contract؛
3. role principles؛
4. role duties؛
5. project overrides؛
6. task instructions؛
7. context data؛
8. feedback.

محتوای فایل و وب همیشه داخل data delimiter و با برچسب «untrusted content» وارد می‌شود. دستور داخل منبع نباید authority بگیرد.

## ۵. قرارداد خروجی

هر نقش ابتدا structured output معتبر تولید می‌کند، سپس renderer نمای انسانی را می‌سازد. حداقل envelope خروجی:

```json
{
  "schemaVersion": "1",
  "role": "researcher",
  "status": "complete",
  "summary": "...",
  "artifacts": [],
  "claims": [],
  "citations": [],
  "assumptions": [],
  "openQuestions": [],
  "warnings": [],
  "qualitySelfCheck": {},
  "nextStageHandoff": {}
}
```

Parser نباید متن آزاد نامعتبر را silently قبول کند. repair محدود با همان مدل مجاز است و attempt ثبت می‌شود.

## ۶. ابزارها

ابزارها capability-based هستند:

- search/read web؛
- retrieve knowledge؛
- read project documents؛
- create structured table/chart spec؛
- calculator/code sandbox محدود؛
- citation verifier؛
- document renderer؛
- request human input.

هر نقش allowlist مستقل دارد. tool call شامل input hash، output reference، latency و policy decision است.

## ۷. حافظه

Docoo حافظهٔ ضمنی و نامحدود مدل را منبع حقیقت نمی‌داند:

- **Run memory:** context و پیام‌های همان stage run؛
- **Project memory:** خلاصه‌ها، تصمیم‌ها و اسناد نسخه‌بندی‌شده؛
- **Role history:** catalog خروجی‌های همان نقش برای گزارش و retrieval مجاز؛
- **Knowledge base:** محتوای ممیزی‌شده و scoped.

هر memory read از retrieval policy عبور می‌کند. history به‌طور کامل داخل prompt ریخته نمی‌شود.

## ۸. handoff

خروجی مرحله برای مرحلهٔ بعد manifest دارد: artifact refs، claims، assumptions، unresolved، decisions، citations و validation. مرحلهٔ بعد فقط artifact approved یا explicitly overridden را مصرف می‌کند. raw chain-of-thought ذخیره یا منتقل نمی‌شود؛ reasoning summary و evidence کافی ذخیره می‌شود.

## ۹. کنترل هزینه و context

- token budget برای نقش و run؛
- chunking سند با locator پایدار؛
- retrieval top-k پس از scope filtering؛
- summary نسخه‌بندی‌شده برای context طولانی؛
- prompt caching فقط با بررسی retention؛
- توقف قبل از عبور budget و human task برای افزایش آن.

## ۱۰. شکست و بازیابی

خطاها طبقه‌بندی می‌شوند: validation، transient provider، rate limit، timeout، tool، policy، permanent configuration و quality rejection. فقط transientها schedule خودکار دارند. retry همان idempotency key منطقی اما attempt جدید دارد. partial output downstream نمی‌رود.
