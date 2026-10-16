---
doc_id: DOCOO-AI-EVALUATION
title: ارزیابی و تضمین کیفیت خروجی AI
status: proposed
version: 1.0.2
owner: AI Quality
last_updated: 2026-10-16
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

## ۱۰. آزمایشگاه مقایسهٔ جفتی — ADV-013

این برش از کار محلی پیشین روی `main` با SHA `686ff0f09c60357077f290190794a593d574bdc7` تطبیق داده شد؛ نقش‌ها، provider runtime، رابط عمومی و تاریخچهٔ migrationهای موجود بازپیاده‌سازی نشده‌اند. هستهٔ مقایسه و ذخیره‌سازی، قرارداد API و صفحهٔ فارسی/انگلیسی اضافه شده‌اند؛ شروع اجرای تازه و اتصال worker هنوز در این برش نیست.

مجموعهٔ مصنوعی ثابت ۳۰ پرونده دارد: ۱۵ فارسی/۱۵ انگلیسی در شش زمینهٔ کسب‌وکار؛ بازنشر، تفاوت زمینه، واحد ناسازگار، نبود شاهد و دستور مخرب داخل منبع را پوشش می‌دهد. hash مجموعه `890e5af57321bd9f0832781a36364239af7ef68a2fc8dbd880e55847acf18351` است. manifest هر آزمایش نسخهٔ dataset، مدل/config، prompt، retrieval، rubric و قیمت را به hash دقیق snapshotها متصل می‌کند. دو نسخه باید روی پرونده‌ها و rubric یکسان اجرا شوند؛ ترتیب شروع A/B بین پرونده‌ها متناوب است. هر پاسخ پیش از تماس بعدی ثبت می‌شود؛ خطا/لغو/timeout توقف می‌سازد و اجرای نیمه‌تمام کورکورانه replay نمی‌شود.

مهاجرت‌های افزایشی `0044_paired_evaluation_experiments` و `0045_evaluation_review_commands` چهار جدول پروژه‌ای با RLS اجباری می‌سازند: manifest، پاسخ‌های ترتیبی، بازبینی/مقایسه و ledger فرمان بازبینی. دسترسی VIEW فقط خواندنی است؛ editor با EDIT می‌تواند بازبینی خودش را ثبت کند و لغو grant خواندن خروجی قدیمی را نیز قطع می‌کند. تاریخچه immutable و audit محدود به شناسه، شمار و hash است. مهاجرت‌های شمارهٔ ۱۱۵/۱۱۶ شاخهٔ قدیمی به این شاخه منتقل نشده‌اند و مهاجرت اعمال‌شده‌ای تغییر نکرده است.

صفحه از داخل پروژه در دسترس است و از همان پوسته و tokenهای رابط جدید استفاده می‌کند. بستهٔ بازبینی نام مدل/run، هزینه و زمان را حذف می‌کند و A/B هر پرونده را جابه‌جا می‌چیند؛ خود متن خروجی ممکن است به مدل اشاره کند، پس ادعای کورسازی کامل مشارکت‌کننده نداریم. خروجی فقط متن است، نه HTML قابل‌اجرا. بازبین برای همهٔ خروجی‌ها نمرهٔ ۰ تا ۱۰۰، خطای citation و پذیرش/بررسی‌نشده وارد می‌کند. مقدار خالی صفر نمی‌شود؛ ارقام فارسی/عربی پذیرفته می‌شوند. شکل و hash خروجی و reviewer احراز‌شده اعتبارسنجی می‌شوند. judge label، actor و credential از بدنه پذیرفته نمی‌شوند. retry شبکه همان بدنه و `Idempotency-Key` را نگه می‌دارد؛ برخورد کلید و محتوای متفاوت حتی در درخواست هم‌زمان 409 می‌دهد.

گزارش FA/EN/all شامل امتیاز انسانی، اختلاف امتیاز، regression، خطای citation، p50/p95 latency و پوشش هزینه است. قیمت/هزینهٔ ناموجود و judge-human ناموجود `null` هستند، نه صفر. هیچ تغییر default، promotion، pass/fail یا انتخاب مدل خودکار انجام نمی‌شود. نمره‌های fixture آزمون مصنوعی‌اند و شاهد بهبود مدل نیستند.

آزمون‌ها با Node 24 از ریشهٔ مخزن:

- `pnpm test:evaluation:lab:local`: build و سپس پایگاه و login تصادفی مستقل روی PostgreSQL 18 محلی؛ ۶۰ پاسخ پایدار، بازخوانی، HTTP واقعی با cookie/guard، RLS، لغو grant، حفظ تاریخچه، idempotency و درخواست هم‌زمان. متغیرهای PostgreSQL محلی در `.env` یا محیط لازم‌اند. فقط منابع ساخته‌شدهٔ خود تست حذف می‌شوند؛ pool پیش از حذف پایگاه تا بسته‌شدن socketها تخلیه می‌شود.
- `pnpm --filter @docoo/web test:evaluation:browser`: چهار تست Chromium با API شبیه‌سازی‌شده، در dev server مستقل روی loopback:3400؛ فارسی/انگلیسی، امتیازدهی و pagination، retry با همان کلید، متن غیرقابل‌اجرا، VIEW و موبایل. این آزمون با gate واقعی API/DB متفاوت است و E2E کامل worker نیست.

باقی‌ماندهٔ ADV-013: snapshot و adapter مسیر واقعی نقش‌ها با runtime فعلی، orchestration بادوام و تعیین تکلیف تماس نامعلوم، API/فرم آغاز اجرا، E2E کامل UI/API/worker، هزینهٔ ledger واقعی، برچسب انسانی و judge-human واقعی و پیشنهاد case پالایش‌شده از شکست واقعی. برای این برش هیچ provider زنده یا API key استفاده نشد.

مرز اتصال بعدی در این main، `packages/orchestration/src/stages.ts` با `stagePrompt` و `STAGE_SCHEMAS`، profileهای نسخه‌دار `agents.ts`، `ProviderRuntime` در `runtime.ts` و worker فعلی `apps/worker-agent` است؛ ساخت مسیر موازی روی worker شاخهٔ قدیمی مجاز نیست. runtime کنونی `costUsd` را تخمین می‌زند؛ این مقدار نباید به فیلد هزینهٔ واقعی آزمایش کپی شود. تا وجود منبع هزینهٔ واقعی با provenance روشن، هزینهٔ واقعی آزمایش null می‌ماند. snapshotها باید سمت سرور از نسخه‌های مجاز ساخته شوند، نه از prompt، کلید یا هزینهٔ دلخواه مرورگر.

## ۱۱. snapshot تولیدی و fencing فراخوانی — ADV-013

`captureStageEvaluationArm` نسخهٔ immutable نقش در همان workspace/پروژه، مدل حاضر در آخرین catalog، قابلیت text/structured output، سقف خروجی و snapshot قیمت موجود را سمت سرور می‌گیرد. نقش نادرست، نسخهٔ پروژهٔ دیگر، مدل غایب/ناسازگار و پروژهٔ خارج دسترسی یا آرشیوشده رد می‌شوند. `prepareStageEvaluationArm` برای هر پنج نقش همان `stagePrompt` و `STAGE_SCHEMAS` تولیدی را برای هر پرونده و زبان pin می‌کند؛ مدل، نسخهٔ نقش، catalog hash، متن واقعی prompt، schema، سقف و timeout hash می‌شوند. پیش از اجرا، بازسازی snapshot از کد فعلی باید دقیقاً برابر باشد؛ code drift مجاز نیست.

این حالت صریحاً `stage-structured-output` است: corpus خودبسندهٔ مصنوعی، بدون ابزار خارجی، دادهٔ پروژه یا خروجی upstream. بنابراین مقایسهٔ کامل tool loop یا workflow نیست؛ API/فرم یا worker هنوز این مسیر را آغاز نمی‌کنند. fake در production ممنوع و تماس زنده نیازمند opt-in صریح caller است. کلید هیچ‌گاه در snapshot یا بدنهٔ کاربر قرار نمی‌گیرد. `app.evaluation_model_snapshot` فقط descriptor مدل انتخابی و قیمت غیرمحرمانه را پس از کنترل همان actor، workspace و EDIT برمی‌گرداند؛ RLS خواندن secret برای editor باز نشده است. runtime با اختیار داخلی سرور credential را آماده می‌کند و پیش و پس از آن، مجوز initiating actor را دوباره می‌سنجد؛ استفاده از اختیار worker به‌جای کاربر لغوشده ممنوع است.

مهاجرت افزایشی `0046_evaluation_invocation_journal` جدول پنجم `project_evaluation_invocation_journal` را اضافه می‌کند. پیش از تماس، intent شامل manifest/run/case/model hash و hash درخواست واقعی commit می‌شود. کلید یکتای ordinal و guard ترتیب، فقط یک مجوز تماس می‌دهند؛ وجود pending یا unknown lease منقضی‌شونده نیست و retry خودکار را مجاز نمی‌کند. پس از پاسخ، رسید مستقل شامل شناسهٔ واقعی `model_invocations`، hash خروجی، مدل مشاهده‌شده، پاسخ معتبر یا خطای امن ثبت می‌شود و سپس نتیجه به runner می‌رسد. SQL scope/purpose/provider/model/request hash رسید را با ledger می‌سنجد؛ یک invocation نمی‌تواند برای دو intent مصرف شود. رسید پایانی و intent تغییرپذیر نیستند. خطای سرویس به unknown بدون متن exception تبدیل می‌شود. هزینهٔ receipt فقط null است؛ تخمین runtime به هزینهٔ واقعی تبدیل نمی‌شود.

قطع پردازش بین commit رسید و نتیجهٔ پرونده، رسید قابل‌بازخوانی باقی می‌گذارد و همان تماس دوباره ارسال نمی‌شود. لغو مجوز پس از intent نیز فراخوانی را متوقف می‌کند و ممکن است pending باقی بگذارد. اجرای پس از restart، reconciliation این حالت و تصمیم ادامه/توقف هنوز باید در worker بادوام پیاده شوند؛ این برش ادعای پایان آن کار ندارد.

شواهد این مرحله: ۱۲ تست تازهٔ adapter، شامل هر پنج نقش، دو زبان، تطبیق prompt/schema، ترتیب commit، توقف retry در گم‌شدن acknowledgment، خطای مدل/خروجی، code drift، fake-production و opt-in زنده؛ کل orchestration ۱۲۱ تست پاس‌شده دارد. gate واقعی PostgreSQL با همان فرمان بخش قبل، ۶۰ تماس جفتی FakeAdapter در ProviderRuntime واقعی به‌علاوهٔ دو probe قطع پردازش/رقابت اجرا کرد؛ intent/receipt، invocation ledger، RLS، grant revoke، receipt scope و immutable بودن را سنجید. همهٔ تماس‌ها مصنوعی بودند و پایگاه/login تست حذف شدند. تست‌های contracts و application اکنون dist را exclude می‌کنند؛ تعدادهای یکتای منبع به‌ترتیب ۱۲ و ۱۵ است، نه شمار قبلی که اجرای فایل کامپایل‌شده را دوباره می‌شمرد.

در بررسی CI برش قبلی، ورود `node:crypto` از barrel عمومی domain به `stages.ts` و bundle Temporal محلی بازتولید شد؛ build TypeScript به‌تنهایی این خطا را نمی‌دید. utilityهای ارزیابیِ وابسته به Node اکنون فقط در subpath `@docoo/domain/evaluation` صادر می‌شوند و root domain برای workflow امن می‌ماند. تست `apps/worker-agent/src/workflow-bundle.test.ts` bundle واقعی entry تولیدی را می‌سازد، بدون ignore کردن ماژول ممنوع؛ پس از اصلاح پاس شد. چهار تست خود آزمایشگاه در CI قبلی روی هر دو Firefox و WebKit پاس شده‌اند؛ این شاهد به‌تنهایی سبز بودن کل CI یا workflowهای دیگر را ثابت نمی‌کند.
