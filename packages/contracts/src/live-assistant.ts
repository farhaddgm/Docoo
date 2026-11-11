import { z } from 'zod';

/**
 * Live voice assistant policy (ADR-0055). Everything here is pure and independent of any speech
 * provider: which parts of the back office the assistant may touch, how strictly each kind of
 * change must be confirmed, how a spoken confirmation is read, and when a cap stops a session.
 * The models only ever ask; this code decides.
 *
 * Nothing in this file names the assistant: its display name, spoken name and wake phrase are
 * settings, so renaming it never touches code.
 */

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

/** The setting keys of the assistant page, in the order the page shows them (ADR-0055 §4-8). */
export const liveAssistantSettingKeys = [
  'live_assistant.enabled',
  'live_assistant.disclosure_accepted',
  'live_assistant.display_name',
  'live_assistant.spoken_name',
  'live_assistant.wake_enabled',
  'live_assistant.wake_phrase',
  // One access rule, as four plain settings: the settings validator knows scalars and lists of
  // scalars only. The rule model (a list of rules) stays; `accessRulesFromSettings` builds it.
  'live_assistant.access_scope',
  'live_assistant.access_level',
  'live_assistant.access_project_ids',
  'live_assistant.access_include_current',
  'live_assistant.mode',
  'live_assistant.connection_id',
  'live_assistant.model',
  'live_assistant.voice_id',
  'live_assistant.language',
  'live_assistant.executor_connection_id',
  'live_assistant.executor_model',
  'live_assistant.listening_mode',
  'live_assistant.idle_sleep_s',
  'live_assistant.session_max_minutes',
  'live_assistant.session_cost_cap_usd',
  'live_assistant.daily_cost_cap_usd',
  'live_assistant.task_cost_cap_usd',
  'live_assistant.max_actions_per_task',
  'live_assistant.confirm_timeout_s',
  'live_assistant.confirm_strictness',
  'live_assistant.t3_categories',
  'live_assistant.store_transcripts',
  'live_assistant.transcript_retention_days',
  'live_assistant.store_audio',
] as const;
export type LiveAssistantSettingKey = (typeof liveAssistantSettingKeys)[number];

/** Bounds the page enforces; the provider's own session limit is 60 minutes (ADR-0055 §3). */
export const liveAssistantLimits = {
  idleSleepS: { min: 30, max: 1800 },
  sessionMaxMinutes: { min: 5, max: 55 },
  sessionCostCapUsd: { min: 0.5, max: 100 },
  dailyCostCapUsd: { min: 1, max: 500 },
  taskCostCapUsd: { min: 0.05, max: 20 },
  maxActionsPerTask: { min: 1, max: 25 },
  confirmTimeoutS: { min: 30, max: 1800 },
  transcriptRetentionDays: { min: 1, max: 3650 },
} as const;

/** Proposed defaults (ADR-0055 §4-8 e). The owner changes them; phase 0 replaces the guesses. */
export const liveAssistantDefaults = {
  idleSleepS: 120,
  sessionMaxMinutes: 30,
  sessionCostCapUsd: 5,
  dailyCostCapUsd: 20,
  taskCostCapUsd: 1,
  maxActionsPerTask: 8,
  confirmTimeoutS: 300,
  transcriptRetentionDays: 90,
} as const;

export const liveAssistantModes = ['realtime', 'pipeline'] as const;

/**
 * The brands that can carry the assistant's voice (ADR-0057). OpenAI hears and speaks itself
 * (`realtime`); ElevenLabs is a pipeline: it hears (Scribe), Docoo's own executor answers, and it
 * speaks (Eleven v4). The brand is taken from the provider connection the admin chose.
 */
export const liveVoiceProviders = ['openai', 'elevenlabs'] as const;
export type LiveVoiceProvider = (typeof liveVoiceProviders)[number];

export function isLiveVoiceProvider(value: string): value is LiveVoiceProvider {
  return (liveVoiceProviders as readonly string[]).includes(value);
}

/** The kind of session a brand runs; what the settings say about the mode only applies to OpenAI. */
export function voiceModeOf(provider: LiveVoiceProvider): 'realtime' | 'pipeline' {
  return provider === 'elevenlabs' ? 'pipeline' : 'realtime';
}

/** The hearing model of the ElevenLabs pipeline; Docoo fixes it (the chosen model is the speaking one). */
export const ELEVENLABS_STT_MODEL = 'scribe_v3_live';
/** The speaking model suggested for the ElevenLabs pipeline: the only family documented with Persian. */
export const ELEVENLABS_DEFAULT_TTS_MODEL = 'eleven_v4_turbo';

/**
 * What a pipeline costs when no price is entered for a model: deliberately above the list price
 * (0.22 USD per hour of hearing, 0.04 USD per 1000 characters spoken) so a missing price can never
 * switch the cost caps off.
 */
export const PIPELINE_FALLBACK_PRICE = {
  sttPerMinute: 0.01,
  ttsPer1kCharacters: 0.15,
} as const;

export interface PipelinePrice {
  readonly sttPerMinute: number | null;
  readonly ttsPer1kCharacters: number | null;
}

/**
 * The cost of a stretch of pipeline use: seconds heard times the price per minute, plus characters
 * spoken times the price per 1000. A component without a price uses the fallback; the result is
 * rounded to a millionth of a dollar so adding many small steps leaves no floating-point dust.
 */
export function pipelineCostUsd(
  usage: { readonly audioSeconds?: number | undefined; readonly characters?: number | undefined },
  price: PipelinePrice | null,
): number {
  const seconds = Math.max(0, usage.audioSeconds ?? 0);
  const characters = Math.max(0, usage.characters ?? 0);
  const stt = price?.sttPerMinute ?? PIPELINE_FALLBACK_PRICE.sttPerMinute;
  const tts = price?.ttsPer1kCharacters ?? PIPELINE_FALLBACK_PRICE.ttsPer1kCharacters;
  const cost = (seconds / 60) * stt + (characters / 1000) * tts;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
export const liveAssistantLanguages = ['fa', 'en', 'auto'] as const;
export const liveAssistantListeningModes = ['always', 'push_to_talk'] as const;
export const confirmStrictnessLevels = ['standard', 'strict'] as const;
export const accessScopeModes = ['all_projects', 'selected_projects', 'backoffice'] as const;

/**
 * What each setting is before the owner touches it. The migration seeds the same values, and a
 * test keeps the two equal. The assistant starts off, reading the projects area only.
 */
export const liveAssistantSettingDefaults = {
  'live_assistant.enabled': false,
  'live_assistant.disclosure_accepted': false,
  'live_assistant.display_name': 'Docoo',
  'live_assistant.spoken_name': 'داکو',
  'live_assistant.wake_enabled': false,
  'live_assistant.wake_phrase': 'Hi Docoo',
  'live_assistant.access_scope': 'all_projects',
  'live_assistant.access_level': 'read',
  'live_assistant.access_project_ids': [] as string[],
  'live_assistant.access_include_current': false,
  'live_assistant.mode': 'realtime',
  'live_assistant.connection_id': '',
  'live_assistant.model': '',
  'live_assistant.voice_id': '',
  'live_assistant.language': 'fa',
  'live_assistant.executor_connection_id': '',
  'live_assistant.executor_model': '',
  'live_assistant.listening_mode': 'always',
  'live_assistant.idle_sleep_s': 120,
  'live_assistant.session_max_minutes': 30,
  'live_assistant.session_cost_cap_usd': 5,
  'live_assistant.daily_cost_cap_usd': 20,
  'live_assistant.task_cost_cap_usd': 1,
  'live_assistant.max_actions_per_task': 8,
  'live_assistant.confirm_timeout_s': 300,
  'live_assistant.confirm_strictness': 'standard',
  'live_assistant.t3_categories': [] as string[],
  'live_assistant.store_transcripts': true,
  'live_assistant.transcript_retention_days': 90,
  'live_assistant.store_audio': false,
} as const satisfies Record<LiveAssistantSettingKey, unknown>;

export type LiveAssistantSettingValues = Partial<Record<LiveAssistantSettingKey, unknown>>;

const bounded = (range: { readonly min: number; readonly max: number }) =>
  z.number().min(range.min).max(range.max);

export const liveAssistantCapsSchema = z.object({
  idleSleepS: bounded(liveAssistantLimits.idleSleepS),
  sessionMaxMinutes: bounded(liveAssistantLimits.sessionMaxMinutes),
  sessionCostCapUsd: bounded(liveAssistantLimits.sessionCostCapUsd),
  dailyCostCapUsd: bounded(liveAssistantLimits.dailyCostCapUsd),
  taskCostCapUsd: bounded(liveAssistantLimits.taskCostCapUsd),
  maxActionsPerTask: bounded(liveAssistantLimits.maxActionsPerTask).int(),
  confirmTimeoutS: bounded(liveAssistantLimits.confirmTimeoutS),
});
export type LiveAssistantCaps = z.infer<typeof liveAssistantCapsSchema>;

// ---------------------------------------------------------------------------------------------
// Access: scope x level
// ---------------------------------------------------------------------------------------------

/** What an access rule reaches: the whole back office, every project, or chosen projects. */
export const assistantAccessScopeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('backoffice') }),
  z.object({ mode: z.literal('all_projects') }),
  z.object({
    mode: z.literal('selected_projects'),
    projectIds: z.array(z.uuid()).max(200),
    /** Also the project the owner has open right now. */
    includeCurrent: z.boolean(),
  }),
]);
export type AssistantAccessScope = z.infer<typeof assistantAccessScopeSchema>;

/** `read`: look, explain, analyse, navigate. `act`: also change things, each with a confirmation. */
export const assistantAccessLevels = ['read', 'act'] as const;
export type AssistantAccessLevel = (typeof assistantAccessLevels)[number];

export const assistantAccessRuleSchema = z.object({
  scope: assistantAccessScopeSchema,
  level: z.enum(assistantAccessLevels),
});
export type AssistantAccessRule = z.infer<typeof assistantAccessRuleSchema>;

export const assistantAccessRulesSchema = z.array(assistantAccessRuleSchema).min(1).max(20);

/** First activation: look at the projects area only. The owner raises this on purpose. */
export const defaultAssistantAccessRules = (): AssistantAccessRule[] => [
  { scope: { mode: 'all_projects' }, level: 'read' },
];

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * The access rule the owner set on the assistant page, built from its four plain settings. A
 * missing value means the default; a value that no longer makes sense (an unknown scope or level)
 * gives no rule at all, so the assistant can do nothing rather than something unintended.
 */
export function accessRulesFromSettings(values: LiveAssistantSettingValues): AssistantAccessRule[] {
  const pick = <K extends LiveAssistantSettingKey>(key: K): unknown =>
    values[key] === undefined ? liveAssistantSettingDefaults[key] : values[key];
  const scope = pick('live_assistant.access_scope');
  const level = pick('live_assistant.access_level');
  const parsedLevel = z.enum(assistantAccessLevels).safeParse(level);
  if (!parsedLevel.success) return [];
  switch (scope) {
    case 'backoffice':
      return [{ scope: { mode: 'backoffice' }, level: parsedLevel.data }];
    case 'all_projects':
      return [{ scope: { mode: 'all_projects' }, level: parsedLevel.data }];
    case 'selected_projects': {
      const ids = pick('live_assistant.access_project_ids');
      const projectIds = Array.isArray(ids)
        ? [
            ...new Set(
              ids.filter((id): id is string => typeof id === 'string' && UUID_SHAPE.test(id)),
            ),
          ]
        : [];
      return [
        {
          scope: {
            mode: 'selected_projects',
            projectIds: projectIds.slice(0, 200),
            includeCurrent: pick('live_assistant.access_include_current') === true,
          },
          level: parsedLevel.data,
        },
      ];
    }
    default:
      return [];
  }
}

/**
 * Where a capability acts. `projects_overview` is the list and comparisons across projects;
 * `backoffice` is everything else (settings, providers, users, knowledge outside a project).
 */
export type AssistantAccessTarget =
  | { readonly area: 'project'; readonly projectId: string }
  | { readonly area: 'projects_overview' }
  | { readonly area: 'backoffice' };

export type AssistantAccessDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'out_of_scope' | 'read_only' };

function covers(
  scope: AssistantAccessScope,
  target: AssistantAccessTarget,
  currentProjectId: string | null,
): boolean {
  switch (scope.mode) {
    case 'backoffice':
      return true;
    case 'all_projects':
      return target.area === 'project' || target.area === 'projects_overview';
    case 'selected_projects':
      // The projects list spans all projects, so a chosen set does not cover it.
      if (target.area !== 'project') return false;
      return (
        scope.projectIds.includes(target.projectId) ||
        (scope.includeCurrent && currentProjectId !== null && target.projectId === currentProjectId)
      );
  }
}

/**
 * The rules are a union: a request is allowed when some rule covers it, and a change needs a
 * covering rule at level `act`. No rules, or none that covers the target, allows nothing.
 */
export function evaluateAssistantAccess(
  rules: readonly AssistantAccessRule[],
  request: {
    readonly target: AssistantAccessTarget;
    readonly write: boolean;
    readonly currentProjectId?: string | null | undefined;
  },
): AssistantAccessDecision {
  const current = request.currentProjectId ?? null;
  const covering = rules.filter((rule) => covers(rule.scope, request.target, current));
  if (covering.length === 0) return { allowed: false, reason: 'out_of_scope' };
  if (!request.write) return { allowed: true };
  return covering.some((rule) => rule.level === 'act')
    ? { allowed: true }
    : { allowed: false, reason: 'read_only' };
}

// ---------------------------------------------------------------------------------------------
// Risk tiers and confirmation
// ---------------------------------------------------------------------------------------------

/**
 * T0 read; T1 reversible change; T2 consequential or costly change; T3 irreversible or
 * security-relevant change (off until the owner enables its category, then double confirmation).
 * `forbidden` is never allowed: the assistant's own settings and every secret.
 */
export const riskTiers = ['T0', 'T1', 'T2', 'T3'] as const;
export type RiskTier = (typeof riskTiers)[number];
export type CapabilityClass = RiskTier | 'forbidden';

/** Categories of T3 the owner can switch on one by one. Secrets are deliberately absent. */
export const t3Categories = [
  'delete',
  'accounts',
  'retention',
  'audit_override',
  'security_settings',
] as const;
export type T3Category = (typeof t3Categories)[number];

export type ConfirmationStep = 'preview' | 'readback' | 'voice_or_click' | 'target_echo_or_click';

export type ConfirmStrictness = 'standard' | 'strict';

export type ConfirmationPlan =
  | { readonly allowed: false; readonly reason: 'forbidden' | 't3_disabled' }
  | {
      readonly allowed: true;
      readonly tier: RiskTier;
      readonly steps: readonly ConfirmationStep[];
    };

/**
 * Which confirmations a change needs. Untrusted content read in the same turn (a stage output,
 * knowledge, the web) lifts T1 to T2, and strict mode does the same; neither can lower a tier.
 */
export function planConfirmation(input: {
  readonly klass: CapabilityClass;
  readonly tainted: boolean;
  readonly strictness: ConfirmStrictness;
  readonly t3Enabled: boolean;
}): ConfirmationPlan {
  if (input.klass === 'forbidden') return { allowed: false, reason: 'forbidden' };
  let tier: RiskTier = input.klass;
  if (tier === 'T1' && (input.tainted || input.strictness === 'strict')) tier = 'T2';
  switch (tier) {
    case 'T0':
      return { allowed: true, tier, steps: [] };
    case 'T1':
      return { allowed: true, tier, steps: ['preview', 'voice_or_click'] };
    case 'T2':
      return { allowed: true, tier, steps: ['preview', 'readback', 'voice_or_click'] };
    case 'T3':
      return input.t3Enabled
        ? {
            allowed: true,
            tier,
            steps: ['preview', 'readback', 'voice_or_click', 'target_echo_or_click'],
          }
        : { allowed: false, reason: 't3_disabled' };
  }
}

export interface CapabilityMeta {
  readonly name: string;
  readonly klass: CapabilityClass;
  readonly area: AssistantAccessTarget['area'];
  /** True when the capability changes anything, including starting work that costs money. */
  readonly write: boolean;
  readonly t3Category?: T3Category | undefined;
}

export type CapabilityDecision =
  | { readonly allowed: true; readonly plan: Extract<ConfirmationPlan, { allowed: true }> }
  | {
      readonly allowed: false;
      readonly reason:
        | 'forbidden'
        | 'out_of_scope'
        | 'read_only'
        | 'project_required'
        | 't3_disabled'
        | 'misconfigured';
    };

/**
 * The gateway's one question: may this capability run for this request, and with which
 * confirmations? Anything inconsistent fails closed.
 */
export function decideCapability(input: {
  readonly capability: CapabilityMeta;
  readonly rules: readonly AssistantAccessRule[];
  readonly projectId?: string | null | undefined;
  readonly currentProjectId?: string | null | undefined;
  readonly tainted: boolean;
  readonly strictness: ConfirmStrictness;
  readonly enabledT3: readonly T3Category[];
}): CapabilityDecision {
  const { capability } = input;
  if (capability.klass === 'forbidden') return { allowed: false, reason: 'forbidden' };
  if (capability.write !== (capability.klass !== 'T0')) {
    return { allowed: false, reason: 'misconfigured' };
  }
  let target: AssistantAccessTarget;
  if (capability.area === 'project') {
    if (!input.projectId) return { allowed: false, reason: 'project_required' };
    target = { area: 'project', projectId: input.projectId };
  } else {
    target = { area: capability.area };
  }
  const access = evaluateAssistantAccess(input.rules, {
    target,
    write: capability.write,
    currentProjectId: input.currentProjectId,
  });
  if (!access.allowed) return { allowed: false, reason: access.reason };
  const plan = planConfirmation({
    klass: capability.klass,
    tainted: input.tainted,
    strictness: input.strictness,
    t3Enabled:
      capability.t3Category !== undefined && input.enabledT3.includes(capability.t3Category),
  });
  return plan.allowed ? { allowed: true, plan } : { allowed: false, reason: plan.reason };
}

// ---------------------------------------------------------------------------------------------
// Reading a spoken confirmation
// ---------------------------------------------------------------------------------------------

const ch = (code: number) => String.fromCharCode(code);
const COMBINING_MARKS = new RegExp(`[${ch(0x64b)}-${ch(0x65f)}${ch(0x670)}${ch(0x640)}]`, 'gu');
const ZERO_WIDTH_JOINER = new RegExp(ch(0x200c), 'gu');
const INDIC_DIGITS = new Map<string, string>(
  [...'۰۱۲۳۴۵۶۷۸۹', ...'٠١٢٣٤٥٦٧٨٩'].map((digit, index): [string, string] => [
    digit,
    String(index % 10),
  ]),
);

/**
 * One form for what was said and what is expected: Persian letters and digits, no marks, no
 * punctuation, single spaces, lower case. Speech recognition and typing differ on all of these.
 */
export function normalizeSpoken(input: string): string {
  return input
    .normalize('NFKC')
    .replace(COMBINING_MARKS, '')
    .replace(/[يى]/gu, 'ی')
    .replace(/ك/gu, 'ک')
    .replace(/[أإٱآ]/gu, 'ا')
    .replace(/[۰-۹٠-٩]/gu, (digit) => INDIC_DIGITS.get(digit) ?? digit)
    .replace(ZERO_WIDTH_JOINER, ' ')
    .replace(/n['’]t\b/giu, ' not')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Whole words that mean "no" or "wait"; one of them anywhere cancels a confirmation. */
const NEGATION_WORDS = new Set([
  'نه',
  'نخیر',
  'لغو',
  'کنسل',
  'انصراف',
  'صبر',
  'وایسا',
  'وایستا',
  'بیخیال',
  // Negative imperatives that are whole words: "don't do / give / put / say / go".
  'نده',
  'ندید',
  'نذار',
  'نذارید',
  'نزن',
  'نزنید',
  'نگو',
  'نرو',
  'نشه',
  'نشود',
  'مخالفم',
  'no',
  'nope',
  'not',
  'cancel',
  'stop',
  'wait',
  'never',
  'abort',
]);
/** Negative verb forms are written with or without a half-space, so they are matched by prefix. */
const NEGATION_PREFIXES = ['نمی', 'نکن', 'نخو', 'نباید', 'نبای', 'نیست', 'اشتباه', 'غلط'];

function hasNegation(tokens: readonly string[]): boolean {
  return tokens.some(
    (token) =>
      NEGATION_WORDS.has(token) || NEGATION_PREFIXES.some((prefix) => token.startsWith(prefix)),
  );
}

/** Polite or filler words that do not change the meaning of a short answer. */
const FILLERS = new Set(['لطفا', 'دیگه', 'خب', 'پس', 'حالا', 'please']);

/** Complete answers that mean "do it". */
const CONFIRM_PHRASES: readonly (readonly string[])[] = [
  ['تایید'],
  ['تایید', 'میکنم'],
  ['تایید', 'می', 'کنم'],
  ['تایید', 'کن'],
  ['تایید', 'نهایی'],
  ['بله'],
  ['اره'],
  ['درسته'],
  ['انجام', 'بده'],
  ['انجامش', 'بده'],
  ['انجام', 'بدید'],
  ['انجامش', 'بدید'],
  ['ثبت', 'کن'],
  ['ثبتش', 'کن'],
  ['ثبت', 'کنید'],
  ['yes'],
  ['yeah'],
  ['yep'],
  ['confirm'],
  ['confirmed'],
  ['do', 'it'],
  ['go', 'ahead'],
  ['proceed'],
];
/** Acknowledgements that count only next to a real confirmation: "ok" alone only means "heard". */
const ACKNOWLEDGEMENTS = new Set(['اوکی', 'باشه', 'ok', 'okay']);
const MAX_ANSWER_WORDS = 8;
const MAX_PHRASES = 3;

export type SpokenAnswer = 'confirm' | 'reject' | 'unclear';

/**
 * Reads the owner's latest utterance. A negation anywhere is a rejection; a confirmation must be
 * a short answer made only of known confirming phrases; a question or anything else is unclear.
 * It is deliberately strict: a wrong "unclear" costs one repeat, a wrong "confirm" costs a change.
 */
export function readSpokenAnswer(transcript: string): SpokenAnswer {
  if (/[?؟]/u.test(transcript)) return 'unclear';
  const tokens = normalizeSpoken(transcript).split(' ').filter(Boolean);
  if (tokens.length === 0) return 'unclear';
  if (hasNegation(tokens)) return 'reject';
  if (tokens.length > MAX_ANSWER_WORDS) return 'unclear';

  const rest = tokens.filter((token) => !FILLERS.has(token));
  let position = 0;
  let phrases = 0;
  while (position < rest.length) {
    const word = rest[position] as string;
    if (ACKNOWLEDGEMENTS.has(word)) {
      position += 1;
      continue;
    }
    const phrase = CONFIRM_PHRASES.filter((candidate) =>
      candidate.every((part, offset) => rest[position + offset] === part),
    ).sort((a, b) => b.length - a.length)[0];
    if (!phrase) return 'unclear';
    position += phrase.length;
    phrases += 1;
    if (phrases > MAX_PHRASES) return 'unclear';
  }
  return phrases > 0 ? 'confirm' : 'unclear';
}

/** Shortest target name that can be spoken back as a second confirmation (T3). */
const MIN_ECHO_CHARS = 4;

/**
 * Second confirmation of a T3 change: the owner says the name of what is about to change. A name
 * too short to tell apart cannot be echoed, so it needs a click; a negation never counts.
 */
export function matchTargetEcho(transcript: string, targetName: string): boolean {
  const name = normalizeSpoken(targetName);
  if (name.replace(/ /gu, '').length < MIN_ECHO_CHARS) return false;
  const heard = normalizeSpoken(transcript);
  if (hasNegation(heard.split(' '))) return false;
  return ` ${heard} `.includes(` ${name} `);
}

// ---------------------------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------------------------

export type CapKind = 'session_cost' | 'session_minutes' | 'daily_cost' | 'task_cost';
export const capWarnRatio = 0.8;

export interface CapUsage {
  readonly sessionCostUsd: number;
  readonly sessionMinutes: number;
  readonly dailyCostUsd: number;
  readonly taskCostUsd?: number | undefined;
}

export type CapStatus =
  | { readonly status: 'ok' }
  | { readonly status: 'warn' | 'exceeded'; readonly which: readonly CapKind[] };

/**
 * `exceeded` at or over a cap, `warn` from 80%. A measurement that is not a finite, non-negative
 * number counts as exceeded: when the accounting is broken the session must not run on.
 */
export function evaluateCaps(
  usage: CapUsage,
  caps: Pick<
    LiveAssistantCaps,
    'sessionCostCapUsd' | 'sessionMaxMinutes' | 'dailyCostCapUsd' | 'taskCostCapUsd'
  >,
): CapStatus {
  const checks: readonly [CapKind, number | undefined, number][] = [
    ['session_cost', usage.sessionCostUsd, caps.sessionCostCapUsd],
    ['session_minutes', usage.sessionMinutes, caps.sessionMaxMinutes],
    ['daily_cost', usage.dailyCostUsd, caps.dailyCostCapUsd],
    ['task_cost', usage.taskCostUsd, caps.taskCostCapUsd],
  ];
  const exceeded: CapKind[] = [];
  const warned: CapKind[] = [];
  for (const [kind, used, cap] of checks) {
    if (used === undefined) continue;
    if (!Number.isFinite(used) || used < 0 || used >= cap) exceeded.push(kind);
    else if (used >= cap * capWarnRatio) warned.push(kind);
  }
  if (exceeded.length > 0) return { status: 'exceeded', which: exceeded };
  if (warned.length > 0) return { status: 'warn', which: warned };
  return { status: 'ok' };
}

// ---------------------------------------------------------------------------------------------
// Action ledger
// ---------------------------------------------------------------------------------------------

export const liveActionStatuses = [
  'proposed',
  'first_confirmed',
  'confirmed',
  'executed',
  'failed',
  'cancelled',
  'expired',
  'refused',
] as const;
export type LiveActionStatus = (typeof liveActionStatuses)[number];

export type LiveActionEvent = 'confirm' | 'cancel' | 'expire' | 'executed' | 'failed';

export const terminalLiveActionStatuses: readonly LiveActionStatus[] = [
  'executed',
  'failed',
  'cancelled',
  'expired',
  'refused',
];

/**
 * The only legal moves of a proposed change. `refused` is born terminal (the gateway said no);
 * `first_confirmed` exists only for T3, where one confirmation is not enough. Nothing runs
 * unless it went through `confirmed`. Returns null for an illegal move.
 */
export function nextLiveActionStatus(
  current: LiveActionStatus,
  event: LiveActionEvent,
  options: { readonly doubleConfirmation: boolean } = { doubleConfirmation: false },
): LiveActionStatus | null {
  switch (current) {
    case 'proposed':
      if (event === 'confirm') return options.doubleConfirmation ? 'first_confirmed' : 'confirmed';
      if (event === 'cancel') return 'cancelled';
      if (event === 'expire') return 'expired';
      return null;
    case 'first_confirmed':
      if (event === 'confirm') return 'confirmed';
      if (event === 'cancel') return 'cancelled';
      if (event === 'expire') return 'expired';
      return null;
    case 'confirmed':
      if (event === 'executed') return 'executed';
      if (event === 'failed') return 'failed';
      return null;
    default:
      return null;
  }
}

/** A change nobody confirmed in time is cancelled, never run late. */
export function isLiveActionExpired(
  proposedAtMs: number,
  nowMs: number,
  timeoutS: number,
): boolean {
  return nowMs - proposedAtMs >= timeoutS * 1000;
}
