import { z } from 'zod';

/**
 * Monitors (ADR-0056): read-only windows the owner puts on a room screen. Everything here is pure.
 * One list defines every setting (its key, kind, allowed values, default and both descriptions);
 * the migration that seeds the settings, the settings page and the server all read it, and a test
 * keeps the migration equal to it.
 *
 * The defaults are the "room" profile, the most careful one: a guest in the room sees the steps of
 * the work, but no cost, tokens, model or assistant transcript until the owner turns them on.
 */

export const monitorKinds = ['voice', 'viewer'] as const;
export type MonitorKind = (typeof monitorKinds)[number];

/** The profiles the owner starts from; `custom` is what the settings become once one is edited. */
export const monitorPresets = ['room', 'team', 'personal'] as const;
export type MonitorPreset = (typeof monitorPresets)[number];
export const monitorPresetChoices = [...monitorPresets, 'custom'] as const;
export type MonitorPresetChoice = (typeof monitorPresetChoices)[number];

/** Bounds the settings page enforces and the migration repeats. */
export const monitorLimits = {
  delayS: { min: 0, max: 30 },
  refreshS: { min: 2, max: 10 },
  maxPlayHours: { min: 1, max: 24 },
  idleBlankMin: { min: 0, max: 240 },
  fontScale: { min: 1, max: 2 },
  blockedWords: { maxItems: 100, maxLength: 60 },
} as const;

/** The delays the page offers; the setting accepts any whole number inside its bounds. */
export const monitorDelayChoices = [0, 3, 5, 10, 30] as const;

export type MonitorSettingValue = boolean | number | string | string[];

interface Described {
  readonly fa: string;
  readonly en: string;
}

export type MonitorSettingDefinition = Described & {
  readonly key: string;
  /** The page section the row belongs to. */
  readonly group: 'general' | 'viewer' | 'voice';
} & (
    | { readonly kind: 'boolean'; readonly default: boolean }
    | {
        readonly kind: 'choice';
        readonly options: readonly string[];
        readonly default: string;
      }
    | {
        readonly kind: 'integer';
        readonly min: number;
        readonly max: number;
        readonly default: number;
      }
    | {
        readonly kind: 'number';
        readonly min: number;
        readonly max: number;
        readonly default: number;
      }
    | { readonly kind: 'uuid'; readonly default: string }
    | {
        readonly kind: 'words';
        readonly maxItems: number;
        readonly maxLength: number;
        readonly default: string[];
      }
  );

type Group = MonitorSettingDefinition['group'];

// The helpers keep each key as a literal type, so `MonitorSettingKey` is the union of the real keys.
const bool = <K extends string>(group: Group, key: K, fallback: boolean, fa: string, en: string) =>
  ({ group, key, kind: 'boolean', default: fallback, fa, en }) as const;

const choice = <K extends string>(
  group: Group,
  key: K,
  options: readonly string[],
  fallback: string,
  fa: string,
  en: string,
) => ({ group, key, kind: 'choice', options, default: fallback, fa, en }) as const;

const whole = <K extends string>(
  group: Group,
  key: K,
  range: { readonly min: number; readonly max: number },
  fallback: number,
  fa: string,
  en: string,
) =>
  ({
    group,
    key,
    kind: 'integer',
    min: range.min,
    max: range.max,
    default: fallback,
    fa,
    en,
  }) as const;

/** Every monitor setting, in the order the settings page shows them (ADR-0056 §8). */
export const monitorSettingDefinitions = [
  // -- general: switches, safety and look --------------------------------------------------------
  bool(
    'general',
    'monitor.disclosure_accepted',
    false,
    'مالک پذیرفته است که هر چیزی که نمایشگر نشان می‌دهد برای همهٔ حاضران در اتاق دیده می‌شود',
    'The owner accepts that everything a monitor shows can be seen by everyone in the room',
  ),
  bool(
    'general',
    'monitor.viewer.enabled',
    false,
    'نمایشگر بیننده (برای حاضران اتاق) روشن باشد',
    'The viewer monitor (for people in the room) is on',
  ),
  bool(
    'general',
    'monitor.voice.enabled',
    false,
    'نمایشگر دستیار صوتی روشن باشد',
    'The voice assistant monitor is on',
  ),
  choice(
    'general',
    'monitor.preset',
    monitorPresetChoices,
    'room',
    'پروفایل آماده: اتاق جلسه، تیم، شخصی یا سفارشی',
    'Ready profile: meeting room, team, personal or custom',
  ),
  whole(
    'general',
    'monitor.delay_s',
    monitorLimits.delayS,
    3,
    'تأخیر عمدی نمایش (ثانیه) تا مالک فرصت سیاه‌کردن داشته باشد',
    'Deliberate display delay (seconds) so the owner has time to black the screen out',
  ),
  choice(
    'general',
    'monitor.redaction',
    ['standard', 'strict'],
    'strict',
    'پاک‌سازی خودکار متن‌ها: استاندارد یا سخت‌گیر (خاموش‌شدنی نیست)',
    'Automatic masking of text: standard or strict (cannot be turned off)',
  ),
  {
    group: 'general',
    key: 'monitor.blocked_words',
    kind: 'words',
    maxItems: monitorLimits.blockedWords.maxItems,
    maxLength: monitorLimits.blockedWords.maxLength,
    default: [],
    fa: 'واژه‌های ممنوع، مثل نام مشتری: هر جا در متن بیاید پوشانده می‌شود',
    en: 'Blocked words, such as a client name: wherever one appears in a text it is masked',
  },
  whole(
    'general',
    'monitor.refresh_s',
    monitorLimits.refreshS,
    3,
    'هر چند ثانیه نمایشگر خودش را تازه کند',
    'How often the monitor refreshes itself, in seconds',
  ),
  whole(
    'general',
    'monitor.max_play_hours',
    monitorLimits.maxPlayHours,
    8,
    'پنجرهٔ نمایشگر پس از این تعداد ساعت خودش بسته می‌شود',
    'A monitor window closes itself after this many hours',
  ),
  whole(
    'general',
    'monitor.idle_blank_min',
    monitorLimits.idleBlankMin,
    30,
    'اگر این تعداد دقیقه چیز تازه‌ای نبود صفحهٔ آرام نشان بده (۰: هیچ‌وقت)',
    'Show a calm screen when nothing new happened for this many minutes (0: never)',
  ),
  bool(
    'general',
    'monitor.live_badge',
    true,
    'برچسب «پخش زنده» گوشهٔ صفحه نمایش داده شود',
    'Show a "live" badge in the corner of the screen',
  ),
  choice(
    'general',
    'monitor.watermark',
    ['none', 'name', 'name_time'],
    'name_time',
    'نشان کم‌رنگ روی صفحه: هیچ، نام، یا نام و زمان',
    'A faint mark on the screen: none, name, or name and time',
  ),
  choice(
    'general',
    'monitor.theme',
    ['dark', 'light', 'auto'],
    'dark',
    'پوستهٔ نمایشگر: تیره، روشن یا خودکار',
    'Monitor theme: dark, light or automatic',
  ),
  {
    group: 'general',
    key: 'monitor.font_scale',
    kind: 'number',
    min: monitorLimits.fontScale.min,
    max: monitorLimits.fontScale.max,
    default: 1.5,
    fa: 'اندازهٔ نوشته‌ها روی نمایشگر (۱ تا ۲ برابر)',
    en: 'Size of the text on the monitor (1 to 2 times)',
  },
  choice(
    'general',
    'monitor.language',
    ['ui', 'fa', 'en'],
    'ui',
    'زبان نمایشگر: همان زبان رابط، فارسی یا انگلیسی',
    'Monitor language: the interface language, Persian or English',
  ),
  bool(
    'general',
    'monitor.preview_before_open',
    true,
    'پیش از باز شدن نمایشگر، خلاصهٔ «حاضران چه می‌بینند» نشان داده شود و مالک تأیید کند',
    'Before a monitor opens, show a summary of what the people in the room will see and ask the owner to confirm',
  ),

  // -- viewer monitor: what the people in the room see ------------------------------------------
  {
    group: 'viewer',
    key: 'monitor.viewer.project_id',
    kind: 'uuid',
    default: '',
    fa: 'پروژه‌ای که روی پروژکتور است (با دکمهٔ «نمایش روی پروژکتور» انتخاب می‌شود؛ خالی: هیچ)',
    en: 'The project on the projector (chosen with the "show on the projector" button; empty: none)',
  },
  choice(
    'viewer',
    'monitor.viewer.project_name',
    ['real', 'code', 'hidden'],
    'real',
    'نام پروژه روی نمایشگر: نام واقعی، فقط کد یا پنهان',
    'Project name on the monitor: the real name, only the code, or hidden',
  ),
  choice(
    'viewer',
    'monitor.viewer.business_name',
    ['hidden', 'shown'],
    'hidden',
    'نام کسب‌وکار (مشتری) پروژه نمایش داده شود',
    'Show the business (client) name of the project',
  ),
  choice(
    'viewer',
    'monitor.viewer.topic_names',
    ['hidden', 'shown'],
    'shown',
    'حوزه‌های موضوعی پروژه نمایش داده شوند',
    'Show the topic areas of the project',
  ),
  choice(
    'viewer',
    'monitor.viewer.stage_detail',
    ['status', 'times', 'attempts'],
    'times',
    'جزئیات مرحله‌ها: فقط وضعیت، با زمان، یا با زمان و تعداد تلاش',
    'Stage detail: status only, with times, or with times and attempts',
  ),
  choice(
    'viewer',
    'monitor.viewer.stage_outputs',
    ['hidden', 'title', 'excerpt', 'full'],
    'full',
    'خروجی هر مرحله: پنهان، عنوان، گزیده یا متن کامل',
    'Output of each stage: hidden, title, excerpt or full text',
  ),
  choice(
    'viewer',
    'monitor.viewer.documents',
    ['hidden', 'names', 'preview'],
    'preview',
    'اسناد تولیدشده: پنهان، فقط نام یا پیش‌نمایش',
    'Documents produced: hidden, names only or a preview',
  ),
  choice(
    'viewer',
    'monitor.viewer.quality_scores',
    ['hidden', 'pass_fail', 'score'],
    'score',
    'نتیجهٔ ارزیابی کیفیت: پنهان، قبول یا رد، یا نمره',
    'Quality evaluation result: hidden, pass or fail, or the score',
  ),
  choice(
    'viewer',
    'monitor.viewer.research_sources',
    ['hidden', 'count', 'domains', 'full'],
    'full',
    'منابع تحقیق: پنهان، تعداد، نام سایت‌ها یا ارجاع کامل',
    'Research sources: hidden, a count, site names or full citations',
  ),
  choice(
    'viewer',
    'monitor.viewer.human_gates',
    ['hidden', 'status', 'names'],
    'status',
    'تأیید انسانی: پنهان، فقط وضعیت یا با تأییدکننده',
    'Human approval: hidden, status only or with the approver',
  ),
  choice(
    'viewer',
    'monitor.viewer.agents',
    ['hidden', 'roles', 'roles_actions'],
    'roles_actions',
    'عملکرد عامل‌ها: پنهان، فقط نقش‌ها یا نقش و کار جاری',
    'Agent activity: hidden, roles only or roles and current work',
  ),
  choice(
    'viewer',
    'monitor.viewer.assistant_activity',
    ['hidden', 'status', 'steps', 'steps_targets'],
    'steps',
    'کار دستیار: پنهان، فقط وضعیت، مراحل کار یا مراحل با نام هدف',
    'Assistant work: hidden, status only, steps or steps with their targets',
  ),
  choice(
    'viewer',
    'monitor.viewer.assistant_transcript',
    ['hidden', 'assistant_only', 'full'],
    'hidden',
    'گفتگوی دستیار: پنهان، فقط پاسخ‌های دستیار یا کامل',
    'Assistant conversation: hidden, only the assistant replies or in full',
  ),
  choice(
    'viewer',
    'monitor.viewer.model_info',
    ['hidden', 'family', 'full'],
    'hidden',
    'AI و مدل: پنهان، فقط ارائه‌دهنده یا ارائه‌دهنده و مدل',
    'AI and model: hidden, provider only or provider and model',
  ),
  choice(
    'viewer',
    'monitor.viewer.tokens',
    ['hidden', 'total', 'split'],
    'hidden',
    'توکن مصرفی: پنهان، مجموع یا تفکیک ورودی و خروجی',
    'Tokens used: hidden, a total or split into input and output',
  ),
  choice(
    'viewer',
    'monitor.viewer.cost',
    ['hidden', 'total', 'detailed'],
    'hidden',
    'هزینه: پنهان، مجموع پروژه یا با ریز',
    'Cost: hidden, the project total or itemised',
  ),
  choice(
    'viewer',
    'monitor.viewer.errors',
    ['hidden', 'generic', 'message'],
    'message',
    'خطاها: پنهان، پیام عمومی یا پیام خطا (پس از پاک‌سازی)',
    'Errors: hidden, a generic notice or the message (after masking)',
  ),
  choice(
    'viewer',
    'monitor.viewer.people',
    ['hidden', 'role', 'first_name', 'full_name'],
    'role',
    'نام افراد: پنهان، فقط نقش، نام کوچک یا نام کامل',
    'People: hidden, role only, first name or full name',
  ),
  choice(
    'viewer',
    'monitor.viewer.timestamps',
    ['hidden', 'relative', 'clock'],
    'relative',
    'زمان رویدادها: پنهان، نسبی («۲ دقیقه پیش») یا ساعت',
    'Event times: hidden, relative ("2 minutes ago") or the clock time',
  ),

  // -- voice assistant monitor -------------------------------------------------------------------
  choice(
    'voice',
    'monitor.voice.sessions',
    ['live', 'today', 'recent', 'all'],
    'live',
    'گفتگوهای قابل مشاهده: فقط زنده، ۲۴ ساعت اخیر، ۱۰ تای آخر یا همه',
    'Conversations shown: only the live one, the last 24 hours, the last 10 or all',
  ),
  choice(
    'voice',
    'monitor.voice.transcript',
    ['hidden', 'assistant_only', 'full'],
    'hidden',
    'متن گفتگو: پنهان (فقط متادیتا و هزینه)، فقط پاسخ‌های دستیار یا کامل',
    'Conversation text: hidden (metadata and cost only), only the assistant replies or in full',
  ),
  choice(
    'voice',
    'monitor.voice.action_cards',
    ['hidden', 'summary', 'detail'],
    'summary',
    'کارت‌های اقدام دستیار: پنهان، خلاصه یا با جزئیات',
    'Assistant action cards: hidden, a summary or with detail',
  ),
  choice(
    'voice',
    'monitor.voice.model_info',
    ['hidden', 'provider', 'model', 'all'],
    'hidden',
    'AI و مدل: پنهان، ارائه‌دهنده، ارائه‌دهنده و مدل یا همه (صدا، زبان، روش)',
    'AI and model: hidden, provider, provider and model, or all (voice, language, mode)',
  ),
  choice(
    'voice',
    'monitor.voice.tokens',
    ['hidden', 'total', 'split', 'split_executor'],
    'hidden',
    'توکن مصرفی: پنهان، مجموع، ورودی و خروجی و کش، یا با تفکیک مجری',
    'Tokens used: hidden, a total, input/output/cache, or also split by executor',
  ),
  choice(
    'voice',
    'monitor.voice.cost',
    ['hidden', 'session', 'session_day', 'with_caps'],
    'hidden',
    'هزینه: پنهان، نشست، نشست و ۲۴ ساعت اخیر، یا با سقف‌ها و ۳۰ روز اخیر',
    'Cost: hidden, the session, session and the last 24 hours, or with the caps and the last 30 days',
  ),
  choice(
    'voice',
    'monitor.voice.cost_flag',
    ['always', 'unpriced'],
    'always',
    'برچسب «تخمینی» کنار هزینه: همیشه یا فقط برای مصرف بی‌قیمت',
    'The "estimate" label next to the cost: always, or only for unpriced use',
  ),
  bool(
    'voice',
    'monitor.voice.live_indicators',
    true,
    'حلقهٔ وضعیت و موج صدا نمایش داده شود',
    'Show the status ring and the sound wave',
  ),
  bool(
    'voice',
    'monitor.voice.end_reason',
    true,
    'دلیل پایان هر گفتگو نمایش داده شود',
    'Show why each conversation ended',
  ),
  choice(
    'voice',
    'monitor.voice.access_info',
    ['hidden', 'scope', 'scope_level'],
    'hidden',
    'دسترسی دستیار: پنهان، فقط دامنه یا دامنه و سطح',
    'Assistant access: hidden, scope only or scope and level',
  ),
  choice(
    'voice',
    'monitor.voice.caps',
    ['hidden', 'percent', 'amounts'],
    'percent',
    'سقف‌های مصرف: پنهان، درصد مصرف یا مقدار سقف',
    'Usage caps: hidden, the percentage used or the cap amounts',
  ),
  choice(
    'voice',
    'monitor.voice.people',
    ['hidden', 'role', 'first_name', 'full_name'],
    'role',
    'نام کاربر گفتگو: پنهان، فقط نقش، نام کوچک یا نام کامل',
    'Who spoke: hidden, role only, first name or full name',
  ),
  bool(
    'viewer',
    'monitor.viewer.use_alias',
    true,
    'اگر پروژه نام نمایشی دارد، به‌جای نام واقعی آن روی نمایشگر بیننده نمایش داده شود',
    'When a project has a display name, show it on the viewer monitor instead of the real name',
  ),
] as const satisfies readonly MonitorSettingDefinition[];

export type MonitorSettingKey = (typeof monitorSettingDefinitions)[number]['key'];

export const monitorSettingKeys = monitorSettingDefinitions.map(
  (definition) => definition.key,
) as readonly MonitorSettingKey[];

export const monitorSettingDefaults: Readonly<Record<MonitorSettingKey, MonitorSettingValue>> =
  Object.fromEntries(
    monitorSettingDefinitions.map((definition) => [
      definition.key,
      Array.isArray(definition.default) ? [...definition.default] : definition.default,
    ]),
  ) as Record<MonitorSettingKey, MonitorSettingValue>;

const definitionOf = (key: MonitorSettingKey): MonitorSettingDefinition => {
  const found = (monitorSettingDefinitions as readonly MonitorSettingDefinition[]).find(
    (definition) => definition.key === key,
  );
  if (!found) throw new Error(`unknown monitor setting ${key}`);
  return found;
};

// ---------------------------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------------------------

/**
 * The settings a profile decides: room, team, personal. Every other setting keeps its own value
 * when a profile is picked. The first column is the default of the setting itself.
 */
const profileTable: readonly (readonly [
  MonitorSettingKey,
  MonitorSettingValue,
  MonitorSettingValue,
  MonitorSettingValue,
])[] = [
  ['monitor.delay_s', 3, 0, 0],
  ['monitor.redaction', 'strict', 'standard', 'standard'],
  ['monitor.viewer.business_name', 'hidden', 'shown', 'shown'],
  ['monitor.viewer.assistant_transcript', 'hidden', 'assistant_only', 'full'],
  ['monitor.viewer.model_info', 'hidden', 'full', 'full'],
  ['monitor.viewer.tokens', 'hidden', 'total', 'split'],
  ['monitor.viewer.cost', 'hidden', 'total', 'detailed'],
  ['monitor.viewer.people', 'role', 'first_name', 'full_name'],
  ['monitor.voice.transcript', 'hidden', 'assistant_only', 'full'],
  ['monitor.voice.model_info', 'hidden', 'all', 'all'],
  ['monitor.voice.tokens', 'hidden', 'total', 'split_executor'],
  ['monitor.voice.cost', 'hidden', 'session', 'with_caps'],
  ['monitor.voice.people', 'role', 'first_name', 'full_name'],
];

/** The settings a profile decides, so the page can tell the owner which rows a profile changes. */
export const monitorPresetKeys: readonly MonitorSettingKey[] = profileTable.map((row) => row[0]);

/** The values a profile gives to the settings it decides. */
export function monitorPresetValues(
  preset: MonitorPreset,
): Readonly<Partial<Record<MonitorSettingKey, MonitorSettingValue>>> {
  const column = monitorPresets.indexOf(preset) + 1;
  return Object.fromEntries(
    profileTable.map((row) => [row[0], row[column] as MonitorSettingValue]),
  );
}

/** The profile whose values the settings match exactly, or `custom` when none does. */
export function detectMonitorPreset(
  values: Readonly<Partial<Record<MonitorSettingKey, unknown>>>,
): MonitorPresetChoice {
  const current = (key: MonitorSettingKey) => values[key] ?? monitorSettingDefaults[key];
  for (const preset of monitorPresets) {
    const wanted = monitorPresetValues(preset);
    if (monitorPresetKeys.every((key) => current(key) === wanted[key])) return preset;
  }
  return 'custom';
}

// ---------------------------------------------------------------------------------------------
// Reading the settings
// ---------------------------------------------------------------------------------------------

/** Trimmed, no empty entries, no repeats (ignoring case), and within the list bounds. */
export function normalizeBlockedWords(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const words: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const word = item.trim();
    const folded = word.toLocaleLowerCase('en');
    if (word === '' || word.length > monitorLimits.blockedWords.maxLength || seen.has(folded)) {
      continue;
    }
    seen.add(folded);
    words.push(word);
    if (words.length === monitorLimits.blockedWords.maxItems) break;
  }
  return words;
}

const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Whether a value is allowed for a setting (the same rule the server applies when saving). */
export function isMonitorSettingValue(key: MonitorSettingKey, value: unknown): boolean {
  const definition = definitionOf(key);
  switch (definition.kind) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'choice':
      return typeof value === 'string' && definition.options.includes(value);
    case 'integer':
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= definition.min &&
        value <= definition.max
      );
    case 'number':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= definition.min &&
        value <= definition.max
      );
    case 'uuid':
      return typeof value === 'string' && (value === '' || UUID_VALUE.test(value));
    case 'words':
      return (
        Array.isArray(value) &&
        value.length <= definition.maxItems &&
        value.every(
          (item) =>
            typeof item === 'string' && item.length >= 1 && item.length <= definition.maxLength,
        )
      );
  }
}

/**
 * Every monitor setting, taken from the saved values: a missing or unusable value gives the
 * default, which is the careful choice (hidden, strict), never a wider one.
 */
export function monitorSettingsFrom(
  values: Readonly<Record<string, unknown>>,
): Record<MonitorSettingKey, MonitorSettingValue> {
  const result = { ...monitorSettingDefaults } as Record<MonitorSettingKey, MonitorSettingValue>;
  for (const key of monitorSettingKeys) {
    const value = values[key];
    if (value !== undefined && isMonitorSettingValue(key, value)) result[key] = value as never;
  }
  result['monitor.blocked_words'] = normalizeBlockedWords(result['monitor.blocked_words']);
  return result;
}

// ---------------------------------------------------------------------------------------------
// The server's answers and the owner's controls
// ---------------------------------------------------------------------------------------------

/** What a monitor window reads before it shows anything. */
export interface MonitorClientConfig {
  readonly viewerEnabled: boolean;
  readonly voiceEnabled: boolean;
  readonly settings: Readonly<Record<MonitorSettingKey, MonitorSettingValue>>;
}

/** What the owner can do to the monitors from the back office (freezing comes with real content). */
export const monitorControlEvents = ['opened', 'closed', 'blackout', 'resumed', 'stopped'] as const;
export type MonitorControlEvent = (typeof monitorControlEvents)[number];

/** A control the owner used; the audit trail keeps what and which monitor, never any content. */
export const reportMonitorEventSchema = z.object({
  event: z.enum(monitorControlEvents),
  kind: z.enum([...monitorKinds, 'all']),
});
export type ReportMonitorEvent = z.infer<typeof reportMonitorEventSchema>;

/** The display name of a project on the monitors; empty removes it. */
export const monitorAliasSchema = z.strictObject({
  alias: z.string().trim().max(80),
});
export type MonitorAliasInput = z.infer<typeof monitorAliasSchema>;
