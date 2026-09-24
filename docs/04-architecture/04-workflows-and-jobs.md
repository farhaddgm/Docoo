---
doc_id: DOCOO-WORKFLOWS-JOBS
title: طراحی گردش‌کارهای بادوام و کارهای پس‌زمینه
status: approved-baseline
version: 1.0.1
owner: Platform Architecture
last_updated: 2026-09-24
notion_sync: true
---

# طراحی گردش‌کارهای بادوام و کارهای پس‌زمینه

## ۱. ProjectWorkflow

Workflow parent مراحل را به ترتیب اجرا می‌کند و signalهای pause، resume، cancel، configChanged، humanTaskResolved و adminOverride را می‌پذیرد.

Pseudo-flow:

```text
for stage in [analysis, research, ideation, documentation, evaluation]:
  wait until project active
  resolve config snapshot
  run StageWorkflow(stage)
  if rejected: route correction
  if manual gate: create HumanTask and wait
complete only when final selection documents approved
```

## ۲. AnalysisWorkflow

loop تا approval:

1. resolve context؛
2. تولید batch با رعایت ۳۰/۳۰۰ و ۴۰ در دور؛
3. human task پاسخ؛
4. ingest attachments پاسخ؛
5. update coverage/contradiction؛
6. اگر sufficient، تولید definition؛
7. human approval؛ رد به loop.

Questionهای `later` قبل از final approval دوباره بررسی و unresolved صریح می‌شوند.

## ۳. ResearchWorkflow

1. plan؛
2. search/fetch fan-out با rate limit؛
3. normalize/dedupe؛
4. create candidates؛
5. BrainAudit child workflow؛
6. wait required audit؛
7. synthesize approved/effective set؛
8. stage validation.

Fan-out bounded و deterministic ID برای source دارد.

## ۴. BrainAuditWorkflow

برای knowledge version:

- document audit؛
- claim extraction/selection؛
- parallel claim review bounded؛
- conflict detection؛
- aggregate score؛
- persist review؛
- signal waiting stage.

تغییر content workflow audit جدید می‌سازد؛ audit قبلی ویرایش نمی‌شود.

## ۵. IdeationWorkflow

به‌جای N call مستقل بی‌زمینه، ابتدا solution space سپس generation bounded انجام می‌شود. diversity check می‌تواند duplicate را برای یک regeneration هدفمند بازگرداند. تعداد کل از policy ۲..۲۰.

## ۶. DocumentationWorkflow

برای هر solution:

1. outline؛
2. section generation؛
3. assemble structured blocks؛
4. citation resolve؛
5. length validate/targeted revise؛
6. chart/table build؛
7. save draft؛
8. render requested artifacts.

Revision برای length باید section-targeted و محدود باشد تا drift محتوا ایجاد نکند.

## ۷. EvaluationWorkflow

validatorهای قطعی قبل از model evaluation اجرا می‌شوند. سپس evaluator structured report می‌سازد. fail route یک correction workflow با feedback manifest ایجاد می‌کند. attempt ده به human task تصمیم تبدیل می‌شود.

## ۸. ProviderInvocation activity

Activity timeoutها:

- start-to-close بر اساس model policy؛
- heartbeat برای stream/long call؛
- retry policy فقط transient؛
- external request ID ثبت؛
- cancellation best effort؛
- response object ابتدا quarantine سپس validate.

Schedule مصوب ۱۰ retry در application policy پیاده می‌شود، نه retry بی‌نهایت SDK.

## ۹. کارهای دوره‌ای

- provider model/health refresh؛
- knowledge expiry و re-audit queue؛
- scheduled purge؛
- orphan multipart upload cleanup؛
- document artifact integrity sampling؛
- usage/cost reconciliation؛
- stuck workflow detector؛
- backup verification status import.

## ۱۰. idempotency

کلیدها:

- workflow: `project:{id}:workflow:{version}`
- stage: `workflow:{id}:stage:{type}:{sequence}`
- invocation: `attempt:{id}:call:{ordinal}:{requestHash}`
- export: `documentVersion:{id}:format:{format}:renderer:{version}`
- source: `workspace:{id}:sha256:{hash}` با تصمیم dedupe scope.

Side effect result پیش از retry lookup می‌شود.

## ۱۱. deterministic workflow rule

Workflow code نباید مستقیم زمان جاری، random، network یا DB query غیرثبت‌شده بگیرد. همه از activity یا deterministic API. config change با signal و version marker وارد history می‌شود.

## ۱۲. queue و fairness

Task queue جدا و concurrency per workspace/provider. Scheduler از یک پروژه جلوگیری می‌کند تمام ظرفیت را بگیرد. priority: human-resumed و finalization بالاتر از autonomous bulk، اما starvation ممنوع.
