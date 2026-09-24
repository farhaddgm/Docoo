---
doc_id: DOCOO-AI-PROVIDERS
title: ارکستراسیون ارائه‌دهندگان و مدل‌های AI
status: approved-baseline
version: 1.0.1
owner: AI Platform
last_updated: 2026-09-24
notion_sync: true
---

# ارکستراسیون ارائه‌دهندگان و مدل‌های AI

## ۱. هدف

Docoo باید OpenAI، Google Gemini و Anthropic را از طریق آداپترهای مستقل متصل کند. دامنه فقط قرارداد داخلی را می‌شناسد. Cursor تا زمانی که قابلیت رسمی مناسب inference/agent موردنیاز وجود نداشته باشد، feature-flag خاموش دارد.

## ۲. قرارداد داخلی

```ts
interface ModelProviderAdapter {
  listModels(): Promise<ModelDescriptor[]>;
  healthCheck(): Promise<ProviderHealth>;
  invoke(request: NormalizedModelRequest): Promise<NormalizedModelResponse>;
  stream?(request: NormalizedModelRequest): AsyncIterable<NormalizedEvent>;
  cancel?(externalRequestId: string): Promise<void>;
  estimateCost(input: UsageInput, priceSnapshot: PriceSnapshot): Money;
}
```

Request شامل messages/instructions، structured output schema، tools، attachments، model parameters، timeout، idempotency/correlation و retention intent است. Response شامل content blocks، tool calls، citations، usage، finish reason، provider IDs و raw encrypted diagnostic reference است.

## ۳. capability negotiation

ModelDescriptor قابلیت‌های زیر را اعلان می‌کند: text، image/file/audio input، structured output، function/tool call، web/file search، reasoning controls، streaming، cancel، max context/output و regional/retention flags. UI فقط پارامترهای معتبر همان مدل را نشان می‌دهد.

## ۴. OpenAI

آداپتر مبنا بر Responses API طراحی می‌شود. مستندات رسمی امکان input متنی/تصویری/فایل، output متنی/JSON و ابزارهای داخلی یا function call را شرح می‌دهد. `store` و قابلیت‌های دارای state باید مطابق policy محرمانگی تنظیم شوند؛ برای workflow محرمانه default داخلی Docoo برابر `store=false` است مگر ادمین و قرارداد provider خلاف آن را مجاز کنند.

نکتهٔ مهم: مستندات رسمی OpenAI بیان می‌کند Responses API در حالت معمول می‌تواند application state را نگه دارد و کنترل‌های Zero Data Retention رفتار `store` را تغییر می‌دهند؛ بنابراین retention provider بخشی از تنظیم اتصال و risk review است، نه یک فرض ثابت.

منابع رسمی:

- https://developers.openai.com/api/reference/cli/resources/responses/methods/create
- https://developers.openai.com/api/docs/guides/your-data

## ۵. Google Gemini

آداپتر از API/SDK رسمی و function calling استفاده می‌کند. function declaration به ToolDefinition داخلی map می‌شود و function response فقط پس از اجرای policy-controlled tool به مدل برمی‌گردد. فایل و multimodal فقط با MIME و limit معتبر ارسال می‌شوند.

منبع رسمی: https://ai.google.dev/gemini-api/docs/function-calling

## ۶. Anthropic

آداپتر Messages API و tool use رسمی را پشت همان قرارداد قرار می‌دهد. تفاوت system instruction، content block، prompt caching، usage و stop reason در adapter نرمال می‌شود. مدل ID از catalog زنده خوانده می‌شود و در business code hardcode نمی‌شود.

منبع رسمی: https://docs.anthropic.com/en/api/messages

## ۷. Cursor

Cursor مدل‌های متعدد را در محصول خود عرضه می‌کند و SDK/Cloud Agent آن برای عامل کدنویسی و repository task طراحی شده است. این SDK معادل endpoint عمومی chat-completions برای استفادهٔ دلخواه Docoo فرض نمی‌شود. integration فقط پس از spike و احراز این موارد فعال می‌شود:

- API رسمی و شرایط استفادهٔ server-to-server؛
- model catalog و parameter discovery؛
- حریم خصوصی/retention/region؛
- پشتیبانی task غیرکدنویسی یا تناسب واقعی با نقش؛
- idempotency و observability کافی.

منبع رسمی: https://cursor.com/docs/sdk/typescript

## ۸. resolution مدل

ترتیب: system default → role default → topic override → project agent profile → run override. Resolver سپس capability، health و policy را validate می‌کند. اگر مدل قابلیت لازم را ندارد، اجرا با خطای configuration متوقف می‌شود؛ انتخاب خاموش مدل دیگر مجاز نیست.

## ۹. تغییر حین اجرا

Provider call اتمیک است. تغییر ادمین call جاری را mutate نمی‌کند. version جدید در نخستین boundary بعدی resolve می‌شود:

- بعد از tool result؛
- retry؛
- ادامه پس از human task؛
- transition مرحله؛
- call بعدی یک attempt چندمرحله‌ای.

این رفتار «اثر فوری بر ادامه» را با replay و audit سازگار می‌کند.

## ۱۰. retry و توقف

فقط خطای transient/rate-limit/timeout قابل retry است. schedule تلاش‌های بعدی:

| retry | delay |
| ----: | ----: |
|     1 |    5s |
|     2 |    5s |
|     3 |    5s |
|     4 |   10s |
|     5 |   15s |
|     6 |   20s |
|     7 |   25s |
|     8 |   30s |
|     9 |   35s |
|    10 |   40s |

اگر provider `Retry-After` بزرگ‌تری ارائه دهد، مقدار بزرگ‌تر با سقف policy استفاده می‌شود. پس از تلاش دهم، workflow paused و human task ساخته می‌شود. fallback خودکار خاموش است.

## ۱۱. secret و health

- secret با envelope encryption و reference ذخیره می‌شود.
- API پاسخ secret کامل ندارد.
- health check prompt فاقد دادهٔ مشتری دارد.
- وضعیت healthy/degraded/unavailable و زمان آخرین check نمایش داده می‌شود.
- rotation نسخهٔ secret می‌سازد و workerها بدون restart آن را refresh می‌کنند.

## ۱۲. usage و هزینه

Usage خام provider و normalized token fields ذخیره می‌شود. قیمت‌ها snapshot تاریخ‌دار و صرفاً estimate هستند. cost limit می‌تواند soft warning یا hard gate باشد. reasoning/cached/tool token جدا ثبت می‌شود وقتی provider گزارش می‌دهد.

## ۱۳. data minimization

- فقط chunkهای لازم ارسال می‌شوند.
- شناسه و metadata غیرضروری pseudonymize می‌شوند.
- provider log content خام به‌طور پیش‌فرض خاموش است.
- attachment موقت provider پس از نیاز حذف می‌شود، اگر API امکان دهد.
- UI policy retention و منطقهٔ اتصال را نشان می‌دهد.
