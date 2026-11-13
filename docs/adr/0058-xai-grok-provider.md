# ADR-0058 — xAI (Grok) به‌عنوان ارائه‌دهندهٔ چهارم مدل متنی

وضعیت: **درخواست مالک؛ پیاده‌شده، هنوز با سرویس واقعی آزموده نشده**. تاریخ مطالعهٔ مستندات: ۲۰۲۶-۱۱-۱۳، نسخهٔ مبنا 0.60.0. [ADR-0022](0022-model-prices-from-public-catalog.md) (کاتالوگ قیمت) و [ADR-0047](0047-dual-model-research.md) (تحقیق دومدلی) را کامل می‌کند.

## ۱. خلاصه به زبان ساده

تا امروز مراحل پروژه (تحلیل، تحقیق، ایده‌پردازی، مستندسازی، ارزیابی) فقط با OpenAI، Gemini و Claude اجرا می‌شد. حالا **Grok** هم می‌تواند: ادمین در صفحهٔ «ارائه‌دهندگان AI» اتصال «xAI Grok» می‌سازد، کلید API را می‌گذارد و مثل بقیه آن را به نقش یا پروژه می‌دهد.

نیاز مالی: کلید و اعتبار از **console.x.ai** می‌آید، جدا از اشتراک X یا SuperGrok.

## ۲. آنچه مستندات رسمی می‌گویند (docs.x.ai، خوانده‌شده در ۲۰۲۶-۱۱-۱۳)

| موضوع             | یافته                                                                                                                                                                                                                          | صفحه                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| نشانی و احراز     | پایه `https://api.x.ai/v1`، هدر `Authorization: Bearer <XAI_API_KEY>`؛ حساب و کلید از console.x.ai و حساب باید اعتبار داشته باشد                                                                                               | developers/quickstart                                  |
| Responses API     | «رابط اصلی» تولید متن؛ `POST /v1/responses` با `input`، `instructions`، `store`، `max_output_tokens`، `temperature`، `text.format`، `tools` (فقط تابع و جست‌وجوی وب)، `tool_choice`، `parallel_tool_calls`، `reasoning.effort` | rest-api-reference/inference/responses                 |
| خروجی ساختاریافته | `text.format = { type: "json_schema", name, schema, strict: true }`؛ `additionalProperties` پیش‌فرض `false`؛ `minimum`/`maximum` بی‌سقف، `minLength`/`maxLength` تا ۲۰۴۸، `minItems`/`maxItems` تا ۲۵۶                         | model-capabilities/text/structured-outputs             |
| ابزار تابعی       | `{type:"function", name, description, parameters}`؛ `strict` همیشه روشن است؛ خروجی `function_call` با `call_id`، `name`، `arguments`؛ پاسخ با `function_call_output`                                                           | tools/function-calling                                 |
| جست‌وجوی وب       | `{type:"web_search"}` سمت سرور xAI؛ استنادها `url_citation` با `url`، `start_index`، `end_index` و `title` که **فقط شمارهٔ استناد** است («1»). `max_tool_calls` فیلد درخواست نیست (فقط در پاسخ)                                | tools/web-search، tools/citations                      |
| شمارش توکن        | `usage.output_tokens` فقط توکن‌های دیدنی؛ استدلال جدا در `output_tokens_details.reasoning_tokens`؛ نمونهٔ مستندات: ۳۲ ورودی + ۹ خروجی + ۱۱۰ استدلال = ۱۵۱ کل. (در OpenAI استدلال داخل `output_tokens` است؛ اینجا نیست)         | rest-api-reference/inference/responses                 |
| استدلال           | مدل‌های Grok 4.x همیشه استدلال می‌کنند و خاموش نمی‌شود؛ `max_output_tokens` فقط به توکن‌های دیدنی می‌خورد                                                                                                                      | model-capabilities/text/reasoning                      |
| فهرست مدل         | `GET /v1/models` → `{data:[{id, context_length, …}]}`؛ مدل‌های تصویر، ویدیو و صدا (`grok-imagine-*`، `grok-voice-*`) در همان فهرست‌اند                                                                                         | rest-api-reference/inference/models، developers/models |
| قیمت              | مثلاً `grok-4.7`: ورودی ۲، ورودی نهان‌گاه ۰٫۵، خروجی ۶ دلار به‌ازای هر میلیون توکن؛ بالای ۲۰۰ هزار توکن پرامپت دو برابر                                                                                                        | developers/models                                      |
| خطاها             | ۴۰۱ برای کلید بد، ۴۰۳ برای نبود مجوز، ۴۲۲ برای فیلد نامعتبر، ۴۲۹ برای سقف نرخ. **کد خطای نبود اعتبار در صفحهٔ خطاها نیامده**                                                                                                   | developers/debugging                                   |

## ۳. تصمیم

۱. `xai` یک `ProviderKind` تازه است (مقدار تازهٔ enum دیتابیس، migration 0092؛ بدون جدول یا ستون تازه).
۲. `XaiAdapter` همان قرارداد `ModelProviderAdapter` را اجرا می‌کند و از Responses API استفاده می‌کند. ساختن ورودی (`function_call`/`function_call_output`) با OpenAI مشترک است.
۳. تفاوت‌ها نسبت به آداپتر OpenAI (همه از جدول بالا):

- **استدلال از `output_tokens` کم نمی‌شود**، چون xAI آن را جدا گزارش می‌کند. اگر پاسخی به‌صورت دیگر جمع شود (کل = ورودی + خروجی) همان کسر می‌شود تا هزینه دو بار حساب نشود.
- `strict` روی ابزار تابعی فرستاده نمی‌شود (همیشه روشن است) و هدر idempotency فرستاده نمی‌شود (مستند نیست).
- جست‌وجوی وب سقف تعداد در هر فراخوانی ندارد، چون `max_tool_calls` فیلد درخواست نیست. سقف دورهای تحقیق و سقف هزینهٔ پروژه همچنان کار می‌کنند.
- عنوان استناد (`"1"`) به‌جای عنوان صفحه نمی‌آید؛ نشانی صفحه عنوان می‌شود.
- فهرست مدل‌ها فقط `grok*` است و مدل‌های `imagine`، `voice` و `multi-agent` کنار گذاشته می‌شوند.
  ۴. کاتالوگ قیمت LiteLLM کلیدهای `xai/…` دارد؛ قیمت‌ها با صفحهٔ xAI برابرند (آزموده‌شده برای `grok-4.7`).
  ۵. ارزیابی جفتی (Evaluation Lab) هم `xai` را می‌پذیرد.

## ۴. آنچه هنوز نمی‌دانیم

- هیچ فراخوانی به api.x.ai زده نشده (کلید نبود). آزمون‌ها با پاسخ‌های ساختگی به شکل مستندات‌اند. اول با `XAI_API_KEY=… pnpm --filter @docoo/providers test:acceptance` (و در صورت نیاز `XAI_MODEL`) یک بار روی سرویس واقعی بگذرانید.
- شکل فیلدهای `web_search_call` و مقدارهای `incomplete_details.reason` در مستندات نیامده؛ آداپتر تحمل‌کننده نوشته شده (پرسمان را از `action.query` می‌خواند و در نبودش خالی می‌گذارد).
- پیام و کد HTTP نبود اعتبار مستند نیست؛ هر کد غیر ۲۰۰ مثل بقیهٔ ارائه‌دهنده‌ها دسته‌بندی می‌شود و دلیل ارائه‌دهنده در ستون وضعیت نشان داده می‌شود.
- Grok بدون جست‌وجو از رویدادهای پس از دانش خود بی‌خبر است (گفتهٔ خود xAI)؛ برای تحقیق وب فعال‌کردن ابزار جست‌وجو لازم است و آداپتر آن را می‌فرستد.
- مدل‌های `multi-agent` و ورودی فایل از طریق Files API xAI پشتیبانی نشده‌اند.
