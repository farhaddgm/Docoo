---
doc_id: DOCOO-IMPLEMENTATION-BACKLOG
title: backlog اجرایی و ردیابی Docoo
status: active
version: 1.1.0
owner: Product & Engineering
last_updated: 2026-10-02
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
