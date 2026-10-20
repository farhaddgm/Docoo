---
doc_id: DOCOO-IMPLEMENTATION-BACKLOG
title: backlog اجرایی و ردیابی Docoo
status: active
version: 1.2.3
owner: Product & Engineering
last_updated: 2026-10-16
notion_sync: true
---

# backlog اجرایی و ردیابی Docoo

این سند منبع تولید Issueهای GitHub است. هر Issue باید یک vertical slice کوچک، requirement ID، وابستگی، معیار پذیرش و Definition of Done داشته باشد. Issueهای فاز ۰ و ۱ عمداً به اندازهٔ ۱ تا ۲ روز کاری خرد شده‌اند؛ epicهای فازهای بعدی تا زمان اجرای spike به storyهای کوچک‌تر شکسته نمی‌شوند.

## milestoneها

1. `Phase 0 — Baseline & Foundation`
2. `Phase 1 — Control Plane`
3. `Phase 2 — Ingestion & Knowledge`
4. `Phase 3 — Orchestration & Research`
5. `Phase 4 — Solutions & Documents`
6. `Phase 5 — Backoffice & Brain Reports`
7. `Phase 6 — Hardening & Private Beta`

## تعریف مشترک Done

کد production-oriented، تست مرتبط، migration در صورت نیاز، authorization/RLS، log/metric/trace فاقد content حساس، پیام خطای قابل‌فهم فارسی/انگلیسی، مستندات/ADR، acceptance evidence و review سبز. happy path بدون این شواهد Done نیست.

## فاز ۰ — foundation

| ID                                                      | عنوان                      | requirement               | وابستگی          | معیار پذیرش                                                        |
| ------------------------------------------------------- | -------------------------- | ------------------------- | ---------------- | ------------------------------------------------------------------ |
| [DOC-001](https://github.com/farhaddgm/Docoo/issues/1)  | sign-off خط مبنای محصول    | PRD، FR، NFR              | تصمیم مالک محصول | تصمیم `DEC-2026-09-24-BASELINE` در راهنمای مالک و readiness ثبت شد |
| [DOC-002](https://github.com/farhaddgm/Docoo/issues/2)  | تایید domain/state/data    | FR-*، NFR-MNT-003         | DOC-001          | مدل دامنه، state machine و dictionary تأیید و trace دارند          |
| [DOC-003](https://github.com/farhaddgm/Docoo/issues/3)  | تایید امنیت و threat model | NFR-SEC-*                 | DOC-001          | data flow، threat و کنترل‌های ردنشده ثبت شده‌اند                   |
| [ENG-001](https://github.com/farhaddgm/Docoo/issues/4)  | monorepo و lockfile        | NFR-MNT-001، NFR-PORT-001 | DOC-002          | install frozen و package graph در CI سبز است                       |
| [ENG-002](https://github.com/farhaddgm/Docoo/issues/5)  | config و secrets schema    | NFR-SEC-003، NFR-MNT-004  | ENG-001          | env ناقص قبل از boot fail می‌شود و secret commit نمی‌شود           |
| [ENG-003](https://github.com/farhaddgm/Docoo/issues/6)  | Compose توسعه              | NFR-PORT-002              | ENG-001          | postgres/redis/object store/temporal با healthcheck بالا می‌آیند   |
| [ENG-004](https://github.com/farhaddgm/Docoo/issues/7)  | CI baseline                | NFR-MNT-003               | ENG-001          | format/lint/typecheck/test/build روی PR اجرا می‌شود                |
| [ENG-005](https://github.com/farhaddgm/Docoo/issues/8)  | API health و readiness     | NFR-REL-001               | ENG-001، ENG-002 | `/v1/health/live` و `/v1/health/ready` contract دارند              |
| [ENG-006](https://github.com/farhaddgm/Docoo/issues/9)  | schema اولیه و migration   | NFR-MNT-003، NFR-SEC-002  | ENG-003          | migration از صفر، rollback policy و RLS fixture آماده است          |
| [ENG-007](https://github.com/farhaddgm/Docoo/issues/10) | telemetry پایه             | NFR-OBS-001..004          | ENG-003          | request/DB trace و metric بدون محتوای مسئله دیده می‌شود            |
| [ENG-008](https://github.com/farhaddgm/Docoo/issues/11) | seed و test-kit غیرحساس    | NFR-AIQ-002               | ENG-006          | fixture deterministic برای unit/integration موجود است              |
| [OPS-001](https://github.com/farhaddgm/Docoo/issues/12) | ساخت milestone/label/Issue | —                         | DOC-001          | trace matrix و dependency در GitHub قابل‌فیلتر است                 |
| [OPS-002](https://github.com/farhaddgm/Docoo/issues/13) | Notion plan و tracker      | —                         | DOC-001          | plan و taskهای phase 0 لینک commit/Issue دارند                     |

## فاز ۱ — control plane

| ID                                                       | عنوان                           | requirement               | وابستگی           | معیار پذیرش                                                |
| -------------------------------------------------------- | ------------------------------- | ------------------------- | ----------------- | ---------------------------------------------------------- |
| [AUTH-001](https://github.com/farhaddgm/Docoo/issues/14) | admin login و session           | FR-AUTH-001..004          | ENG-005، ENG-006  | login/logout/failure در E2E و audit ثبت می‌شوند            |
| [AUTH-002](https://github.com/farhaddgm/Docoo/issues/15) | password/reset/revoke           | FR-AUTH-002               | AUTH-001          | reset token یک‌بارمصرف و همهٔ نشست‌ها revoke می‌شوند       |
| [AUTH-003](https://github.com/farhaddgm/Docoo/issues/16) | authorization matrix            | FR-AUTH-005، NFR-SEC-002  | AUTH-001          | matrix نقش/permission و negative test سبز است              |
| [TEN-001](https://github.com/farhaddgm/Docoo/issues/17)  | workspace context و RLS harness | NFR-SEC-002               | ENG-006           | tenant A هیچ row/object/cache از B نمی‌بیند                |
| [TOP-001](https://github.com/farhaddgm/Docoo/issues/18)  | topic CRUD و version            | FR-TOP-001..006           | TEN-001           | archive/restore/delete dependency و audit کار می‌کند       |
| [PRJ-001](https://github.com/farhaddgm/Docoo/issues/19)  | project CRUD و state machine    | FR-PRJ-001..007           | TOP-001           | transitions رسمی، ۳۰روز recovery و timeline برقرار است     |
| [CFG-001](https://github.com/farhaddgm/Docoo/issues/20)  | versioned config resolution     | FR-CFG-001..006           | TEN-001           | effective value، source، diff و safe boundary ذخیره می‌شود |
| [AUD-001](https://github.com/farhaddgm/Docoo/issues/21)  | append-only audit explorer API  | FR-AUD-001..005           | AUTH-003، TEN-001 | before/after redaction و export فیلترپذیر است              |
| [UX-001](https://github.com/farhaddgm/Docoo/issues/22)   | RTL/LTR shell و tokens          | FR-LOC-001..004، NFR-UX-* | AUTH-001          | keyboard/focus/locale مسیر اصلی را پوشش می‌دهد             |
| [QA-001](https://github.com/farhaddgm/Docoo/issues/23)   | migration/RLS integration gate  | NFR-SEC-002، NFR-MNT-003  | TEN-001           | CI با PostgreSQL واقعی negative test را اجرا می‌کند        |
| [QA-002](https://github.com/farhaddgm/Docoo/issues/24)   | acceptance corpus v0            | acceptance plan           | ENG-008           | PDF اسکن‌شده، audio و expected evidence versioned است      |

## وضعیت فاز ۰ و ۱

همهٔ Issueهای فاز ۰ و ۱ با شواهد پذیرش بسته شده‌اند. شواهد هر story در PR مربوط و آزمون‌های زیر است:

| story                                                   | شواهد                                                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| AUTH-001..003                                           | `apps/api/test/auth.integration.test.ts`، `authorization-matrix.test.ts`، E2E `apps/web/e2e/main-path.spec.ts` |
| TEN-001، QA-001                                         | `packages/database/test/rls.integration.mjs` و آزمون‌های منفی tenant در هر suite integration                   |
| [TOP-001](https://github.com/farhaddgm/Docoo/issues/18) | `apps/api/test/topics.integration.test.ts`، `topics-lifecycle.integration.test.ts`                             |
| [PRJ-001](https://github.com/farhaddgm/Docoo/issues/19) | `packages/domain/src/project.test.ts`، `apps/api/test/projects.integration.test.ts`                            |
| [CFG-001](https://github.com/farhaddgm/Docoo/issues/20) | `apps/api/test/config.integration.test.ts`                                                                     |
| [AUD-001](https://github.com/farhaddgm/Docoo/issues/21) | `apps/api/test/audit.integration.test.ts`                                                                      |
| [UX-001](https://github.com/farhaddgm/Docoo/issues/22)  | `apps/web/app/i18n.test.ts`، E2E با axe                                                                        |
| [QA-002](https://github.com/farhaddgm/Docoo/issues/24)  | `qa/acceptance-corpus/v0` و `pnpm qa:corpus`                                                                   |

## epicهای فازهای بعد

خروجی spike این epicها در [شکست epicها به story](09-epic-breakdown.md) ثبت شده است.

- `ING-*` ([#25](https://github.com/farhaddgm/Docoo/issues/25)): upload مستقیم، quarantine/scan، parser sandbox، OCR/transcription، lineage و claim candidate؛ `FR-ING-*`, `NFR-SEC-005..006`.
- `KNO-*` ([#26](https://github.com/farhaddgm/Docoo/issues/26)): version/scope/provenance، Brain audit، conflict/override و hybrid retrieval؛ `FR-KNO-*`, `FR-BRN-*`.
- `WF-*` ([#27](https://github.com/farhaddgm/Docoo/issues/27)): Temporal workflows، pause/resume/replay، idempotency و human gate؛ `FR-WF-*`, `NFR-REL-002..003`.
- `AI-*` ([#28](https://github.com/farhaddgm/Docoo/issues/28)): قرارداد مشترک OpenAI/Gemini/Anthropic، capability snapshot، retry/health/cost؛ `FR-AI-*`.
- `SOL-*`, `DOC-*`, `EVA-*` ([#29](https://github.com/farhaddgm/Docoo/issues/29)): راه‌حل، document schema، renderer و correction loop؛ `FR-SOL-*`, `FR-DOC-*`, `FR-EVA-*`.
- `REP-*` ([#30](https://github.com/farhaddgm/Docoo/issues/30)): dashboard، Brain report، cost و audit explorer حرفه‌ای؛ `FR-BRN-*`, `FR-AUD-*`, `NFR-UX-*`.
- `SEC-*`, `SRE-*`, `REL-*` ([#31](https://github.com/farhaddgm/Docoo/issues/31)): SAST/SCA/container/DAST، load، backup/restore، SLO و private beta؛ `NFR-SEC-*`, `NFR-REL-*`, `NFR-PERF-*`.

## traceability rule

نام branch با ID شروع شود، commit یک ID داشته باشد، PR requirementها و test caseها را فهرست کند، و هر release evidence خود را به SHA، migration و eval dataset وصل کند. Issue بدون dependency و acceptance قابل شروع نیست.

## ۲۰ ایدهٔ پیشرفته بر پایهٔ بنچ‌مارک محصول (۲۰۲۶-۱۰-۰۸)

مرجع: [بنچ‌مارک ۹ محصول، امتیازدهی و شرح ۲۰ ایده](../01-product/08-advanced-ideas-benchmark.md)، تصمیم پژوهشی `DEC-2026-10-08-ADVANCED-IDEAS`. مقایسه از مستندات رسمی است؛ آزمون عملی رقبا یا سنجش بازده انجام نشده است. شش مورد منتخب کاربر (۱، ۳، ۵، ۷، ۸ و ۱۲) در PR152 پیاده‌سازی و آزمون شده‌اند؛ تکمیل ADV-009 در PR154 نیز تأیید شد. بنابراین هفت مورد تکمیل و سیزده مورد شامل ADV-013 نیمه‌تمام باز هستند. ترکیب اولویت اولیه: ۸ کار `P1`، ۸ کار `P2` و ۴ امکان‌سنجی. `P1` اولویت همین بسته پس از موانع فعلی انتشار است؛ milestone یا تعهد نسخهٔ اول را تغییر نمی‌دهد. چهار کار «بررسی» فقط خروجی امکان‌سنجی دارند.

مالک پیشنهادی: Product & Engineering؛ مسئول فردی هنگام شروع تعیین می‌شود. شناسه‌های `ADV-*` برش یا توسعهٔ epicهای موجودند؛ پیش از ایجاد Issue با `KNO-*`، `EVA-*` و سایر کارهای مرتبط تطبیق و ادغام شوند. شرط Done مشترک این سند برقرار است؛ requirementهای ستون ارتباط، ردیابی موضوع‌اند و نشان تصویب یا تکمیل قابلیت نیستند.

| ID      | کار                                         | صف    | ارتباط با نیازمندی                       | وابستگی                                                | معیار پذیرش برش نخست                                                                                                                                                                                        |
| ------- | ------------------------------------------- | ----- | ---------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADV-001 | ✅ گراف شاهد تا تصمیم                       | P1    | FR-KNO-002/010، FR-SOL-002، FR-DOC-005   | provenance و locator فعلی، نسخهٔ راه‌حل/سند، TEN-001   | ادعای تصمیم‌ساز به claim، quote، نسخهٔ منبع و بند سند متصل شود؛ مسیر قابل‌پیمایش و ادعای بی‌شاهد آشکار باشد؛ reference نامعتبر و دسترسی خارج scope رد شوند.                                                 |
| ADV-002 | ماتریس استخراج و مقایسهٔ شواهد              | P1    | FR-RES-004/005، FR-KNO-010               | ADV-001، ingestion و ممیزی فعلی                        | ستون‌های نسخه‌دار، مقدار و واحد و locator هر سلول حفظ شوند؛ دادهٔ غایب با صفر فرق کند؛ دو مطالعه با زمینهٔ متفاوت قابل‌مقایسه و خروجی با استخراج انسانی سنجیده شود.                                         |
| ADV-003 | ✅ پژوهش تطبیقی با تشخیص خلأ                | P1    | FR-RES-001/005، FR-EVA-002               | ADV-001/002/007، research plan فعلی                    | روی corpus داخلی approved، پوشش سؤال‌ها و query تکمیلی با دلیل ثبت شود؛ سقف دور/بودجه و علت توقف صریح باشند؛ کافی‌نبودن شاهد پنهان نشود. اجرای وب نیازمند اتصال مستقل آداپتر موجود است.                     |
| ADV-004 | حذف تکرار معنایی و سنجش استقلال منابع       | P2    | FR-RES-003، FR-KNO-005                   | ADV-001/002/007، dedupe دقیق فعلی                      | خوشهٔ paraphrase و رابطهٔ بازنشر با شاهد پیشنهاد شود؛ citationها حذف نشوند؛ استقلال نامعلوم صریح و merge قابل‌بازبینی باشد؛ precision/ادغام اشتباه با corpus انسانی سنجیده شود.                             |
| ADV-005 | ✅ پروندهٔ خودکار تعارض و شواهد مخالف       | P1    | FR-KNO-009، FR-BRN-005                   | ADV-001/002، API تعارض انسانی فعلی                     | Brain نامزد تعارض را با دو شاهد و تفاوت روش/زمان/زمینه پیشنهاد کند؛ مدیر آن را تأیید/رد/شرط‌گذاری کند؛ ترجیح claim خودکار نشود؛ precision و recall اندازه‌گیری شوند.                                        |
| ADV-006 | پایش تازگی و اثر تغییر شواهد                | P2    | FR-KNO-007، FR-DOC-006، FR-BRN-005       | ADV-001، version/expiry/re-audit فعلی                  | تغییر/انقضای داخلی فهرست بندها و تصمیم‌های تحت‌تأثیر و علت را به صف بازبینی ببرد؛ سند مصوب خودکار تغییر نکند؛ هشدار تکراری dedupe و وابستگی‌ها با fixture بررسی شوند.                                       |
| ADV-007 | ✅ جست‌وجوی ترکیبی فارسی و انگلیسی          | P1    | FR-KNO-006، FR-RES-001، NFR-SEC-002      | epic KNO-*، TEN-001، ENG-008، سیاست embedding          | FTS و vector/rerank با normalization فارسی و سیاست زبان منبع ترکیب شوند؛ روی مجموعهٔ pin‌شده Recall@10/nDCG@10 با FTS مقایسه و زبان‌ها جدا گزارش شوند؛ فیلتر مجوز پیش از بازیابی و بازاعتبارسنجی حفظ شوند.  |
| ADV-008 | ✅ سؤال بعدی بر اساس ارزش اطلاعات           | P2    | FR-ANL-001..006                          | analysis فعلی، معیارهای نسخه‌دار راه‌حل                | هر سؤال به فرض/معیار و علت تقدم وصل شود؛ حداقل ۳۰/حداکثر ۳۰۰ سؤال و batch حداکثر ۴۰ حفظ شوند؛ پوشش و زمان پاسخ با ترتیب ثابت مقایسه و heuristic بودن امتیاز روشن باشد.                                      |
| ADV-009 | ✅ تحلیل حساسیت انتخاب راه‌حل در main       | P1    | FR-SOL-003..005                          | موتور calculateSolutionScore و scorecard نسخه‌دار فعلی | پیش‌نمایش وزن معتبر، آستانهٔ تغییر برنده، tie و دامنهٔ پایداری از محاسبهٔ قطعی نمایش داده شوند؛ selection/score رسمی تغییر نکنند؛ مرز تغییر رتبه با fixture عددی سنجیده شود.                                |
| ADV-010 | امکان‌سنجی شبیه‌ساز کمی کسب‌وکار            | بررسی | توسعهٔ پیشنهادی FR-SOL-002/004           | ADV-002/009، یک مسئله و dataset مجاز                   | یک مدل محدود با فرمول/واحد/فرض صریح، سه سناریو و baseline دستی ساخته شود؛ خطای داده و شرط اعتبار مدل بررسی و تصمیم ادامه/توقف ثبت شود؛ بدون دادهٔ موجه احتمال موفقیت تولید نشود.                            |
| ADV-011 | نقد مستقل و پیش‌مرگ راه‌حل                  | P2    | FR-EVA-002/003، FR-SOL-002               | ADV-001/005/013، evaluator فعلی                        | pass مستقل evaluator سناریوی شکست، علت، شاهد، نشانه و کنترل بدهد؛ نقش هفتم یا تغییر ترتیب اصلی نسازد؛ نقص مفید جدید در مقایسه با ارزیابی فعلی و هزینه سنجیده شود.                                           |
| ADV-012 | ✅ کفایت شواهد و اعلام عدم قطعیت            | P1    | FR-KNO-005، FR-EVA-002                   | ADV-001/002/005، scoreهای Brain فعلی                   | پوشش/تازگی/استقلال معلوم یا نامعلوم/تعارض/applicability جدا دیده شوند؛ «شواهد ناکافی» خروجی معتبر باشد؛ نبود برچسب استقلال تا تکمیل ADV-004 صریح بماند؛ خطای پذیرش/امتناع با برچسب انسانی سنجیده شود.       |
| ADV-013 | آزمایشگاه مقایسهٔ کیفیت ایجنت‌ها            | P1    | راهبرد eval، FR-EVA-001/002، FR-AI-007   | ENG-008، evaluator و snapshotهای فعلی                  | dataset و مدل/prompt/retrieval pin شوند؛ دو نسخه به‌صورت جفتی در کیفیت، هزینه و latency مقایسه و FA/EN جدا گزارش شوند؛ خطا به case پالایش‌شده تبدیل شود؛ default خودکار تغییر نکند.                         |
| ADV-014 | ترمیم انتخابی بخش‌های وابستهٔ سند           | P2    | FR-DOC-005/006، FR-WF-009                | ADV-001/013، document version و diff فعلی              | تغییر یک فرض فقط بخش‌های وابسته را در نسخهٔ draft جدید بازتولید کند؛ preview/diff، حفظ hash بند نامرتبط و invalidation ارزیابی/approval برقرار باشد؛ با بازتولید کامل مقایسه شود.                           |
| ADV-015 | یادگیری سازمانی از اصلاحات مدیر             | P2    | FR-CFG-003/004، FR-BRN-005               | ADV-013، اصلاحات و charter/config نسخه‌دار             | الگوی اصلاح به پیشنهاد rule با شاهد، scope و نسخه تبدیل شود؛ پذیرش/رد انسانی و isolation حفظ شوند؛ تکرار خطا پس از پذیرش سنجیده شود؛ بدون fine-tune یا تغییر خودکار policy.                                 |
| ADV-016 | ثبت پایلوت و نتیجهٔ واقعی تصمیم             | P2    | توسعهٔ پیشنهادی FR-SOL-002، FR-BRN-003   | ADV-001/009، selection نسخه‌دار                        | تصمیم به فرضیه، baseline، KPI، بازه و شرط ادامه/توقف متصل شود؛ پیش‌بینی/مشاهده جدا و تغییر KPI نسخه‌دار باشد؛ اختلاف آن‌ها گزارش شود؛ اثر علّی بدون طرح آزمایش ادعا نشود.                                   |
| ADV-017 | امکان‌سنجی شاخه‌های فرضی پروژه              | بررسی | توسعهٔ پیشنهادی FR-PRJ-_، FR-CFG-_       | ADV-009/013، snapshot و policy scope                   | prototype دو سناریو از snapshot یکسان با lineage روشن ساخته شود؛ فایده در برابر sensitivity ساده و هزینهٔ permission/version مقایسه و تصمیم ادامه/ادغام/توقف ثبت شود.                                       |
| ADV-018 | امکان‌سنجی اتصال دانش زنده                  | بررسی | FR-KNO-002/006، NFR-SEC-002، adapters    | ingestion و ممیزی فعلی، TEN-001، انتخاب یک منبع        | طرح یک connector read-only با provenance، ACL، حذف/revoke، cache invalidation و latency مجوز بررسی شود؛ prototype محدود و هزینهٔ نگهداری ثبت و تصمیم ادامه/توقف داده شود.                                   |
| ADV-019 | امکان‌سنجی انتخاب مدل با قید کیفیت و بودجه  | بررسی | FR-AI-002/007/008، تغییر دامنهٔ پیشنهادی | ADV-013، AI-USAGE-001، قیمت و policy مصوب              | جدول کیفیت/هزینه/latency مدل‌های مجاز و طراحی reserve/reconcile بودجه ارائه شود؛ نبود قیمت صریح باشد؛ تماس زنده فقط با تنظیم مجاز؛ هیچ routing/fallback تازه‌ای خودکار فعال نشود؛ تصمیم ادامه/توقف ثبت شود. |
| ADV-020 | پروندهٔ مدیریتی تصمیم با جزئیات قابل‌پیگیری | P2    | FR-SOL-004/005، FR-DOC-005               | ADV-001/009، نسخهٔ مصوب و scorecard فعلی               | نمای یک‌صفحه‌ای انتخاب/دلایل/گزینه‌های ردشده/فرض حساس/اقدام بعد به نسخه‌های دقیق لینک شود؛ دادهٔ غایب روشن بماند؛ برش قطعی بدون AI ممکن و زمان فهم تصمیم سنجیده شود.                                        |

ترتیب پیشنهادی: ADV-013 و ADV-001 برای پایه؛ ADV-002/007 سپس ADV-005/012 برای شواهد؛ ADV-003 برای پژوهش و ADV-009 مستقل برای تصمیم؛ سپس کارهای P2 طبق وابستگی. طرح corpus سی‌پرونده‌ای، سنجه‌های هر ایده، امتیازها و شرط ادامه/توقف در سند بنچ‌مارک آمده‌اند. ردیف‌های ✅ پیاده‌سازی شده‌اند؛ ردیف‌های دیگر پیشنهادی و باز هستند. وضعیت اجرا در بخش زیر ثبت شده است. Issue راه‌دور یا انتشار Notion در این کار انجام نشده است.

شش ردیف منتخب در نسخهٔ ۰٫۲۵ و migration 0041 با ساختار main سازگار شدند؛ عدد تاریخی ۱۴ ایدهٔ باز مربوط به آن زمان است. تطبیق PR154 در بخش بعد، شمار فعلی را به هفت تکمیل و سیزده باز اصلاح می‌کند. جزئیات اجرا و محدودیت‌های بنچ‌مارک در سند بالا آمده است.

## تطبیق سایر گفتگوها و پیشرفت ADV-013 (۲۰۲۶-۱۰-۱۶)

مبنای این برش آخرین main مشاهده‌شده با SHA `686ff0f09c60357077f290190794a593d574bdc7` است، نه شاخهٔ محلی قدیمی. هفت ایدهٔ تکمیل‌شدهٔ [PR152](https://github.com/farhaddgm/Docoo/pull/152) و [PR154](https://github.com/farhaddgm/Docoo/pull/154)، بازطراحی رابط [PR184](https://github.com/farhaddgm/Docoo/pull/184) و قابلیت‌های موجود بازپیاده‌سازی نشدند. کار هم‌زمانی providerها در [PR197](https://github.com/farhaddgm/Docoo/pull/197) باز است؛ این برش وارد آن scope یا تغییر نام پروژه نمی‌شود.

هسته و corpus سی‌پرونده‌ای آزمایش جفتی، runner با hash snapshot، ذخیره‌سازی پاسخ ترتیبی و بازبینی انسانی، migrationهای افزایشی 0044/0045 و API فهرست/بازبینی/مقایسه با session و RLS فعلی منتقل شدند. صفحهٔ FA/EN در پوستهٔ جدید پروژه قرار گرفت؛ CSS عمومی سایت بازنویسی نشد. tokenهای موجود و ProjectAccessBoundary حفظ شده‌اند. مستندات [ارزیابی](../03-ai/05-evaluation-and-quality.md#۱۰-آزمایشگاه-مقایسهٔ-جفتی--adv-013) و [API](../04-architecture/03-api-contracts.md#۲۰-آزمایشگاه-مقایسهٔ-ایجنت--adv-013) دامنه و محدودیت را شرح می‌دهند.

شواهد این برش روی همین مبنا: domain برابر ۱۱۵، contracts برابر ۲۰، application برابر ۳۰ و web برابر ۹۶ تست واحد پاس شدند؛ build API و وابستگی‌ها و typecheck وب پاس شدند. gate واقعی PostgreSQL/HTTP با ۶۰ پاسخ پایدار و cookie/guard/RLS، رد VIEW و خارج scope، لغو grant، immutability و idempotency شامل درخواست هم‌زمان پاس شد. چهار تست مرورگر با API شبیه‌سازی‌شده در کانتینر بدون شبکه پاس شدند؛ fixtureهای کیفیت مصنوعی‌اند. پایگاه و login تصادفی تست پاک شدند؛ هیچ provider زنده یا API key و هیچ دادهٔ عملیاتی استفاده/تغییر نکرد.

بررسی کامل `pnpm verify` با Node 24 روی همین checkout پاس شد: formatting، lint، typecheck، تست و build نهایی همهٔ بسته‌های workspace، از جمله Next 16.3.8 و route تازه. integrationهای اختیاری وابسته به محیط در این فرمان skip می‌شوند؛ gate واقعی API/PostgreSQL بالا جداگانه و بدون skip اجرا شد. اعتبارسنجی ۷۴ سند manifest و `git diff --check` نیز سبز است.

مرحلهٔ بعد: snapshot نسخهٔ نقش و catalog و prompt/schema واقعی هر پنج نقش و adapter مبتنی بر ProviderRuntime اضافه شد؛ حالت `stage-structured-output` است، نه tool-loop یا workflow کامل. مهاجرت 0046، intent پیش از تماس و receipt مستقل متصل به invocation ledger را ثبت می‌کند؛ pending/unknown هرگز مجوز retry نیست. gate واقعی PostgreSQL با ۶۰ تماس جفتی مصنوعی و دو probe قطع پردازش/رقابت، بازخوانی رسید، جلوگیری از تماس تکراری، scope رسید، لغو دسترسی پیش از تماس و هزینهٔ واقعی null را تأیید کرد. editor دسترسی مستقیم به secret پیدا نکرده و کار هم‌زمانی عمومی PR197 بازپیاده‌سازی نشده است. ۱۲ تست تازهٔ adapter پاس شدند؛ کل orchestration برابر ۱۲۱ است. scripts تست contracts/application دیگر نسخه‌های dist را دوباره اجرا نمی‌کنند؛ شمار یکتای منبع به‌ترتیب ۱۲ و ۱۵ است.

مانع CI نسخهٔ نخست PR198 محلی بازتولید شد: `node:crypto` از export عمومی domain وارد bundle Temporal می‌شد. utility سروری به `@docoo/domain/evaluation` جدا شد و تست ساخت bundle واقعی worker بدون ignore/غیرفعال‌کردن کنترل SDK پاس شد. چهار تست UI آزمایشگاه در هر دو Firefox و WebKit اجرای قبلی CI سبز بودند؛ gate کل CI تا اجرای commit اصلاح‌شده هنوز تأیید نشده است.

پس از این اصلاح، `pnpm verify` نهایی با Node 24 برای همهٔ بسته‌ها پاس شد و تست bundle واقعی worker نیز در آن اجرا شد. gate واقعی API/PostgreSQL یک‌بار دیگر روی build نهایی و بدون skip پاس شد؛ منابع موقت پاک شدند. این gate به job کیفیت CI اضافه شد و اجرای دوبارهٔ یکسان `qa:trace` حذف شد؛ کنترل ردیابی همچنان یک‌بار اجرا می‌شود. هیچ deploy، migration پایگاه عملیاتی یا تماس provider زنده انجام نشد.

اتصال به worker فعلی اکنون انجام شد: workflow هر پرونده را جدا اجرا می‌کند؛ result یا receipt قطعی را بدون تماس تکراری بازیابی و pending/unknown را متوقف می‌کند. مهاجرت 0047 وضعیت `interrupted` و توقف یک‌طرفهٔ فراداده پس از revoke را دارد، بدون بازگرداندن محتوا یا مجوز. switchهای آزمایشگاه/تماس زنده پیش‌فرض خاموش‌اند. gate واقعی Temporal با کانتینر اختصاصی، پورت loopback و صف تصادفی پاس شد: worker اول پس از commit و گم‌شدن acknowledgement متوقف شد؛ worker جایگزین همان اجرا را با دقیقاً ۶۰ تماس ادامه داد، ارسال دوبارهٔ workflow هنگام اجرا/پس از پایان run جدید نساخت و replay واقعی تاریخچه نیز سبز بود. PostgreSQL، role و کانتینر موقت پاک شدند؛ سرویس‌های فعال تغییر نکردند. quality و Firefox روی commit قبلی a5a1e6c در CI38894506002 موفق ثبت شدند؛ نتیجهٔ کد تازه فقط با gateهای همین commit سنجیده می‌شود.

برش worker با `pnpm verify` کامل Node 24، build همهٔ بسته‌ها و اعتبارسنجی ۷۴ سند پاس شد: قرارداد ۱۳، application برابر ۱۶، orchestration برابر ۱۲۱، config برابر ۵، web برابر ۹۶ و bundle واقعی worker برابر ۱ تست. integrationهای اختیاری verify جدا از gate واقعی PostgreSQL/Temporal بالا هستند. اجرای راه‌دور CI38894506002 روی a5a1e6c نیز در نهایت برای quality، Firefox و WebKit همگی موفق شد؛ این شاهد جای CI مربوط به commit تازه را نمی‌گیرد.

ADV-013 هنوز Done نیست: صف start و فرم/API آغاز اضافه شده‌اند، اما اجرای E2E همین صفحه تا API و worker، سقف هزینهٔ قطعی، تعیین تکلیف/اقدام انسانی برای تماس واقعاً نامعلوم، کیفیت/هزینه و برچسب انسانی/judge-human واقعی و پالایش شکست واقعی باقی‌اند. حالت کامل ابزار/گردش‌کار با اجرای مرحلهٔ خودبسنده یکی نیست. این برش ادعای تکمیل همهٔ ۲۰ ایده یا استقرار ندارد.

برش بعدی (۲۰۲۶-۱۰-۱۶): migration `0053` و outbox dispatcher شروع Temporal را پس از restart/outage دوباره تحویل می‌دهد؛ API با کلید idempotency و صفحهٔ FA/EN فرم انتخاب نسخه/model را به capture سمت سرور وصل می‌کند. هر دو switch پیش‌فرض خاموش‌اند؛ UI هشدار ۶۰ درخواست را نشان می‌دهد. cost ceiling دلاری قطعی عمداً ادعا نمی‌شود چون منبع فعلی هزینه تخمینی است. migration و API gate واقعی با پایگاه تصادفی، enqueue/retry/lease و رد start در حالت خاموش پاس شدند؛ شش تست مرورگر شامل retry فارسی/انگلیسی، typecheck بسته‌های API/database/web و `pnpm verify` کامل Node 24 نیز پاس شدند. CI تازه هنوز باید روی commit این برش اجرا شود. هیچ provider زنده یا API key استفاده نشده است.
