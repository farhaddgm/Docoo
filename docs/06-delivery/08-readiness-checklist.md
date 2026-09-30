---
doc_id: DOCOO-READINESS-CHECKLIST
title: checklist آمادگی شروع توسعه Docoo
status: active
version: 1.0.0
owner: Product & Engineering
last_updated: 2026-09-24
notion_sync: true
---

# checklist آمادگی شروع توسعه

`READY` یعنی شواهد کافی موجود است، `PARTIAL` یعنی پیاده‌سازی اولیه هست ولی هنوز اثبات نشده، `OWNER` یعنی تصمیم/امضای مالک محصول لازم است و `BLOCKED` یعنی دسترسی یا ابزار بیرونی مانع ادامه است.

| مورد                             | وضعیت                  | مدرک                                                                                                                                                                                   |
| -------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| repository خصوصی و branch کاری   | READY                  | GitHub `farhaddgm/Docoo`                                                                                                                                                               |
| manifest و sync اولیه Notion     | PARTIAL                | موتور sync مستقیم (`scripts/notion/`) و workflow آماده و تست‌شده‌اند؛ اجرای واقعی و به‌روزشدن state به secret `NOTION_TOKEN` و merge در `main` وابسته است                              |
| PRD/FR/NFR                       | READY                  | تأیید شش‌گانهٔ مالک در گفت‌وگوی ۲۰۲۶-۰۹-۲۴؛ بندهای ۱، ۲ و ۶ [راهنمای مالک](07-owner-action-guide.md)                                                                                   |
| domain/state/data dictionary     | READY                  | تأیید شش‌گانهٔ مالک در گفت‌وگوی ۲۰۲۶-۰۹-۲۴؛ بند ۳ [راهنمای مالک](07-owner-action-guide.md)                                                                                             |
| agent charter و knowledge policy | READY                  | تأیید شش‌گانهٔ مالک در گفت‌وگوی ۲۰۲۶-۰۹-۲۴؛ بند ۴ [راهنمای مالک](07-owner-action-guide.md)                                                                                             |
| architecture/security/acceptance | READY                  | تأیید شش‌گانهٔ مالک در گفت‌وگوی ۲۰۲۶-۰۹-۲۴؛ بندهای ۵ و ۶ [راهنمای مالک](07-owner-action-guide.md)                                                                                      |
| toolchain و session ADR          | READY                  | `adr/0006`, `adr/0007`; نیازمندی Node 24 و pnpm 12 ثبت شده                                                                                                                             |
| monorepo و lockfile              | READY                  | نصب `pnpm install --frozen-lockfile` با Node 24 و pnpm 12.6.0 موفق شد                                                                                                                  |
| API/web/worker scaffold          | PARTIAL                | API health، login/session/logout، guard مجوز workspace و list/create موضوع پیاده‌سازی شده؛ web ورود فارسی/انگلیسی دارد؛ reset/revoke، CRUD کامل موضوع و workerهای واقعی هنوز باز هستند |
| migration اولیه + RLS            | READY                  | migration روی PostgreSQL 18 اجرا شد؛ تست transaction نشان داد tenant A یک workspace می‌بیند و workspace متعلق به B صفر ردیف                                                            |
| local Compose                    | READY                  | PostgreSQL، Redis، SeaweedFS S3، Temporal و Temporal UI همگی healthy و پورت‌های توسعه فقط به `127.0.0.1` متصل‌اند؛ profile مشاهده‌پذیری فقط از نظر config بررسی شده                    |
| lint/typecheck/test/build        | READY                  | `pnpm verify` و `pnpm docs:validate` در container موقت Node 24/pnpm 12 سبز شدند                                                                                                        |
| GitHub Issues/Milestones         | READY                  | [GitHub Issueها](https://github.com/farhaddgm/Docoo/issues): ۷ milestone، ۹ label و ۳۱ Issue برای همهٔ تسک‌های فاز ۰/۱ و epicهای بعدی با dependency و acceptance ثبت شدند              |
| provider/OCR/search credentials  | BLOCKED تا integration | `.env.example`                                                                                                                                                                         |
| CodeQL و حفاظت شاخه              | DEFERRED               | مالک موقتاً پذیرفت توسعه متوقف نشود؛ CodeQL در مخزن خصوصی تا فراهم‌شدن Code Security اجرا نمی‌شود؛ `pnpm audit` و Trivy فعال‌اند؛ بازبینی امنیتی کامل بعداً انجام می‌شود               |

## gate شروع توسعه

تأیید تصمیم‌های مالک برای شروع توسعهٔ control plane انجام شده است. `READY` در چهار ردیف بالا به تأیید شش تصمیم خط مبنا اشاره دارد و به معنی پایان بازبینی تک‌تک اسناد جزئی نیست. تأیید از همین گفت‌وگوست؛ در Notion علامت جداگانه، commit SHA یا sync تازه‌ای ثبت نشده است. Issue/Milestoneهای backlog در GitHub ساخته شدند. ردیف‌های `PARTIAL` باید با اجرای واقعی بسته شوند. provider key، corpus کامل و wireframe در story مربوط لازم می‌شوند و مانع آماده‌سازی زیرساخت نیستند.
