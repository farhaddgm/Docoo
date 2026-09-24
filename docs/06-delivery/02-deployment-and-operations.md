---
doc_id: DOCOO-DEPLOYMENT-OPERATIONS
title: استقرار، انتقال‌پذیری و عملیات
status: proposed
version: 1.0.0
owner: Platform & Operations
last_updated: 2026-09-24
notion_sync: true
---

# استقرار، انتقال‌پذیری و عملیات

## ۱. artifactهای استقرار

- image امضاشدهٔ web/api؛
- image agent worker؛
- image ingestion worker؛
- image document worker؛
- migration image/command؛
- Docker Compose base + production override؛
- environment schema؛
- SBOM و provenance؛
- runbook backup/restore/upgrade.

## ۲. محیط‌ها

`development`, `test`, `staging`, `production` با حساب provider، bucket، database، key و domain مستقل. config مشترک از schema، نه copy دستی env.

## ۳. Compose production تک‌سرور

- کد داخل image immutable؛
- no source bind mount؛
- restart policy؛
- healthcheck و dependency readiness؛
- resource limits؛
- volumeهای مشخص برای data services؛
- TLS در reverse proxy؛
- backup خارج host؛
- firewall فقط 80/443 و management محدود؛
- outbound egress کنترل‌شده.

## ۴. تنظیمات و secrets

Configuration غیرحساس از env/config file validated. secret از secret manager یا Docker secrets. startup در secret ناقص fail-fast. config dump تشخیصی values حساس را redacted می‌کند.

## ۵. migration و deploy

1. preflight backup و compatibility؛
2. pull image by digest؛
3. expand migration؛
4. deploy API/worker سازگار؛
5. backfill monitored؛
6. smoke/E2E؛
7. contract cleanup در release بعدی؛
8. ثبت deployment audit.

Workflow code change باید Temporal versioning/replay policy را رعایت کند.

## ۶. rollback

Rollback application تنها اگر schema backward-compatible است. migration destructive در همان release ممنوع. اگر output schema تغییر کرده، reader قدیم/جدید دورهٔ گذار دارند.

## ۷. backup

- PITR PostgreSQL با WAL؛
- full روزانه؛
- object replication/versioning؛
- backup config/manifest؛
- secret recovery procedure جدا؛
- retention چندلایه؛
- checksum و restore test.

## ۸. restore runbook سطح بالا

1. incident و target time تأیید؛
2. محیط isolate؛
3. restore DB؛
4. restore object manifest؛
5. اعمال suppression حذف‌ها؛
6. integrity/lineage check؛
7. rotate credential مشکوک؛
8. provider outbound ابتدا خاموش؛
9. acceptance smoke؛
10. controlled cutover و audit.

## ۹. انتقال سرور

بستهٔ مهاجرت شامل image digestها، Compose/config schema، DB dump/PITR point، object manifest، encrypted secret migration procedure، DNS/TLS plan و verification report است. hostname و IP در دادهٔ دامنه ذخیره نمی‌شوند.

## ۱۰. ظرفیت پایه

حداقل production پیشنهادی پس از benchmark تعیین می‌شود، نه حدس نهایی. برای شروع staging/full-stack: CPU چند‌هسته‌ای، RAM کافی برای PostgreSQL/Temporal/renderer و object storage بیرونی ترجیح دارد. OCR/renderer worker باید قابل‌انتقال به host جدا باشد.

## ۱۱. runbookهای لازم پیش از launch

- provider unavailable؛
- queue stuck؛
- workflow nondeterminism؛
- database saturation؛
- object storage unavailable؛
- failed export؛
- malware detection؛
- secret exposure/rotation؛
- cross-tenant suspicion؛
- backup failure/restore؛
- disk pressure؛
- certificate expiration.

## ۱۲. patch و dependency

هفته‌ای dependency scan، ماهانه maintenance window و emergency process برای critical CVE. base image حداقل، non-root و read-only filesystem در حد امکان.
