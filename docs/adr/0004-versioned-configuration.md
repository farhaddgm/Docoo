---
doc_id: DOCOO-ADR-0004
title: ADR-0004 تنظیمات نسخه‌بندی‌شده و اعمال در مرز امن
status: accepted
version: 1.0.0
owner: Architecture
last_updated: 2026-09-24
notion_sync: true
---

# ADR-0004: تنظیمات نسخه‌بندی‌شده و اعمال در مرز امن

## زمینه

ادمین می‌خواهد تغییر تنظیمات فوراً بر ادامهٔ همان مسئله اثر کند، اما mutation call جاری replay و audit را می‌شکند.

## تصمیم

هر تغییر config نسخهٔ جدید می‌سازد. call جاری immutable است؛ orchestrator در نخستین مرز امن بعدی config را resolve و snapshot جدید ثبت می‌کند.

## precedence

system → workspace → topic priority → project → agent-in-project → run.

## پیامد

اثر سریع، تکرارپذیری و توضیح effective value هم‌زمان حفظ می‌شوند.
