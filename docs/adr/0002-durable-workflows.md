---
doc_id: DOCOO-ADR-0002
title: ADR-0002 اجرای بادوام با Temporal
status: accepted
version: 1.0.0
owner: Architecture
last_updated: 2026-09-24
notion_sync: true
---

# ADR-0002: اجرای بادوام با Temporal

## زمینه

workflowها ساعت/روز منتظر انسان یا provider می‌مانند، retry و resume دارند و نباید با restart گم شوند. queue ساده نیازمند ساخت دستی state machine، timer و dedupe گسترده است.

## تصمیم

Temporal self-hosted engine پیش‌فرض workflow است. business state در دامنه/PostgreSQL باقی می‌ماند و Temporal تاریخچهٔ orchestration را نگه می‌دارد.

## پیامد مثبت

durable timer، signal، retry، child workflow، replay و visibility.

## پیامد منفی

سرویس عملیاتی اضافه، قواعد deterministic code و migration workflow.

## گزینه‌های ردشده

Cron + DB polling و BullMQ-only به‌دلیل پیچیدگی pause/resume/replay در مقیاس دامنه.
