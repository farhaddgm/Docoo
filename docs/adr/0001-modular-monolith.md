---
doc_id: DOCOO-ADR-0001
title: ADR-0001 انتخاب modular monolith
status: accepted
version: 1.0.0
owner: Architecture
last_updated: 2026-09-24
notion_sync: true
---

# ADR-0001: modular monolith با workerهای مستقل

## زمینه

Docoo دامنهٔ بزرگ و workflow طولانی دارد، اما تیم و الگوی بار هنوز تثبیت نشده است. microservice زودهنگام هزینهٔ transaction، deployment و observability را زیاد می‌کند.

## تصمیم

Control plane یک modular monolith با bounded module و PostgreSQL مشترکِ schema-governed است. workerهای agent، ingest و document deployable مستقل‌اند. ارتباط cross-module از application contract/outbox می‌گذرد.

## پیامد مثبت

سرعت توسعه، transaction ساده، migration کنترل‌شده و انتقال آسان. استخراج سرویس از boundary مشخص ممکن است.

## پیامد منفی

نیاز به discipline برای جلوگیری از coupling جدول و deploy control plane مشترک.

## trigger بازبینی

بار یا cadence تیمی که استقلال deploy/scaling یک ماژول را به‌طور مستند ضروری کند.
