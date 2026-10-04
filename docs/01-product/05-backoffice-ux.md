---
doc_id: DOCOO-BACKOFFICE-UX
title: معماری اطلاعات و تجربه بک‌آفیس
status: proposed
version: 1.0.0
owner: Product Design
last_updated: 2026-09-24
notion_sync: true
---

# معماری اطلاعات و تجربهٔ بک‌آفیس

## ۱. اصول طراحی

- desktop-first اما responsive؛ موبایل برای مشاهده و approval، نه ویرایش سنگین سند.
- progressive disclosure: تنظیمات مهم ابتدا، advanced در drawer/tab.
- هر صفحهٔ workflow نوار وضعیت ثابت با «مرحله، حالت، دلیل توقف، اقدام بعدی» دارد.
- رنگ تنها حامل معنا نیست؛ icon، label و متن همراه وضعیت‌اند.
- عملیات مخرب confirmation دو‌مرحله‌ای و نمایش اثر دارند.
- UI فارسی و انگلیسی از یک token/layout system استفاده می‌کنند.

## ۲. ناوبری اصلی

1. **داشبورد**
2. **پروژه‌ها**
3. **حوزه‌های موضوعی**
4. **دانش و ممیزی**
5. **ایجنت‌ها**
6. **قالب‌ها و سطوح سند**
7. **گزارش Brain**
8. **ارائه‌دهندگان AI**
9. **Audit Log**
10. **اسمارت** (خطایاب و دفتر خطاها؛ واکر و گفتگو در پنجرهٔ شناور) — [اسمارت](06-smart.md)
11. **تنظیمات سامانه**

## ۳. داشبورد

کارت‌ها و فهرست‌های ضروری:

- پروژه‌های منتظر پاسخ/تأیید؛
- workflowهای فعال، paused و failed؛
- دانش‌های pending/expired/conflicted؛
- provider health و quota warning؛
- retryهای نزدیک سقف؛
- هزینه و token بازه؛
- آخرین گزارش Brain؛
- اقدام‌های سریع ایجاد پروژه و حوزه.

## ۴. فهرست پروژه‌ها

ستون‌ها: کد، عنوان، حوزه‌ها، وضعیت، مرحلهٔ جاری، gate، آخرین فعالیت، owner، زبان، warning. filter بر وضعیت، حوزه، نقش منتظر، زبان و تاریخ. archive و delete bulk در نسخهٔ اول ضروری نیست؛ عملیات حساس تک‌موردی باقی می‌ماند.

## ۵. ایجاد/ویرایش پروژه

wizard پیشنهادی:

1. اطلاعات پایه و مسئله؛
2. انتخاب و اولویت حوزه؛
3. workflow و gate؛
4. ایجنت، مدل و پارامتر؛
5. دانش و سیاست تحقیق؛
6. راه‌حل و معیارها؛
7. اسناد، سطح و export؛
8. مرور effective configuration و ثبت.

هر گام draft خودکار دارد. خروج از wizard داده را از بین نمی‌برد.

## ۶. صفحهٔ پروژه

### سربرگ

کد، عنوان، status، stage، health، دکمه pause/resume و منوی archive/delete.

### تب‌ها

- **Overview:** خلاصه، حوزه، next action، milestone و هشدار.
- **Problem:** متن اولیه، سؤال‌وپاسخ‌ها، نسخه‌های تعریف نهایی.
- **Workflow:** timeline مرحله‌ها، run/attempt و gate.
- **Knowledge:** ورودی‌ها، candidates، audit، conflict و used-in.
- **Solutions:** کارت/جدول گزینه‌ها، scorecard، انتخاب و اولویت.
- **Documents:** درخت سند، نسخه، diff، approval و export.
- **Agents:** effective charter/model/config هر نقش.
- **Audit:** فیلتر رویدادهای همان پروژه.

## ۷. تجربهٔ سؤال‌وپاسخ تحلیلگر

هر batch شماره و coverage دارد. پاسخ inline، attachment و سه وضعیت خاص ارائه می‌شود. progress کل `answered / asked / minimum / maximum` نمایش داده می‌شود. تحلیلگر نباید سؤال‌های تکراری را بدون دلیل نشان دهد. پایان هر batch، خلاصهٔ «آنچه فهمیدم» و «ابهام بعدی» ارائه می‌شود.

## ۸. دانش و Brain

صف ممیزی دو نما دارد:

- نمای سند: source، نسخه، owner، status و overall score؛
- نمای claim: ادعا، citation، score ابعاد، conflict و decision.

پنل override باید تصمیم Brain، شواهد، اثر override، فیلد دلیل و مدت اعتبار را نشان دهد.

## ۹. ایجنت‌ها

برای هر نقش:

- نسخهٔ فعال اصول و وظایف؛
- editor با preview diff؛
- model default و capability warning؛
- tools allowlist؛
- schema خروجی؛
- history و rollback؛
- performance report Brain.

در پروژه دکمهٔ «کپی از پیش‌فرض» snapshot مستقل می‌سازد. UI باید هشدار دهد که update آیندهٔ default، snapshot سفارشی را تغییر نمی‌دهد.

## ۱۰. سند و نسخه

editor ساختاریافته با outline، citation، table و figure لازم است. صفحه هم‌زمان موارد زیر را نشان می‌دهد:

- level و شمارندهٔ رسمی؛
- وضعیت validation؛
- نسخه و منشأ تغییر؛
- source/evidence panel؛
- compare با نسخهٔ قبل؛
- approval/evaluation؛
- export jobs.

## ۱۱. وضعیت‌ها و پیام خطا

پیام خطا باید چهار بخش داشته باشد: چه شد، چه چیزی حفظ شد، سیستم چه خواهد کرد و ادمین چه اقدامی می‌تواند انجام دهد. برای provider failure شمار retry بعدی و زمان آن نمایش داده می‌شود. خطای sanitize‌شده برای کاربر و correlation ID برای پشتیبانی ارائه می‌شود.

## ۱۲. تنظیمات ارائه‌دهنده

کارت هر provider: enabled، آخرین health check، مدل‌های کشف‌شده، region/retention note، quota/rate limit، secret آخرین تغییر و دکمهٔ Test. مقدار secret هرگز دوباره نمایش داده نمی‌شود.

## ۱۳. responsive و accessibility

- جدول‌های عریض در موبایل به card/column chooser تبدیل می‌شوند.
- action اصلی در پایین viewport موبایل ثابت می‌ماند.
- modal برای workflow پیچیده استفاده نمی‌شود؛ drawer یا صفحهٔ مستقل ترجیح دارد.
- live region برای تغییر stage/job status استفاده می‌شود.
- shortcutها مستند و قابل‌غیرفعال‌سازی‌اند.
