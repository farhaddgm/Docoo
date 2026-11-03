import type { Locale } from '../i18n';
import type { LiveError, LiveStatus } from './state';

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
  };
  readonly card: {
    readonly title: string;
    readonly intro: string;
    readonly start: string;
    readonly stop: string;
    readonly starting: string;
    readonly closing: string;
    readonly unavailable: string;
    readonly used: string;
    readonly errors: Record<LiveError, string>;
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
    },
  },
};

export const liveMessagesFor = (locale: Locale): LiveMessages => (locale === 'fa' ? fa : en);

export const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/gu, (_, key: string) => values[key] ?? '');
