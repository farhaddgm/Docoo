/**
 * منطق خالص آداپتر `pipeline` برای spike فاز ۰ (ADR-0055): رونویسی ElevenLabs ← مدل متنی با ابزار
 * ← صدای ElevenLabs. همان دستورالعمل فارسی و همان ابزارهای مسیر بلادرنگ (`session.mjs`) را می‌گیرد
 * تا نتیجه با همان ۱۲ سناریو و همان امتیازدهی قابل مقایسه باشد.
 *
 * مشخصات endpointها (چت `/chat/completions` سازگار با OpenAI، ElevenLabs `/v1/speech-to-text` و
 * `/v1/text-to-speech/{voice}`) از دانش نویسنده و کد آداپتر محصول است و در محیط ساخت با سرویس واقعی
 * آزموده نشد؛ متن خطای سرویس‌دهنده عیناً (تا ۵۰۰ نویسه) نشان داده می‌شود.
 */
import { cannedToolResult, INSTRUCTIONS_FA, SPIKE_TOOLS } from './session.mjs';

const MAX_STEPS = 4;

/** ابزارهای spike در شکل `tools` چت سازگار با OpenAI. */
export function chatTools(tools = SPIKE_TOOLS) {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

/**
 * یک نوبت گفتگو: متن مالک را به تاریخچه می‌افزاید، مدل را با ابزارها صدا می‌زند و تا وقتی مدل ابزار
 * می‌خواهد نتیجهٔ آزمایشی می‌دهد (مثل مسیر بلادرنگ؛ مجری واقعی نیست). `history` همان‌جا تغییر می‌کند.
 * نتیجه: متن پاسخ، فراخوانی‌های ابزار و جمع مصرف توکن.
 */
export async function runChatTurn({
  fetchImpl = fetch,
  baseUrl,
  apiKey,
  model,
  history,
  userText,
  instructions = INSTRUCTIONS_FA,
  tools = chatTools(),
  timeoutMs = 45_000,
}) {
  history.push({ role: 'user', content: userText });
  const toolCalls = [];
  const usage = { input: 0, output: 0, cached: 0, requests: 0 };
  let reply = '';
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/u, '')}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: instructions }, ...history],
        tools,
        tool_choice: 'auto',
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) {
      throw Object.assign(new Error('llm_failed'), {
        stage: 'llm',
        status: response.status,
        body: text,
      });
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw Object.assign(new Error('llm_invalid_json'), { stage: 'llm', status: 200, body: text });
    }
    usage.requests += 1;
    usage.input += Number(data.usage?.prompt_tokens) || 0;
    usage.output += Number(data.usage?.completion_tokens) || 0;
    usage.cached += Number(data.usage?.prompt_tokens_details?.cached_tokens) || 0;
    const message = data.choices?.[0]?.message ?? {};
    history.push({
      role: 'assistant',
      content: message.content ?? null,
      ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
    });
    if (typeof message.content === 'string' && message.content.trim())
      reply = message.content.trim();
    if (!message.tool_calls?.length) return { reply, toolCalls, usage };
    for (const call of message.tool_calls) {
      const name = call.function?.name ?? '';
      toolCalls.push({
        callId: call.id ?? `${name}:${toolCalls.length}`,
        name,
        arguments: call.function?.arguments ?? '{}',
      });
      history.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(cannedToolResult({ name })),
      });
    }
  }
  return { reply, toolCalls, usage };
}

/**
 * نتیجهٔ یک نوبت را به رویدادهایی شبیه رویدادهای مسیر بلادرنگ تبدیل می‌کند تا همان `createTracker`
 * و `scoreScenario` بدون تغییر کار کنند. زمان‌ها از مرورگر می‌آید (`speechStoppedAt`،
 * `firstAudioAt` به میلی‌ثانیهٔ `performance.now()`).
 */
export function eventsForTurn(turn, id = 'r1') {
  const events = [
    { at: turn.speechStoppedAt, event: { type: 'input_audio_buffer.speech_stopped' } },
    {
      at: turn.speechStoppedAt,
      event: {
        type: 'conversation.item.input_audio_transcription.completed',
        transcript: turn.transcript,
      },
    },
    { at: turn.speechStoppedAt, event: { type: 'response.created', response: { id } } },
  ];
  for (const call of turn.toolCalls) {
    events.push({
      at: turn.speechStoppedAt,
      event: {
        type: 'response.function_call_arguments.done',
        call_id: call.callId,
        name: call.name,
        arguments: call.arguments,
      },
    });
  }
  if (turn.firstAudioAt !== null && turn.firstAudioAt !== undefined) {
    events.push({
      at: turn.firstAudioAt,
      event: { type: 'output_audio_buffer.started', response_id: id },
    });
  }
  if (turn.reply) {
    events.push({
      at: turn.firstAudioAt ?? turn.speechStoppedAt,
      event: { type: 'response.output_audio_transcript.done', transcript: turn.reply },
    });
  }
  const total = turn.usage.input + turn.usage.output;
  events.push({
    at: turn.firstAudioAt ?? turn.speechStoppedAt,
    event: {
      type: 'response.done',
      response: {
        id,
        status: 'completed',
        usage: {
          input_tokens: turn.usage.input,
          output_tokens: turn.usage.output,
          total_tokens: total,
          input_token_details: { text_tokens: turn.usage.input, cached_tokens: turn.usage.cached },
          output_token_details: { text_tokens: turn.usage.output },
        },
      },
    },
  });
  return events;
}

/** رونویسی با ElevenLabs (`POST /v1/speech-to-text`، فرم چندبخشی با فایل ضبط). */
export async function transcribe({
  fetchImpl = fetch,
  baseUrl,
  apiKey,
  model,
  language,
  audio,
  mimeType,
}) {
  const form = new FormData();
  form.set('model_id', model);
  if (language) form.set('language_code', language);
  form.set('file', new Blob([audio], { type: mimeType }), 'recording');
  const response = await fetchImpl(`${baseUrl}/v1/speech-to-text`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, accept: 'application/json' },
    body: form,
    signal: AbortSignal.timeout(45_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw Object.assign(new Error('stt_failed'), {
      stage: 'stt',
      status: response.status,
      body: text,
    });
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw Object.assign(new Error('stt_invalid_json'), { stage: 'stt', status: 200, body: text });
  }
  const words = Array.isArray(data.words) ? data.words : [];
  const seconds = words.reduce((end, word) => Math.max(end, Number(word?.end) || 0), 0);
  return { text: typeof data.text === 'string' ? data.text.trim() : '', seconds };
}

/** صدا با ElevenLabs (`POST /v1/text-to-speech/{voice}`)؛ بایت‌های mp3 برمی‌گردد. */
export async function synthesize({
  fetchImpl = fetch,
  baseUrl,
  apiKey,
  model,
  voiceId,
  language,
  text,
}) {
  const response = await fetchImpl(
    `${baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, accept: 'audio/mpeg', 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: model,
        ...(language ? { language_code: language } : {}),
      }),
      signal: AbortSignal.timeout(45_000),
    },
  );
  if (!response.ok) {
    throw Object.assign(new Error('tts_failed'), {
      stage: 'tts',
      status: response.status,
      body: await response.text(),
    });
  }
  return new Uint8Array(await response.arrayBuffer());
}
