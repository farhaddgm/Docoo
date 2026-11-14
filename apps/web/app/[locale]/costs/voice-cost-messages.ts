import type { Locale } from '../../i18n';

export interface VoiceCostMessages {
  readonly tab: string;
  readonly tabModels: string;
  readonly tabAudio: string;
  readonly tabs: string;
  readonly title: string;
  readonly help: string;
  readonly period: string;
  /** "Last {n} days". */
  readonly lastDays: string;
  readonly loading: string;
  readonly none: string;
  readonly failed: string;
  readonly forbidden: string;
  readonly summary: string;
  readonly byProvider: string;
  readonly byDay: string;
  readonly provider: string;
  readonly kind: string;
  readonly model: string;
  readonly sessions: string;
  readonly minutes: string;
  readonly voiceCost: string;
  readonly typedCost: string;
  readonly total: string;
  readonly perSession: string;
  readonly voiceShare: string;
  readonly tokens: string;
  readonly cached: string;
  readonly day: string;
  readonly dailyCap: string;
  readonly typedOnly: string;
  readonly kinds: Readonly<Record<'realtime' | 'pipeline' | 'text', string>>;
  readonly minutesNote: string;
  /** "Highest day: {day}, {cost}". */
  readonly busiest: string;
}

const fa: VoiceCostMessages = {
  tab: 'دستیار صوتی',
  tabModels: 'مدل‌ها',
  tabAudio: 'مصرف صدا',
  tabs: 'بخش‌های گزارش هزینه',
  title: 'هزینهٔ دستیار صوتی',
  help: 'هزینهٔ گفتگوهای خودتان با دستیار (صوتی و نوشتاری) از قیمت‌های ثبت‌شده؛ هزینهٔ صدا و هزینهٔ درخواست‌های نوشتاری (مجری) جدا شده است. گفتگوهای دیگران در این گزارش نیست.',
  period: 'بازه',
  lastDays: '{n} روز گذشته',
  loading: 'در حال خواندن…',
  none: 'در این بازه گفتگویی با دستیار نبوده است.',
  failed: 'خواندن گزارش انجام نشد.',
  forbidden: 'دسترسی به دستیار صوتی برای این حساب باز نیست.',
  summary: 'خلاصهٔ هزینه',
  byProvider: 'به تفکیک سرویس‌دهنده و مدل',
  byDay: 'به تفکیک روز (UTC)',
  provider: 'سرویس‌دهنده',
  kind: 'نوع',
  model: 'مدل',
  sessions: 'گفتگو',
  minutes: 'دقیقه',
  voiceCost: 'صوتی (دلار)',
  typedCost: 'مجری (دلار)',
  total: 'جمع (دلار)',
  perSession: 'میانگین هر گفتگو',
  voiceShare: 'سهم صدا',
  tokens: 'توکن',
  cached: 'توکن از حافظهٔ نهان',
  day: 'روز',
  dailyCap: 'سقف روزانه',
  typedOnly: 'نوشتاری (بدون صدا)',
  kinds: { realtime: 'صدا به صدا', pipeline: 'خط لوله', text: 'نوشتاری' },
  minutesNote:
    'دقیقه‌ها از آغاز تا پایان گفتگو شمرده می‌شوند و زمان خواب را هم دربر دارند؛ در خواب پیوند صوتی هزینه‌ای ندارد.',
  busiest: 'پرهزینه‌ترین روز: {day}، {cost}',
};

const en: VoiceCostMessages = {
  tab: 'Voice assistant',
  tabModels: 'Models',
  tabAudio: 'Audio usage',
  tabs: 'Cost report sections',
  title: 'Voice assistant cost',
  help: 'What your own conversations with the assistant (voice and typed) cost, from the prices on record; the voice and the typed requests (the executor) are shown apart. Other people’s conversations are not in this report.',
  period: 'Period',
  lastDays: 'Last {n} days',
  loading: 'Loading…',
  none: 'There were no conversations with the assistant in this period.',
  failed: 'The report could not be read.',
  forbidden: 'This account has no access to the voice assistant.',
  summary: 'Cost summary',
  byProvider: 'By provider and model',
  byDay: 'By day (UTC)',
  provider: 'Provider',
  kind: 'Kind',
  model: 'Model',
  sessions: 'Conversations',
  minutes: 'Minutes',
  voiceCost: 'Voice (USD)',
  typedCost: 'Executor (USD)',
  total: 'Total (USD)',
  perSession: 'Average per conversation',
  voiceShare: 'Voice share',
  tokens: 'Tokens',
  cached: 'Cached input tokens',
  day: 'Day',
  dailyCap: 'Daily cap',
  typedOnly: 'Typed (no voice)',
  kinds: { realtime: 'Speech to speech', pipeline: 'Pipeline', text: 'Typed' },
  minutesNote:
    'Minutes run from the start to the end of a conversation and include time asleep; a sleeping voice link costs nothing.',
  busiest: 'Highest day: {day}, {cost}',
};

export const voiceCostMessagesFor = (locale: Locale): VoiceCostMessages =>
  locale === 'fa' ? fa : en;
