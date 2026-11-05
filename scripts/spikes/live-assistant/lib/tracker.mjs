/**
 * رویدادهای سرور Realtime را به یک خلاصهٔ قابل‌سنجش تبدیل می‌کند: متن شنیده‌شده، فراخوانی ابزار،
 * مصرف توکن و تأخیر. نام رویدادها از دانش نویسنده است و در محیط ساخت با مستند رسمی تطبیق داده
 * نشد؛ برای همین هر دو نام قدیمی و جدید (`audio_transcript` / `output_audio_transcript`) پذیرفته
 * می‌شود و رویدادهای ناشناخته شمرده می‌شوند تا در گزارش دیده شوند (نه اینکه بی‌صدا گم شوند).
 */
import { addTotals, breakdown, EMPTY_TOTALS } from './cost.mjs';

function parseArgs(raw) {
  if (raw && typeof raw === 'object') return { args: raw, error: null };
  try {
    return { args: JSON.parse(raw ?? '{}'), error: null };
  } catch (error) {
    return { args: null, error: error instanceof Error ? error.message : 'invalid json' };
  }
}

export function createTracker() {
  const userTranscripts = [];
  const assistantTranscripts = [];
  const toolCalls = [];
  const responses = new Map();
  const errors = [];
  const unknown = new Map();
  const seenCalls = new Set();
  let lastSpeechStoppedAt = null;
  let session = null;

  const response = (id, atMs) => {
    const key = id ?? 'unknown';
    if (!responses.has(key)) {
      responses.set(key, {
        id: key,
        startedAt: atMs,
        firstAudioAt: null,
        latencyMs: null,
        status: null,
        usage: null,
        totals: { ...EMPTY_TOTALS },
      });
    }
    return responses.get(key);
  };

  const addToolCall = (call, atMs) => {
    const id = call.call_id ?? `${call.name}:${toolCalls.length}`;
    if (seenCalls.has(id)) return;
    seenCalls.add(id);
    const { args, error } = parseArgs(call.arguments);
    toolCalls.push({ callId: id, name: call.name, args, argsError: error, atMs });
  };

  function ingest(event, atMs) {
    switch (event?.type) {
      case 'session.created':
      case 'session.updated':
        session = event.session ?? session;
        break;
      case 'input_audio_buffer.speech_stopped':
        lastSpeechStoppedAt = atMs;
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (typeof event.transcript === 'string') userTranscripts.push(event.transcript);
        break;
      case 'response.created':
        response(event.response?.id, atMs).latencyMs = null;
        break;
      // در WebRTC صدا با RTP می‌آید و رویداد delta ندارد؛ شروع پخش با رویداد بافر خروجی اعلام می‌شود.
      case 'output_audio_buffer.started':
      case 'response.output_audio.delta':
      case 'response.audio.delta': {
        const entry = response(event.response_id, atMs);
        if (entry.firstAudioAt === null) {
          entry.firstAudioAt = atMs;
          if (lastSpeechStoppedAt !== null) entry.latencyMs = atMs - lastSpeechStoppedAt;
        }
        break;
      }
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        if (typeof event.transcript === 'string') assistantTranscripts.push(event.transcript);
        break;
      case 'response.function_call_arguments.done':
        addToolCall(event, atMs);
        break;
      case 'response.done': {
        const entry = response(event.response?.id, atMs);
        entry.status = event.response?.status ?? null;
        entry.usage = event.response?.usage ?? null;
        entry.totals = breakdown(entry.usage);
        for (const item of event.response?.output ?? []) {
          if (item?.type === 'function_call') addToolCall(item, atMs);
        }
        if (event.response?.status === 'failed') {
          errors.push({ type: 'response_failed', message: event.response?.status_details ?? null });
        }
        break;
      }
      case 'error':
        errors.push({
          type: event.error?.type ?? 'error',
          code: event.error?.code ?? null,
          message: String(event.error?.message ?? '').slice(0, 300),
        });
        break;
      default:
        if (typeof event?.type === 'string' && !event.type.startsWith('rate_limits')) {
          unknown.set(event.type, (unknown.get(event.type) ?? 0) + 1);
        }
    }
  }

  function snapshot() {
    const list = [...responses.values()];
    return {
      session,
      userTranscripts: [...userTranscripts],
      assistantTranscripts: [...assistantTranscripts],
      toolCalls: [...toolCalls],
      responses: list,
      errors: [...errors],
      unknownEvents: Object.fromEntries(unknown),
      totals: list.reduce((sum, entry) => addTotals(sum, entry.totals), { ...EMPTY_TOTALS }),
    };
  }

  return { ingest, snapshot };
}
