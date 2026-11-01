import type { Locale } from '../i18n';
import type { VoiceProblem } from './voice-helpers';

/** `fill('{n} of {total}', { n: 1, total: 5 })` → `1 of 5`. */
export function fillText(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

const fa = {
  bar: 'گفتگوی صوتی',
  input: 'ورودی',
  output: 'پاسخ',
  text: 'متن',
  voice: 'صدا',
  modeText: 'متن به متن',
  modeDictate: 'من صدا می‌دهم، پاسخ متنی',
  modeListen: 'من می‌نویسم، پاسخ صوتی',
  modeTalk: 'صدا به صدا',
  record: 'ضبط صدا',
  stop: 'پایان ضبط و تبدیل به متن',
  cancel: 'لغو ضبط',
  recording: 'در حال ضبط {time} از {max}',
  requesting: 'در انتظار اجازهٔ میکروفون…',
  transcribing: 'در حال تبدیل صدا به متن…',
  nothingHeard: 'صدایی شنیده نشد؛ دوباره امتحان کنید.',
  speaker: 'صدای اسپیکر',
  volume: 'بلندی صدا',
  mute: 'قطع صدا',
  unmute: 'وصل صدا',
  play: 'خواندن این پاسخ',
  pause: 'توقف خواندن',
  loading: 'در حال آماده‌سازی صدا…',
  truncated: 'متن طولانی بود؛ فقط بخش اول خوانده شد.',
  replayCosts: 'پخش دوبارهٔ صدا پس از رفرش، یک بار دیگر از سرویس صوتی هزینه دارد.',
  autoSend: 'متن پیاده‌شده بلافاصله ارسال شود',
  autoSendHint: 'اگر خاموش باشد، متن اول در کادر پیام می‌آید تا بررسی و اصلاح کنید.',
  deleteAudio: 'پاک کردن صداهای این گفتگو',
  deleteMine: 'پاک کردن همهٔ صداهای قبلی من',
  deleted: '{n} صدا پاک شد.',
  storesNote: 'صدای شما در این گفتگو ذخیره می‌شود و فقط خودتان می‌شنوید.',
  unavailable: {
    disabled: 'گفتگوی صوتی در تنظیمات سامانه فعال نیست.',
    not_configured: 'سرویس صوتی هنوز کامل تنظیم نشده است (اتصال، مدل و صدا).',
  },
  noMic: 'این مرورگر یا این نشانی (بدون HTTPS) ضبط صدا را پشتیبانی نمی‌کند.',
  micDenied: 'اجازهٔ میکروفون داده نشد. از تنظیمات مرورگر آن را فعال کنید.',
  noDevice: 'میکروفونی پیدا نشد.',
  problems: {
    disabled: 'گفتگوی صوتی در تنظیمات سامانه فعال نیست.',
    not_configured: 'سرویس صوتی هنوز کامل تنظیم نشده است.',
    too_long: 'ضبط بیش از حد طولانی است.',
    invalid_audio: 'صدا یا متن قابل پردازش نبود.',
    provider: 'سرویس صوتی خطا داد؛ کمی بعد دوباره امتحان کنید.',
    timeout: 'سرویس صوتی دیر پاسخ داد؛ دوباره امتحان کنید.',
    limit: 'سقف استفادهٔ هوش مصنوعی حساب شما پر شده یا خاموش است.',
    denied: 'دسترسی این کار را ندارید.',
    unknown: 'خطای ناشناخته در گفتگوی صوتی.',
  } satisfies Record<VoiceProblem, string>,
};

type Table = typeof fa;

const en: Table = {
  bar: 'Voice conversation',
  input: 'Input',
  output: 'Reply',
  text: 'Text',
  voice: 'Voice',
  modeText: 'Text to text',
  modeDictate: 'I speak, the reply is text',
  modeListen: 'I type, the reply is spoken',
  modeTalk: 'Voice to voice',
  record: 'Record voice',
  stop: 'Stop recording and turn it into text',
  cancel: 'Cancel recording',
  recording: 'Recording {time} of {max}',
  requesting: 'Waiting for microphone permission…',
  transcribing: 'Turning speech into text…',
  nothingHeard: 'Nothing was heard; try again.',
  speaker: 'Speaker volume',
  volume: 'Volume',
  mute: 'Mute',
  unmute: 'Unmute',
  play: 'Read this reply aloud',
  pause: 'Stop reading',
  loading: 'Preparing the voice…',
  truncated: 'The text was long; only the first part was read.',
  replayCosts: 'Playing a reply again after a refresh costs one more call to the voice provider.',
  autoSend: 'Send the transcript at once',
  autoSendHint:
    'When off, the transcript first lands in the message box so you can check and edit it.',
  deleteAudio: 'Delete the recordings of this conversation',
  deleteMine: 'Delete all my earlier recordings',
  deleted: '{n} recordings deleted.',
  storesNote: 'Your voice is stored in this conversation and only you can hear it.',
  unavailable: {
    disabled: 'Voice conversation is off in the system settings.',
    not_configured: 'The voice provider is not fully set up yet (connection, model and voice).',
  },
  noMic: 'This browser, or this address (without HTTPS), cannot record audio.',
  micDenied: 'Microphone permission was denied. Allow it in the browser settings.',
  noDevice: 'No microphone was found.',
  problems: {
    disabled: 'Voice conversation is off in the system settings.',
    not_configured: 'The voice provider is not fully set up yet.',
    too_long: 'The recording is too long.',
    invalid_audio: 'The audio or the text could not be processed.',
    provider: 'The voice provider failed; try again in a moment.',
    timeout: 'The voice provider was slow; try again.',
    limit: 'The AI allowance of your account is used up or switched off.',
    denied: 'You are not allowed to do this.',
    unknown: 'Unknown voice error.',
  },
};

export function voiceMessages(locale: Locale): Table {
  return locale === 'fa' ? fa : en;
}
