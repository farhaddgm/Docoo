import type { MonitorSettingKey, MonitorSettingValue } from './monitor.js';
import { redactText } from './redaction.js';

/**
 * What the voice assistant monitor shows (ADR-0056 §6, §8-4). One pure function turns what the
 * database holds into the view a room screen gets, and it is the only door: the view is built
 * field by field from the settings, so a field that is not named here can never reach a screen, and
 * a setting that says "hidden" produces `null`, not a hidden element. Texts that come from the work
 * are masked on the way (`redactText`).
 *
 * The source is plain data, free of the database, so every setting can be tested on its own.
 */

// ---- what goes in ---------------------------------------------------------------------------

export interface VoiceSourceSession {
  readonly id: string;
  readonly status: 'active' | 'ended';
  readonly endReason: string | null;
  readonly mode: string;
  readonly model: string;
  /** The provider kind the session ran on (`openai`, `gemini`, ...); empty when not recorded. */
  readonly provider: string;
  readonly startedAt: string;
  readonly lastActivityAt: string;
  readonly minutes: number;
  readonly messageCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly executorInputTokens: number;
  readonly executorOutputTokens: number;
  readonly executorCostUsd: number;
  readonly executorCalls: number;
  readonly sessionCostCapUsd: number;
  readonly accessScope: string | null;
  readonly accessLevel: string | null;
  readonly personFirstName: string;
  readonly personFullName: string;
}

export interface VoiceSourceMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly createdAt: string;
}

export interface VoiceSourceAction {
  readonly status: string;
  readonly summary: string;
  readonly targetName: string | null;
  readonly steps: readonly string[];
  readonly tier: string | null;
  readonly proposedAt: string;
  readonly finishedAt: string | null;
}

export interface VoiceSourcePeriod {
  readonly costUsd: number;
  readonly tokens: number;
  readonly sessions: number;
}

export interface VoiceMonitorSource {
  readonly nowMs: number;
  readonly assistant: {
    readonly displayName: string;
    readonly language: string;
    readonly voiceId: string;
  };
  /** Newest first. */
  readonly sessions: readonly VoiceSourceSession[];
  readonly day: VoiceSourcePeriod;
  readonly month: VoiceSourcePeriod;
  readonly dailyCostCapUsd: number;
  /** The lines and cards of the session `pickCurrentSession` chose; empty when none was asked for. */
  readonly messages: readonly VoiceSourceMessage[];
  readonly actions: readonly VoiceSourceAction[];
}

// ---- what comes out -------------------------------------------------------------------------

export interface VoiceMonitorPerson {
  readonly role: 'owner';
  readonly name: string | null;
}

export interface VoiceMonitorSession {
  readonly id: string;
  readonly current: boolean;
  readonly live: boolean;
  readonly startedAt: string;
  readonly minutes: number;
  readonly messageCount: number;
  readonly endReason: string | null;
  readonly person: VoiceMonitorPerson | null;
  readonly tokens: number | null;
  readonly costUsd: number | null;
}

export interface VoiceMonitorLine {
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly at: string;
}

export interface VoiceMonitorCard {
  readonly status: string;
  readonly summary: string;
  readonly at: string;
  /** Only at the detail level. */
  readonly detail: null | {
    readonly targetName: string | null;
    readonly steps: readonly string[];
    readonly tier: string | null;
    readonly finishedAt: string | null;
  };
}

export interface VoiceMonitorView {
  readonly generatedAt: string;
  readonly delayS: number;
  readonly assistantName: string;
  /** A session is running now. */
  readonly live: boolean;
  /** `talking`: recent activity; `ready`: running and quiet; `off`: nothing running; null: hidden. */
  readonly indicator: 'talking' | 'ready' | 'off' | null;
  readonly model: null | {
    readonly provider: string | null;
    readonly model: string | null;
    readonly mode: string | null;
    readonly language: string | null;
    readonly voice: string | null;
  };
  readonly tokens: null | {
    readonly total: number;
    readonly input: number | null;
    readonly output: number | null;
    readonly executor: null | {
      readonly input: number;
      readonly output: number;
      readonly calls: number;
    };
  };
  readonly cost: null | {
    /** Null when the session used tokens that were never priced. */
    readonly session: number | null;
    readonly unpriced: boolean;
    /** Whether the figure carries the "estimate" label (what the browser reports is not exact). */
    readonly estimateLabel: boolean;
    readonly day: number | null;
    readonly month: number | null;
    readonly caps: null | {
      readonly sessionPercent: number | null;
      readonly dailyPercent: number | null;
      readonly sessionCapUsd: number | null;
      readonly dailyCapUsd: number | null;
    };
  };
  readonly access: null | { readonly scope: string; readonly level: string | null };
  readonly sessions: readonly VoiceMonitorSession[];
  readonly current: null | {
    readonly id: string;
    readonly lines: readonly VoiceMonitorLine[] | null;
    readonly cards: readonly VoiceMonitorCard[] | null;
  };
}

// ---- reading the settings -------------------------------------------------------------------

type Settings = Readonly<Partial<Record<MonitorSettingKey, MonitorSettingValue>>>;

const pick = (settings: Settings, key: MonitorSettingKey, fallback: string): string => {
  const value = settings[key];
  return typeof value === 'string' ? value : fallback;
};

const DAY_MS = 86_400_000;
const RECENT_COUNT = 10;
/** A session that did something in the last seconds is "talking"; longer, it is only ready. */
const TALKING_WINDOW_MS = 20_000;
const MAX_LINES = 40;
const MAX_CARDS = 20;
const MAX_LINE_LENGTH = 2000;

const time = (iso: string): number => {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
};

// ---- which sessions -------------------------------------------------------------------------

/** The sessions the setting `monitor.voice.sessions` lets a screen list, newest first. */
export function sessionsInScope(
  sessions: readonly VoiceSourceSession[],
  scope: string,
  nowMs: number,
): VoiceSourceSession[] {
  switch (scope) {
    case 'all':
      return [...sessions];
    case 'recent':
      return sessions.slice(0, RECENT_COUNT);
    case 'today':
      return sessions.filter(
        (session) => session.status === 'active' || nowMs - time(session.startedAt) < DAY_MS,
      );
    default:
      return sessions.filter((session) => session.status === 'active');
  }
}

/** The session whose lines and cards the screen follows: the running one, else the newest. */
export function pickCurrentSession(
  sessions: readonly VoiceSourceSession[],
  scope: string,
  nowMs: number,
): VoiceSourceSession | null {
  const inScope = sessionsInScope(sessions, scope, nowMs);
  return inScope.find((session) => session.status === 'active') ?? inScope[0] ?? null;
}

// ---- the projection -------------------------------------------------------------------------

export function projectVoiceMonitor(
  source: VoiceMonitorSource,
  settings: Settings,
): VoiceMonitorView {
  const level =
    pick(settings, 'monitor.redaction', 'strict') === 'standard' ? 'standard' : 'strict';
  const words = Array.isArray(settings['monitor.blocked_words'])
    ? settings['monitor.blocked_words']
    : [];
  const mask = (text: string): string => redactText(text, { level, blockedWords: words });
  const delayRaw = settings['monitor.delay_s'];
  const delayS = typeof delayRaw === 'number' && delayRaw >= 0 ? delayRaw : 3;
  const visibleUntil = source.nowMs - delayS * 1000;

  const scope = pick(settings, 'monitor.voice.sessions', 'live');
  const inScope = sessionsInScope(source.sessions, scope, source.nowMs);
  const current = pickCurrentSession(source.sessions, scope, source.nowMs);
  const live = source.sessions.some((session) => session.status === 'active');

  // ---- who spoke
  const peopleSetting = pick(settings, 'monitor.voice.people', 'role');
  const person = (session: VoiceSourceSession): VoiceMonitorPerson | null => {
    switch (peopleSetting) {
      case 'role':
        return { role: 'owner', name: null };
      case 'first_name':
        return { role: 'owner', name: mask(session.personFirstName) };
      case 'full_name':
        return { role: 'owner', name: mask(session.personFullName) };
      default:
        return null;
    }
  };

  // ---- usage
  const tokensSetting = pick(settings, 'monitor.voice.tokens', 'hidden');
  const costSetting = pick(settings, 'monitor.voice.cost', 'hidden');
  const sessionTokens = (session: VoiceSourceSession): number =>
    session.inputTokens +
    session.outputTokens +
    session.executorInputTokens +
    session.executorOutputTokens;
  const sessionCost = (session: VoiceSourceSession): number =>
    session.costUsd + session.executorCostUsd;
  const unpriced = (session: VoiceSourceSession): boolean =>
    sessionTokens(session) > 0 && sessionCost(session) === 0;

  // ---- model
  const modelSetting = pick(settings, 'monitor.voice.model_info', 'hidden');
  const language = source.assistant.language;
  let model: VoiceMonitorView['model'] = null;
  if (current && modelSetting !== 'hidden') {
    const withModel = modelSetting === 'model' || modelSetting === 'all';
    model = {
      provider: current.provider === '' ? null : current.provider,
      model: withModel ? (current.model === '' ? null : mask(current.model)) : null,
      mode: modelSetting === 'all' ? current.mode : null,
      language: modelSetting === 'all' ? language : null,
      voice:
        modelSetting === 'all' && source.assistant.voiceId !== ''
          ? mask(source.assistant.voiceId)
          : null,
    };
  }

  // ---- tokens
  let tokens: VoiceMonitorView['tokens'] = null;
  if (current && tokensSetting !== 'hidden') {
    const splitting = tokensSetting === 'split' || tokensSetting === 'split_executor';
    tokens = {
      total: sessionTokens(current),
      input: splitting ? current.inputTokens + current.executorInputTokens : null,
      output: splitting ? current.outputTokens + current.executorOutputTokens : null,
      executor:
        tokensSetting === 'split_executor'
          ? {
              input: current.executorInputTokens,
              output: current.executorOutputTokens,
              calls: current.executorCalls,
            }
          : null,
    };
  }

  // ---- cost
  let cost: VoiceMonitorView['cost'] = null;
  if (current && costSetting !== 'hidden') {
    const dayCost = source.day.costUsd;
    const capsSetting = pick(settings, 'monitor.voice.caps', 'percent');
    let caps: NonNullable<VoiceMonitorView['cost']>['caps'] = null;
    if (costSetting === 'with_caps' && capsSetting !== 'hidden') {
      const percent = (used: number, cap: number): number | null =>
        cap > 0 ? Math.round((used / cap) * 100) : null;
      const amounts = capsSetting === 'amounts';
      caps = {
        sessionPercent: percent(sessionCost(current), current.sessionCostCapUsd),
        dailyPercent: percent(dayCost, source.dailyCostCapUsd),
        sessionCapUsd: amounts ? current.sessionCostCapUsd : null,
        dailyCapUsd: amounts ? source.dailyCostCapUsd : null,
      };
    }
    const withDay = costSetting === 'session_day' || costSetting === 'with_caps';
    cost = {
      session: unpriced(current) ? null : sessionCost(current),
      unpriced: unpriced(current),
      estimateLabel: pick(settings, 'monitor.voice.cost_flag', 'always') === 'always',
      day: withDay ? dayCost : null,
      month: costSetting === 'with_caps' ? source.month.costUsd : null,
      caps,
    };
  }

  // ---- access
  const accessSetting = pick(settings, 'monitor.voice.access_info', 'hidden');
  const access: VoiceMonitorView['access'] =
    current && current.accessScope && accessSetting !== 'hidden'
      ? {
          scope: current.accessScope,
          level: accessSetting === 'scope_level' ? current.accessLevel : null,
        }
      : null;

  // ---- the list of sessions
  const showEnd = settings['monitor.voice.end_reason'] === true;
  const sessions: VoiceMonitorSession[] = inScope.map((session) => ({
    id: session.id,
    current: session.id === current?.id,
    live: session.status === 'active',
    startedAt: session.startedAt,
    minutes: session.minutes,
    messageCount: session.messageCount,
    endReason: showEnd && session.status === 'ended' ? session.endReason : null,
    person: person(session),
    tokens: tokensSetting === 'hidden' ? null : sessionTokens(session),
    costUsd: costSetting === 'hidden' || unpriced(session) ? null : sessionCost(session),
  }));

  // ---- the lines and the cards of the current session
  const transcript = pick(settings, 'monitor.voice.transcript', 'hidden');
  const cardsSetting = pick(settings, 'monitor.voice.action_cards', 'summary');
  let lines: VoiceMonitorLine[] | null = null;
  if (current && transcript !== 'hidden') {
    lines = source.messages
      .filter((message) => transcript === 'full' || message.role === 'assistant')
      .filter((message) => time(message.createdAt) <= visibleUntil)
      .slice(-MAX_LINES)
      .map((message) => ({
        role: message.role,
        text: mask(message.content.slice(0, MAX_LINE_LENGTH)),
        at: message.createdAt,
      }));
  }
  let cards: VoiceMonitorCard[] | null = null;
  if (current && cardsSetting !== 'hidden') {
    cards = source.actions
      .filter((action) => time(action.proposedAt) <= visibleUntil)
      .slice(-MAX_CARDS)
      .map((action) => ({
        status: action.status,
        summary: mask(action.summary.slice(0, MAX_LINE_LENGTH)),
        at: action.proposedAt,
        detail:
          cardsSetting === 'detail'
            ? {
                targetName: action.targetName === null ? null : mask(action.targetName),
                steps: action.steps.map((step) => mask(step)),
                tier: action.tier,
                finishedAt: action.finishedAt,
              }
            : null,
      }));
  }

  // ---- the indicator
  let indicator: VoiceMonitorView['indicator'] = null;
  if (settings['monitor.voice.live_indicators'] === true) {
    const running = source.sessions.find((session) => session.status === 'active');
    indicator = !running
      ? 'off'
      : source.nowMs - time(running.lastActivityAt) < TALKING_WINDOW_MS
        ? 'talking'
        : 'ready';
  }

  return {
    generatedAt: new Date(source.nowMs).toISOString(),
    delayS,
    assistantName: mask(source.assistant.displayName),
    live,
    indicator,
    model,
    tokens,
    cost,
    access,
    sessions,
    current: current ? { id: current.id, lines, cards } : null,
  };
}
