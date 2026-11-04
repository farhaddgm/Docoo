/**
 * پیکربندی نشست آزمایشی: دستورالعمل فارسی، مجموعهٔ کوچک ثابت ابزار ADR-0055 بخش ۴-۱، و ساخت
 * درخواست «رابط یکپارچه» (مرورگر SDP را به این سرور محلی می‌دهد؛ کلید فقط اینجاست).
 *
 * شکل پارامترهای نشست از دانش نویسنده است و با مستند رسمی تطبیق داده نشد. اگر سرویس‌دهنده
 * شکل دیگری بخواهد، بدون تغییر کد با `--session-override فایل.json` اصلاح می‌شود (ادغام عمیق)،
 * و متن خطای سرویس‌دهنده عیناً در رابط نشان داده می‌شود.
 */

export const SPOKEN_NAME = 'داکو';

export const INSTRUCTIONS_FA = `تو «${SPOKEN_NAME}» هستی (نام لاتین: Docoo)، دستیار صوتی مالک سامانهٔ Docoo. فارسی و کوتاه و محترمانه حرف بزن؛ اگر مالک انگلیسی حرف زد انگلیسی جواب بده.
قواعد:
- هر درخواستی دربارهٔ Docoo، پروژه‌ها، تنظیمات یا انجام کار را با ابزار run_task بسپار. خودت چیزی را حدس نزن و ادعای انجام کار نکن.
- هیچ تغییری بدون تأیید مالک ثبت نمی‌شود. وقتی run_task کارت پیش‌نمایش ساخت، خلاصه‌اش را بگو و بپرس «تأیید می‌کنید؟». فقط اگر مالک صریحاً تأیید کرد confirm_action را صدا بزن، و اگر نه گفت cancel_action.
- اگر درخواست مبهم است (مثلاً «اونو حذف کن») ابزار صدا نزن؛ بپرس منظور کدام مورد است.
- کلید، گذرواژه و رازها را هرگز نخوان و تنظیم نکن؛ بگو برای این‌ها صفحهٔ تنظیمات را باز می‌کنی و show_on_screen را صدا بزن.
- عددها و تاریخ‌ها را همان‌طور که مالک گفت نگه دار و برای تأیید یک بار بازخوانی کن.`;

const objectSchema = (properties, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const SPIKE_TOOLS = [
  {
    type: 'function',
    name: 'run_task',
    description:
      'درخواست مالک را برای بررسی و ساخت کارت پیش‌نمایش به مجری بسپار. هر کار یا پرسش دربارهٔ Docoo از اینجا می‌گذرد.',
    parameters: objectSchema(
      { request: { type: 'string', description: 'درخواست مالک، کامل و با همان نام‌ها و عددها' } },
      ['request'],
    ),
  },
  {
    type: 'function',
    name: 'confirm_action',
    description: 'فقط وقتی مالک صریحاً تأیید کرد: اقدام در انتظار را ثبت کن.',
    parameters: objectSchema({ actionId: { type: 'string' } }, ['actionId']),
  },
  {
    type: 'function',
    name: 'cancel_action',
    description: 'وقتی مالک نه گفت: اقدام در انتظار را لغو کن.',
    parameters: objectSchema({ actionId: { type: 'string' } }, ['actionId']),
  },
  {
    type: 'function',
    name: 'show_on_screen',
    description: 'صفحه یا بخشی را برای مالک باز و برجسته کن.',
    parameters: objectSchema({ target: { type: 'string' } }, ['target']),
  },
  {
    type: 'function',
    name: 'get_status',
    description: 'وضعیت کوتاه نشست و اقدام‌های در انتظار.',
    parameters: objectSchema({}),
  },
  {
    type: 'function',
    name: 'end_session',
    description: 'گفتگوی زنده را پایان بده، وقتی مالک خواست.',
    parameters: objectSchema({}),
  },
];

/** نتیجهٔ ساختگی ابزارها؛ مجری واقعی در این spike نیست و فقط رفتار مدل سنجیده می‌شود. */
export function cannedToolResult(call) {
  switch (call.name) {
    case 'run_task':
      return {
        status: 'preview_ready',
        actionId: 'A1',
        summary: 'کارت پیش‌نمایش ساخته شد و منتظر تأیید مالک است. (نتیجهٔ آزمایشی؛ چیزی ثبت نشده)',
      };
    case 'confirm_action':
      return { status: 'executed', note: '(آزمایشی) چیزی واقعاً ثبت نشد.' };
    case 'cancel_action':
      return { status: 'cancelled' };
    case 'show_on_screen':
      return { status: 'shown' };
    case 'get_status':
      return { status: 'live', pendingActions: ['A1'] };
    default:
      return { status: 'ok' };
  }
}

function merge(base, extra) {
  if (Array.isArray(base) || Array.isArray(extra)) return extra ?? base;
  if (base && extra && typeof base === 'object' && typeof extra === 'object') {
    const result = { ...base };
    for (const [key, value] of Object.entries(extra)) result[key] = merge(base[key], value);
    return result;
  }
  return extra === undefined ? base : extra;
}

export function buildSessionConfig({
  model,
  voice,
  instructions = INSTRUCTIONS_FA,
  tools = SPIKE_TOOLS,
  transcriptionModel,
  language = 'fa',
  override = {},
}) {
  const input = { turn_detection: { type: 'server_vad' } };
  if (transcriptionModel) input.transcription = { model: transcriptionModel, language };
  const output = voice ? { voice } : {};
  const session = {
    type: 'realtime',
    model,
    instructions,
    output_modalities: ['audio'],
    audio: { input, output },
    tools,
    tool_choice: 'auto',
  };
  return merge(session, override);
}

/** بدنهٔ چندبخشی برای `POST /v1/realtime/calls`. */
export function buildCallForm(sdp, session) {
  const form = new FormData();
  form.set('sdp', new Blob([sdp], { type: 'application/sdp' }), 'offer.sdp');
  form.set('session', new Blob([JSON.stringify(session)], { type: 'application/json' }));
  return form;
}
