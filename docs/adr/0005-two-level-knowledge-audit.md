---
doc_id: DOCOO-ADR-0005
title: ADR-0005 ممیزی دو سطحی دانش
status: accepted
version: 1.0.0
owner: AI Governance
last_updated: 2026-09-24
notion_sync: true
---

# ADR-0005: ممیزی دو سطحی سند و ادعا

## زمینه

تأیید کل سند ممکن است ادعای غلط را پنهان کند؛ ممیزی همهٔ جمله‌ها هزینه‌بر و بی‌فایده است.

## تصمیم

Brain ابتدا سند را ممیزی می‌کند، سپس claimهای تصمیم‌ساز/عددی/علّی/توصیه‌ای را مستقل ارزیابی می‌کند. retrieval status مؤثر هر دو سطح را لحاظ می‌کند.

## پیامد مثبت

دقت citation و کنترل تعارض بدون انفجار هزینه.

## پیامد منفی

نیاز به claim extraction، locator و aggregation policy.
