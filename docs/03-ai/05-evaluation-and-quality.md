---
doc_id: DOCOO-AI-EVALUATION
title: ارزیابی و تضمین کیفیت خروجی AI
status: proposed
version: 1.0.0
owner: AI Quality
last_updated: 2026-09-24
notion_sync: true
---

# ارزیابی و تضمین کیفیت خروجی AI

## ۱. لایه‌های کیفیت

1. **Schema:** خروجی قابل‌parse و فیلدهای لازم حاضرند.
2. **Policy:** scope، tool، confidentiality و knowledge gate رعایت شده‌اند.
3. **Compliance:** زبان، طول، template، citation و artifact معتبرند.
4. **Content quality:** صحت، پوشش، ارتباط، وضوح و عدم تناقض.
5. **Business fitness:** راه‌حل با محدودیت و اهداف پروژه سازگار است.
6. **Human acceptance:** ادمین نتیجه را می‌پذیرد یا exception ثبت می‌کند.

## ۲. rubric عمومی output

| معیار                    | وزن پایه |
| ------------------------ | -------: |
| تطابق با مسئلهٔ تأییدشده |       20 |
| پوشش نیازمندی‌ها         |       15 |
| کیفیت و پیوند شواهد      |       15 |
| تناسب با حوزه/کسب‌وکار   |       15 |
| قابلیت اجرا              |       10 |
| تحلیل ریسک و محدودیت     |       10 |
| سازگاری و عدم تناقض      |        5 |
| وضوح و ساختار            |        5 |
| انطباق قالب/طول/زبان     |        5 |

قبولی پایه overall ≥ 80 است و هیچ finding بحرانی یا معیار evidence/fit زیر 60 نباید وجود داشته باشد. rubric پروژه قابل‌تغییر و نسخه‌بندی است.

## ۳. severity یافته

- **Critical:** نشت داده، استفاده از دانش ممنوع، جعل منبع، راهنمایی زیان‌بار یا نقض بنیادی مسئله؛ همیشه fail.
- **High:** شکاف مهم نیاز، راه‌حل غیرقابل‌اجرا، citation نادرست کلیدی؛ fail.
- **Medium:** ابهام یا ضعف قابل‌اصلاح که نتیجه را کاملاً نامعتبر نمی‌کند.
- **Low:** بهبود سبک/وضوح با اثر محدود.
- **Info:** مشاهده یا پیشنهاد.

## ۴. انتخاب stage بازگشت

- مشکل تعریف مسئله → Analyst.
- کمبود/ضعف شواهد → Researcher.
- گزینه‌های تکراری یا راه‌حل نامناسب → Ideator.
- ساختار، طول، نمودار یا export → Documenter.
- خطای rubric خود ارزیابی → re-run Evaluator پس از اصلاح configuration.

پیش‌فرض همان ایجنت تولیدکننده است، اما finding باید root cause را مشخص کند.

## ۵. ارزیابی نقش

Brain adherence را می‌سنجد:

- principle violations؛
- duty coverage؛
- tool policy violations؛
- استفادهٔ دانش خارج scope؛
- schema repair rate؛
- rejection و retry rate؛
- override rate؛
- latency/token/cost؛
- regression نسبت به prompt/model version.

## ۶. eval dataset

مجموعهٔ نسخه‌بندی‌شده شامل حداقل:

- مسئلهٔ ناقص فارسی و انگلیسی؛
- مسئلهٔ ساده که همچنان ۳۰ سؤال مفید می‌طلبد؛
- پاسخ‌های متعارض ادمین؛
- منبع معتبر/نامعتبر/منقضی/متعارض؛
- prompt injection در فایل و وب؛
- چند حوزه با اولویت؛
- سند هر پنج سطح؛
- provider timeout و partial response؛
- ویرایش ادمین و invalidation؛
- چند راه‌حل و scoring.

هر case expected invariant و judge rubric دارد. LLM-as-judge تنها یکی از سیگنال‌هاست و با validator قطعی و sample human review ترکیب می‌شود.

## ۷. release gate AI

تغییر prompt، charter، model یا retrieval policy پیش از production:

1. offline eval؛
2. مقایسه با baseline؛
3. بررسی امنیت/prompt injection؛
4. shadow/canary روی دادهٔ مصنوعی یا مجاز؛
5. تأیید ادمین برای تغییر default؛
6. ثبت نسخه و rollback point.

Regression بحرانی صفر و افت معیار کلیدی بیش از tolerance مانع release است.

## ۸. گزارش ارزیابی

گزارش شامل target version، rubric version، score breakdown، findings با location/evidence، requirement coverage، تصمیم، target stage، feedback قابل‌اقدام و limitations است. صرفاً جملهٔ «کیفیت پایین است» معتبر نیست.

## ۹. accepted with exception

پس از ده اصلاح یا تصمیم آگاهانه، ادمین می‌تواند عبور دهد. سامانه باید:

- failure اصلی را حفظ کند؛
- دلیل و actor را ثبت کند؛
- badge دائمی `accepted_with_exception` نشان دهد؛
- downstream را از exception مطلع کند؛
- گزارش Brain را تحریف نکند.
