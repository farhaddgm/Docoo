import type { LiveActionStatus, LiveSessionEndReason } from '@docoo/contracts';

import type { Locale } from '../i18n';
import type { StepKey } from './confirmation-model';
import type { ConfirmHintReason, LiveError, LiveStatus } from './state';

/**
 * The assistant's name is a setting (ADR-0055 §4-8); until the settings page exists these are its
 * defaults. Nothing else in the code carries the name.
 */
export const defaultAssistantName: Record<Locale, string> = { fa: 'داکو', en: 'Docoo' };

export interface LiveMessages {
  readonly name: string;
  readonly status: Record<LiveStatus, string>;
  readonly pill: {
    readonly aria: string;
    readonly tokens: string;
    readonly tokensTitle: string;
    readonly close: string;
    readonly closeTitle: string;
    readonly nearCap: string;
    readonly waiting: string;
  };
  readonly confirm: {
    readonly title: string;
    readonly tiers: Record<'T1' | 'T2' | 'T3', { readonly label: string; readonly hint: string }>;
    readonly steps: Record<StepKey, string>;
    readonly confirmButton: string;
    readonly finalButton: string;
    readonly cancelButton: string;
    readonly groupButton: string;
    readonly voiceHint: string;
    readonly echoHint: string;
    readonly timeLeft: string;
    readonly hints: Record<ConfirmHintReason, string>;
    readonly results: Record<'executed' | 'failed' | 'cancelled' | 'expired', string>;
  };
  readonly card: {
    readonly title: string;
    readonly intro: string;
    readonly start: string;
    readonly stop: string;
    readonly starting: string;
    readonly closing: string;
    readonly unavailable: string;
    /** Why the assistant cannot start yet, from the owner's settings. */
    readonly notReady: {
      readonly disabled: string;
      readonly disclosure: string;
      readonly not_configured: string;
      readonly no_provider: string;
    };
    readonly openSettings: string;
    readonly nearCap: string;
    readonly used: string;
    readonly errors: Record<LiveError, string>;
    /** Typing to the assistant instead of speaking. */
    readonly typing: {
      readonly start: string;
      readonly intro: string;
      readonly placeholder: string;
      readonly send: string;
      readonly thinking: string;
      readonly log: string;
      readonly stop: string;
      readonly roles: Record<'user' | 'assistant', string>;
      readonly waiting: string;
      readonly notReady: Record<'disabled' | 'disclosure' | 'executor_not_configured', string>;
      /** Why a request failed, by the problem code the server gave. */
      readonly failures: Record<string, string>;
      readonly failureOther: string;
    };
  };
  readonly history: {
    readonly title: string;
    readonly empty: string;
    readonly loadFailed: string;
    readonly open: string;
    readonly close: string;
    readonly minutes: string;
    readonly tokens: string;
    readonly cost: string;
    readonly spend: {
      readonly title: string;
      readonly day: string;
      readonly week: string;
      readonly month: string;
      /** "{used} of {cap} today", the daily cap being the limit that closes a session. */
      readonly ofCap: string;
      readonly typed: string;
      readonly none: string;
    };
    readonly noMessages: string;
    readonly noActions: string;
    readonly transcript: string;
    readonly changes: string;
    readonly deleteText: string;
    readonly deleteAsk: string;
    readonly deleteYes: string;
    readonly deleteNo: string;
    readonly deleteFailed: string;
    readonly roles: Record<'user' | 'assistant', string>;
    readonly sessionStatus: Record<'active' | 'ended', string>;
    readonly endReasons: Record<LiveSessionEndReason, string>;
    readonly actionStatus: Record<LiveActionStatus, string>;
  };
}

const fa: LiveMessages = {
  name: defaultAssistantName.fa,
  status: {
    off: 'خاموش',
    starting: 'در حال اتصال…',
    awake: 'گوش می‌دهد',
    asleep: 'در حالت خواب',
    closing: 'در حال بستن…',
    error: 'قطع شد',
  },
  pill: {
    aria: 'دستیار صوتی',
    tokens: 'توکن',
    tokensTitle: 'توکن مصرف‌شدهٔ این گفتگو',
    close: 'بستن',
    closeTitle: 'بستن و پایان گفتگوی زنده',
    nearCap: 'نزدیک سقف',
    waiting: 'منتظر تأیید شما',
  },
  confirm: {
    title: 'تغییر پیشنهادی {name}',
    tiers: {
      T1: { label: 'تغییر ساده', hint: 'قابل‌برگشت' },
      T2: { label: 'تغییر پیامدار', hint: 'کار یا هزینه‌ای شروع یا بسته می‌شود' },
      T3: { label: 'برگشت‌ناپذیر', hint: 'دو تأیید جدا لازم است' },
    },
    steps: {
      preview: 'پیش‌نمایش',
      readback: 'بازخوانی',
      confirm: 'تأیید شما',
      echo: 'تکرار نام',
    },
    confirmButton: 'تأیید',
    finalButton: 'تأیید نهایی',
    cancelButton: 'لغو',
    groupButton: 'تأیید همهٔ تغییرهای ساده ({n})',
    voiceHint: 'یا بگویید «تأیید» یا «نه».',
    echoHint: 'برای تأیید نهایی نام «{target}» را بگویید، یا روی «تأیید نهایی» بزنید.',
    timeLeft: 'مهلت: {time}',
    hints: {
      unclear: 'متوجه نشدم. دوباره بگویید «تأیید» یا «نه»، یا روی دکمه بزنید.',
      echo_mismatch: 'نام درست گفته نشد. نام «{target}» را بگویید یا روی «تأیید نهایی» بزنید.',
      too_soon: 'چند لحظه صبر کنید و دوباره تأیید کنید.',
      closed: 'این تغییر دیگر منتظر تأیید نیست.',
      failed: 'ثبت نشد. دوباره تلاش کنید.',
    },
    results: {
      executed: 'انجام شد',
      failed: 'انجام نشد',
      cancelled: 'لغو شد',
      expired: 'مهلت تمام شد',
    },
  },
  card: {
    title: 'گفتگوی زنده با {name}',
    intro:
      'با صدای خودتان با {name} حرف بزنید تا کارهای بک‌آفیس را انجام دهد. هر تغییر فقط با تأیید خودتان ثبت می‌شود. با بستن پنجرهٔ اسمارت هم گفتگو ادامه دارد، تا خودتان آن را خاموش کنید.',
    start: 'فعال‌سازی گفتگوی زنده',
    stop: 'خاموش کردن گفتگوی زنده',
    starting: 'در حال اتصال…',
    closing: 'در حال بستن…',
    unavailable: 'هنوز در دسترس نیست: دستیار صوتی در تنظیمات راه‌اندازی نشده است.',
    used: 'مصرف این نشست: {n} توکن',
    errors: {
      unavailable: 'گفتگوی زنده هنوز راه‌اندازی نشده است.',
      other_tab: 'گفتگوی زنده در تب دیگری فعال است. همان‌جا خاموشش کنید یا اینجا دوباره تلاش کنید.',
      start_failed: 'اتصال برقرار نشد. دوباره تلاش کنید.',
      connection_lost: 'اتصال قطع شد و گفتگوی زنده بسته شد.',
      cap_reached:
        'به سقف هزینه یا زمان رسید و گفتگوی زنده بسته شد. سقف‌ها در صفحهٔ تنظیمات دستیار قابل‌تغییرند.',
      switched_off: 'دستیار صوتی در تنظیمات خاموش است یا آمادهٔ شروع نیست.',
    },
    notReady: {
      disabled: 'دستیار صوتی در تنظیمات خاموش است.',
      disclosure: 'هشدار حریم خصوصی هنوز در تنظیمات دستیار پذیرفته نشده است.',
      not_configured: 'اتصال و مدل صوتی هنوز در تنظیمات دستیار انتخاب نشده است.',
      no_provider: 'اتصال به سرویس صوتی هنوز راه‌اندازی نشده است.',
    },
    openSettings: 'باز کردن تنظیمات دستیار',
    nearCap:
      'به سقف هزینه یا زمان نزدیک می‌شوید؛ گفتگو با رسیدن به سقف خودکار بسته می‌شود. سقف‌ها در تنظیمات دستیار قابل‌تغییرند.',
    typing: {
      start: 'نوشتن به‌جای صحبت',
      intro:
        'با {name} بنویسید. پاسخ‌ها با مدل متنی شما ساخته می‌شود و هر تغییر فقط با تأیید خودتان ثبت می‌شود.',
      placeholder: 'درخواست خود را بنویسید…',
      send: 'ارسال',
      thinking: 'در حال فکر کردن…',
      log: 'گفتگوی نوشتاری',
      stop: 'پایان گفتگوی نوشتاری',
      roles: { user: 'شما', assistant: 'دستیار' },
      waiting: 'تغییرهای پیشنهادی در کارت تأیید پایین صفحه منتظر شماست.',
      notReady: {
        disabled: 'دستیار در تنظیمات خاموش است.',
        disclosure: 'هشدار حریم خصوصی هنوز در تنظیمات دستیار پذیرفته نشده است.',
        executor_not_configured:
          'برای نوشتن، اتصال و مدل متنی را در تنظیمات دستیار انتخاب کنید یا اتصال هوش مصنوعی فضای کار را راه‌اندازی کنید.',
      },
      failures: {
        LIVE_EXECUTOR_NOT_CONFIGURED: 'اتصال و مدل متنی در تنظیمات دستیار انتخاب نشده است.',
        LIVE_ASK_BUSY: 'منتظر پاسخ درخواست قبلی بمانید.',
      },
      failureOther: 'درخواست انجام نشد. دوباره تلاش کنید.',
    },
  },
  history: {
    title: 'گفتگوهای صوتی',
    empty: 'هنوز گفتگوی صوتی‌ای انجام نشده است.',
    loadFailed: 'فهرست گفتگوهای صوتی بارگذاری نشد.',
    open: 'نمایش',
    close: 'بستن',
    minutes: '{n} دقیقه',
    tokens: '{n} توکن',
    cost: '{n} دلار',
    spend: {
      title: 'هزینه',
      day: '۲۴ ساعت گذشته',
      week: '۷ روز گذشته',
      month: '۳۰ روز گذشته',
      ofCap: '{used} دلار از سقف روزانهٔ {cap} دلار',
      typed: 'که {n} دلارش مجرای نوشتاری بود',
      none: 'هنوز هزینه‌ای ثبت نشده است.',
    },
    noMessages: 'متنی برای این گفتگو ذخیره نشده است.',
    noActions: 'تغییری پیشنهاد نشد.',
    transcript: 'متن گفتگو',
    changes: 'تغییرهای پیشنهادی',
    deleteText: 'پاک کردن متن این گفتگو',
    deleteAsk: 'متن این گفتگو برای همیشه پاک شود؟ تغییرهای پیشنهادی و ردپای حسابرسی می‌مانند.',
    deleteYes: 'بله، پاک شود',
    deleteNo: 'نه',
    deleteFailed: 'متن پاک نشد. دوباره تلاش کنید.',
    roles: { user: 'شما', assistant: '{name}' },
    sessionStatus: { active: 'در جریان', ended: 'پایان‌یافته' },
    endReasons: {
      user: 'خاموش‌شده توسط شما',
      idle: 'بیکاری',
      cap_cost: 'سقف هزینه',
      cap_time: 'سقف زمان',
      cap_daily: 'سقف هزینهٔ روزانه',
      disabled: 'خاموش‌شدن در تنظیمات',
      superseded: 'شروع گفتگوی دیگر',
      error: 'خطا',
    },
    actionStatus: {
      proposed: 'منتظر تأیید',
      first_confirmed: 'منتظر تأیید دوم',
      confirmed: 'تأییدشده',
      executed: 'انجام شد',
      failed: 'ناموفق',
      cancelled: 'لغو شد',
      expired: 'مهلت تمام شد',
      refused: 'رد شد',
    },
  },
};

const en: LiveMessages = {
  name: defaultAssistantName.en,
  status: {
    off: 'Off',
    starting: 'Connecting…',
    awake: 'Listening',
    asleep: 'Asleep',
    closing: 'Closing…',
    error: 'Disconnected',
  },
  pill: {
    aria: 'Voice assistant',
    tokens: 'tokens',
    tokensTitle: 'Tokens used in this conversation',
    close: 'Close',
    closeTitle: 'Close and end the live conversation',
    nearCap: 'Near the cap',
    waiting: 'Waiting for you',
  },
  confirm: {
    title: 'Change proposed by {name}',
    tiers: {
      T1: { label: 'Simple change', hint: 'can be undone' },
      T2: { label: 'Consequential change', hint: 'starts or closes work or cost' },
      T3: { label: 'Irreversible', hint: 'needs two separate confirmations' },
    },
    steps: {
      preview: 'Preview',
      readback: 'Read back',
      confirm: 'Your confirmation',
      echo: 'Repeat the name',
    },
    confirmButton: 'Confirm',
    finalButton: 'Final confirmation',
    cancelButton: 'Cancel',
    groupButton: 'Confirm all simple changes ({n})',
    voiceHint: 'Or say "confirm" or "no".',
    echoHint: 'For the final confirmation say the name "{target}", or press "Final confirmation".',
    timeLeft: 'Time left: {time}',
    hints: {
      unclear: 'I did not understand. Say "confirm" or "no" again, or press a button.',
      echo_mismatch: 'That was not the name. Say "{target}" or press "Final confirmation".',
      too_soon: 'Wait a moment and confirm again.',
      closed: 'This change is no longer waiting.',
      failed: 'It was not recorded. Try again.',
    },
    results: {
      executed: 'Done',
      failed: 'Not done',
      cancelled: 'Cancelled',
      expired: 'Timed out',
    },
  },
  card: {
    title: 'Live conversation with {name}',
    intro:
      'Talk to {name} with your voice to get back-office work done. Every change is saved only after you confirm it. The conversation keeps going if you close the Smart window, until you switch it off.',
    start: 'Start live conversation',
    stop: 'Switch off live conversation',
    starting: 'Connecting…',
    closing: 'Closing…',
    unavailable: 'Not available yet: the voice assistant has not been set up in settings.',
    used: 'Used in this session: {n} tokens',
    errors: {
      unavailable: 'The live conversation is not set up yet.',
      other_tab:
        'The live conversation is active in another tab. Switch it off there, or try again here.',
      start_failed: 'Could not connect. Try again.',
      connection_lost: 'The connection dropped and the live conversation was closed.',
      cap_reached:
        'A cost or time cap was reached and the live conversation was closed. The caps can be changed on the assistant settings page.',
      switched_off: 'The voice assistant is switched off in settings or not ready to start.',
    },
    notReady: {
      disabled: 'The voice assistant is switched off in settings.',
      disclosure: 'The privacy notice has not been accepted in the assistant settings yet.',
      not_configured:
        'The voice connection and model are not chosen in the assistant settings yet.',
      no_provider: 'The connection to the voice service is not set up yet.',
    },
    openSettings: 'Open assistant settings',
    nearCap:
      'A cost or time cap is close; the conversation closes by itself when it is reached. The caps can be changed in the assistant settings.',
    typing: {
      start: 'Type instead of speaking',
      intro:
        'Type to {name}. Answers come from your text model, and every change is saved only after you confirm it.',
      placeholder: 'Type your request…',
      send: 'Send',
      thinking: 'Thinking…',
      log: 'Typed conversation',
      stop: 'End typed conversation',
      roles: { user: 'You', assistant: 'Assistant' },
      waiting:
        'Proposed changes are waiting for you on the confirmation card at the bottom of the page.',
      notReady: {
        disabled: 'The assistant is switched off in settings.',
        disclosure: 'The privacy notice has not been accepted in the assistant settings yet.',
        executor_not_configured:
          'To type, choose the text connection and model in the assistant settings, or set up the workspace AI connection.',
      },
      failures: {
        LIVE_EXECUTOR_NOT_CONFIGURED:
          'The text connection and model are not chosen in the assistant settings.',
        LIVE_ASK_BUSY: 'Wait for the answer to the last request.',
      },
      failureOther: 'The request did not work. Try again.',
    },
  },
  history: {
    title: 'Voice conversations',
    empty: 'No voice conversation yet.',
    loadFailed: 'The voice conversations could not be loaded.',
    open: 'Show',
    close: 'Hide',
    minutes: '{n} min',
    tokens: '{n} tokens',
    cost: '${n}',
    spend: {
      title: 'Spending',
      day: 'Last 24 hours',
      week: 'Last 7 days',
      month: 'Last 30 days',
      ofCap: '${used} of the ${cap} daily cap',
      typed: 'of which ${n} was typed requests',
      none: 'Nothing spent yet.',
    },
    noMessages: 'No text was stored for this conversation.',
    noActions: 'No change was proposed.',
    transcript: 'Transcript',
    changes: 'Proposed changes',
    deleteText: 'Delete the text of this conversation',
    deleteAsk:
      'Delete the text of this conversation for good? The proposed changes and the audit trail stay.',
    deleteYes: 'Yes, delete it',
    deleteNo: 'No',
    deleteFailed: 'The text could not be deleted. Try again.',
    roles: { user: 'You', assistant: '{name}' },
    sessionStatus: { active: 'In progress', ended: 'Ended' },
    endReasons: {
      user: 'Switched off by you',
      idle: 'Idle',
      cap_cost: 'Cost cap',
      cap_time: 'Time cap',
      cap_daily: 'Daily cost cap',
      disabled: 'Switched off in settings',
      superseded: 'Another conversation started',
      error: 'Error',
    },
    actionStatus: {
      proposed: 'Waiting for confirmation',
      first_confirmed: 'Waiting for the second confirmation',
      confirmed: 'Confirmed',
      executed: 'Done',
      failed: 'Failed',
      cancelled: 'Cancelled',
      expired: 'Timed out',
      refused: 'Refused',
    },
  },
};

export const liveMessagesFor = (locale: Locale): LiveMessages => (locale === 'fa' ? fa : en);

export const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/gu, (_, key: string) => values[key] ?? '');
