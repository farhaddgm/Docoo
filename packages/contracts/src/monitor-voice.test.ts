import { describe, expect, it } from 'vitest';

import { MASK } from './redaction.js';
import {
  monitorSettingDefinitions,
  monitorSettingsFrom,
  type MonitorSettingKey,
  type MonitorSettingValue,
} from './monitor.js';
import {
  pickCurrentSession,
  projectVoiceMonitor,
  sessionsInScope,
  type VoiceMonitorSource,
  type VoiceSourceAction,
  type VoiceSourceMessage,
  type VoiceSourceSession,
} from './monitor-voice.js';

const NOW = Date.parse('2026-11-09T12:00:00.000Z');
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

const session = (over: Partial<VoiceSourceSession> = {}): VoiceSourceSession => ({
  id: '00000000-0000-4000-8000-000000000001',
  status: 'active',
  endReason: null,
  mode: 'realtime',
  model: 'gpt-realtime',
  provider: 'openai',
  startedAt: ago(600),
  lastActivityAt: ago(5),
  minutes: 10,
  messageCount: 4,
  inputTokens: 1000,
  outputTokens: 500,
  costUsd: 0.5,
  executorInputTokens: 200,
  executorOutputTokens: 100,
  executorCostUsd: 0.1,
  executorCalls: 3,
  sessionCostCapUsd: 5,
  accessScope: 'all_projects',
  accessLevel: 'read',
  personFirstName: 'Ali',
  personFullName: 'Ali Rezaei',
  ...over,
});

const live = session();
const endedToday = session({
  id: '00000000-0000-4000-8000-000000000002',
  status: 'ended',
  endReason: 'user',
  startedAt: ago(3 * 3600),
  lastActivityAt: ago(2 * 3600),
});
const endedOld = session({
  id: '00000000-0000-4000-8000-000000000003',
  status: 'ended',
  endReason: 'cap_cost',
  startedAt: ago(3 * 86_400),
  lastActivityAt: ago(3 * 86_400 - 600),
});

const messages: VoiceSourceMessage[] = [
  { role: 'user', content: 'Open the Acme project', createdAt: ago(60) },
  { role: 'assistant', content: 'Opening it. Mail ali@example.com', createdAt: ago(55) },
  { role: 'user', content: 'Thanks', createdAt: ago(1) },
];
const actions: VoiceSourceAction[] = [
  {
    status: 'executed',
    summary: 'Open the project Acme',
    targetName: 'Acme',
    steps: ['read the project', 'open the page'],
    tier: 'T0',
    proposedAt: ago(50),
    finishedAt: ago(49),
  },
  {
    status: 'proposed',
    summary: 'Rename a stage',
    targetName: null,
    steps: [],
    tier: 'T1',
    proposedAt: ago(1),
    finishedAt: null,
  },
];

const source = (over: Partial<VoiceMonitorSource> = {}): VoiceMonitorSource => ({
  nowMs: NOW,
  assistant: { displayName: 'Docoo', language: 'fa', voiceId: 'alloy' },
  sessions: [live, endedToday, endedOld],
  day: { costUsd: 2, tokens: 5000, sessions: 2 },
  month: { costUsd: 12, tokens: 90_000, sessions: 9 },
  dailyCostCapUsd: 20,
  messages,
  actions,
  ...over,
});

const settings = (over: Partial<Record<MonitorSettingKey, MonitorSettingValue>> = {}) =>
  monitorSettingsFrom(over);

describe('the sessions a screen lists', () => {
  it('follow the scope setting', () => {
    const all = [live, endedToday, endedOld];
    expect(sessionsInScope(all, 'live', NOW).map((s) => s.id)).toEqual([live.id]);
    expect(sessionsInScope(all, 'today', NOW).map((s) => s.id)).toEqual([live.id, endedToday.id]);
    expect(sessionsInScope(all, 'recent', NOW)).toHaveLength(3);
    expect(sessionsInScope(all, 'all', NOW)).toHaveLength(3);
    expect(sessionsInScope(all, 'nonsense', NOW).map((s) => s.id)).toEqual([live.id]);
  });

  it('keep only the ten newest for "recent"', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      session({
        id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`,
        status: 'ended',
      }),
    );
    expect(sessionsInScope(many, 'recent', NOW)).toHaveLength(10);
    expect(sessionsInScope(many, 'all', NOW)).toHaveLength(15);
  });

  it('follow the running session, else the newest one in scope, else nothing', () => {
    expect(pickCurrentSession([endedToday, live, endedOld], 'all', NOW)?.id).toBe(live.id);
    expect(pickCurrentSession([endedToday, endedOld], 'all', NOW)?.id).toBe(endedToday.id);
    expect(pickCurrentSession([endedToday, endedOld], 'live', NOW)).toBeNull();
    expect(pickCurrentSession([], 'all', NOW)).toBeNull();
  });
});

describe('the room profile (the defaults)', () => {
  const view = projectVoiceMonitor(source(), settings());

  it('shows no model, tokens, cost, access or conversation text', () => {
    expect(view.model).toBeNull();
    expect(view.tokens).toBeNull();
    expect(view.cost).toBeNull();
    expect(view.access).toBeNull();
    expect(view.current?.lines).toBeNull();
    expect(view.sessions.every((s) => s.tokens === null && s.costUsd === null)).toBe(true);
  });

  it('still shows the plain facts: a session is live, its length and its action cards in short', () => {
    expect(view.live).toBe(true);
    expect(view.assistantName).toBe('Docoo');
    expect(view.sessions).toHaveLength(1);
    expect(view.sessions[0]).toMatchObject({
      current: true,
      live: true,
      minutes: 10,
      messageCount: 4,
    });
    // The delay of the room profile (3 seconds) holds back the card proposed a second ago.
    expect(view.current?.cards).toHaveLength(1);
    expect(view.current?.cards?.every((card) => card.detail === null)).toBe(true);
    expect(view.delayS).toBe(3);
  });

  it('shows only the role of the speaker, not a name', () => {
    expect(view.sessions[0]?.person).toEqual({ role: 'owner', name: null });
  });
});

describe('the model, tokens and cost', () => {
  it('show the provider, then the model, then everything the setting allows', () => {
    const at = (value: string) =>
      projectVoiceMonitor(source(), settings({ 'monitor.voice.model_info': value })).model;
    expect(at('hidden')).toBeNull();
    expect(at('provider')).toEqual({
      provider: 'openai',
      model: null,
      mode: null,
      language: null,
      voice: null,
    });
    expect(at('model')).toEqual({
      provider: 'openai',
      model: 'gpt-realtime',
      mode: null,
      language: null,
      voice: null,
    });
    expect(at('all')).toEqual({
      provider: 'openai',
      model: 'gpt-realtime',
      mode: 'realtime',
      language: 'fa',
      voice: 'alloy',
    });
  });

  it('leave the provider empty when it was never recorded', () => {
    const old = session({ provider: '' });
    const view = projectVoiceMonitor(
      source({ sessions: [old] }),
      settings({ 'monitor.voice.model_info': 'model' }),
    );
    expect(view.model?.provider).toBeNull();
  });

  it('show a total, a split, or the split with the executor', () => {
    const at = (value: string) =>
      projectVoiceMonitor(source(), settings({ 'monitor.voice.tokens': value })).tokens;
    expect(at('hidden')).toBeNull();
    expect(at('total')).toEqual({ total: 1800, input: null, output: null, executor: null });
    expect(at('split')).toEqual({ total: 1800, input: 1200, output: 600, executor: null });
    expect(at('split_executor')).toEqual({
      total: 1800,
      input: 1200,
      output: 600,
      executor: { input: 200, output: 100, calls: 3 },
    });
  });

  it('show the session, then also the day, then also the month and the caps', () => {
    const at = (
      value: string,
      extra: Partial<Record<MonitorSettingKey, MonitorSettingValue>> = {},
    ) => projectVoiceMonitor(source(), settings({ 'monitor.voice.cost': value, ...extra })).cost;
    expect(at('hidden')).toBeNull();
    expect(at('session')).toMatchObject({ session: 0.6, day: null, month: null, caps: null });
    expect(at('session_day')).toMatchObject({ session: 0.6, day: 2, month: null, caps: null });
    expect(at('with_caps')).toMatchObject({
      session: 0.6,
      day: 2,
      month: 12,
      caps: { sessionPercent: 12, dailyPercent: 10, sessionCapUsd: null, dailyCapUsd: null },
    });
    expect(at('with_caps', { 'monitor.voice.caps': 'amounts' })?.caps).toEqual({
      sessionPercent: 12,
      dailyPercent: 10,
      sessionCapUsd: 5,
      dailyCapUsd: 20,
    });
    expect(at('with_caps', { 'monitor.voice.caps': 'hidden' })?.caps).toBeNull();
    // The caps only ever come with the cost: with "session" they stay away.
    expect(at('session', { 'monitor.voice.caps': 'amounts' })?.caps).toBeNull();
  });

  it('say "unpriced" instead of showing zero when tokens were never priced', () => {
    const free = session({ costUsd: 0, executorCostUsd: 0 });
    const view = projectVoiceMonitor(
      source({ sessions: [free] }),
      settings({ 'monitor.voice.cost': 'session' }),
    );
    expect(view.cost).toMatchObject({ session: null, unpriced: true });
    expect(view.sessions[0]?.costUsd).toBeNull();
    const empty = session({
      costUsd: 0,
      executorCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      executorInputTokens: 0,
      executorOutputTokens: 0,
    });
    expect(
      projectVoiceMonitor(
        source({ sessions: [empty] }),
        settings({ 'monitor.voice.cost': 'session' }),
      ).cost,
    ).toMatchObject({
      session: 0,
      unpriced: false,
    });
  });

  it('put the "estimate" label on the cost as the setting says', () => {
    const at = (value: string) =>
      projectVoiceMonitor(
        source(),
        settings({ 'monitor.voice.cost': 'session', 'monitor.voice.cost_flag': value }),
      ).cost;
    expect(at('always')?.estimateLabel).toBe(true);
    expect(at('unpriced')?.estimateLabel).toBe(false);
  });

  it('do not divide by a cap of zero', () => {
    const view = projectVoiceMonitor(
      source({ dailyCostCapUsd: 0, sessions: [session({ sessionCostCapUsd: 0 })] }),
      settings({ 'monitor.voice.cost': 'with_caps' }),
    );
    expect(view.cost?.caps).toMatchObject({ sessionPercent: null, dailyPercent: null });
  });

  it('put a token total and a cost on each row of the list only when those are shown', () => {
    const view = projectVoiceMonitor(
      source(),
      settings({
        'monitor.voice.sessions': 'all',
        'monitor.voice.tokens': 'total',
        'monitor.voice.cost': 'session',
      }),
    );
    expect(view.sessions.map((s) => s.tokens)).toEqual([1800, 1800, 1800]);
    expect(view.sessions.map((s) => s.costUsd)).toEqual([0.6, 0.6, 0.6]);
  });
});

describe('the conversation', () => {
  const at = (value: string, extra: Partial<Record<MonitorSettingKey, MonitorSettingValue>> = {}) =>
    projectVoiceMonitor(
      source(),
      settings({ 'monitor.voice.transcript': value, 'monitor.delay_s': 0, ...extra }),
    ).current;

  it('is hidden, only the assistant, or in full', () => {
    expect(at('hidden')?.lines).toBeNull();
    expect(at('assistant_only')?.lines?.map((l) => l.role)).toEqual(['assistant']);
    expect(at('full')?.lines?.map((l) => l.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('is masked by the level and by the blocked words', () => {
    const lines = at('full', { 'monitor.blocked_words': ['Acme'] })?.lines;
    expect(lines?.[0]?.text).toBe(`Open the ${MASK} project`);
    expect(lines?.[1]?.text).toBe(`Opening it. Mail ${MASK}`);
  });

  it('holds back the lines newer than the delay', () => {
    const delayed = at('full', { 'monitor.delay_s': 10 })?.lines;
    expect(delayed?.map((l) => l.text)).toHaveLength(2);
    expect(delayed?.some((l) => l.text === 'Thanks')).toBe(false);
    expect(at('full', { 'monitor.delay_s': 0 })?.lines).toHaveLength(3);
  });

  it('keeps only the last lines of a long conversation, each cut to a safe length', () => {
    const many: VoiceSourceMessage[] = Array.from({ length: 80 }, (_, i) => ({
      role: 'assistant',
      content: `line ${i}`,
      createdAt: ago(1000 - i),
    }));
    const lines = projectVoiceMonitor(
      source({ messages: many }),
      settings({ 'monitor.voice.transcript': 'full', 'monitor.delay_s': 0 }),
    ).current?.lines;
    expect(lines).toHaveLength(40);
    expect(lines?.at(-1)?.text).toBe('line 79');
    const long = projectVoiceMonitor(
      source({ messages: [{ role: 'user', content: 'x'.repeat(5000), createdAt: ago(100) }] }),
      settings({ 'monitor.voice.transcript': 'full', 'monitor.delay_s': 0 }),
    ).current?.lines?.[0]?.text;
    expect(long?.length).toBe(2000);
  });
});

describe('the action cards', () => {
  const at = (value: string, extra: Partial<Record<MonitorSettingKey, MonitorSettingValue>> = {}) =>
    projectVoiceMonitor(
      source(),
      settings({ 'monitor.voice.action_cards': value, 'monitor.delay_s': 0, ...extra }),
    ).current?.cards;

  it('are hidden, a summary, or with detail', () => {
    expect(at('hidden')).toBeNull();
    expect(at('summary')?.map((c) => c.detail)).toEqual([null, null]);
    expect(at('summary')?.map((c) => c.summary)).toEqual([
      'Open the project Acme',
      'Rename a stage',
    ]);
    expect(at('detail')?.[0]?.detail).toEqual({
      targetName: 'Acme',
      steps: ['read the project', 'open the page'],
      tier: 'T0',
      finishedAt: ago(49),
    });
  });

  it('are masked in the summary, the target and the steps', () => {
    const cards = at('detail', { 'monitor.blocked_words': ['Acme', 'page'] });
    expect(cards?.[0]?.summary).toBe(`Open the project ${MASK}`);
    expect(cards?.[0]?.detail?.targetName).toBe(MASK);
    expect(cards?.[0]?.detail?.steps).toEqual(['read the project', `open the ${MASK}`]);
  });

  it('wait for the delay like the lines do', () => {
    expect(at('summary', { 'monitor.delay_s': 10 })).toHaveLength(1);
  });
});

describe('the rest of what a screen can show', () => {
  it('lists the end reason of an ended session only when the setting says so', () => {
    const view = (on: boolean) =>
      projectVoiceMonitor(
        source(),
        settings({ 'monitor.voice.sessions': 'all', 'monitor.voice.end_reason': on }),
      );
    expect(view(true).sessions.map((s) => s.endReason)).toEqual([null, 'user', 'cap_cost']);
    expect(view(false).sessions.every((s) => s.endReason === null)).toBe(true);
  });

  it('shows the access of the assistant as scope, or scope and level, or not at all', () => {
    const at = (value: string) =>
      projectVoiceMonitor(source(), settings({ 'monitor.voice.access_info': value })).access;
    expect(at('hidden')).toBeNull();
    expect(at('scope')).toEqual({ scope: 'all_projects', level: null });
    expect(at('scope_level')).toEqual({ scope: 'all_projects', level: 'read' });
  });

  it('names the speaker as far as the setting allows, with the name masked', () => {
    const at = (value: string, words: string[] = []) =>
      projectVoiceMonitor(
        source(),
        settings({ 'monitor.voice.people': value, 'monitor.blocked_words': words }),
      ).sessions[0]?.person;
    expect(at('hidden')).toBeNull();
    expect(at('role')).toEqual({ role: 'owner', name: null });
    expect(at('first_name')).toEqual({ role: 'owner', name: 'Ali' });
    expect(at('full_name')).toEqual({ role: 'owner', name: 'Ali Rezaei' });
    expect(at('full_name', ['Rezaei'])).toEqual({ role: 'owner', name: `Ali ${MASK}` });
  });

  it('shows the state of the assistant as talking, ready or off, or not at all', () => {
    const state = (over: Partial<VoiceSourceSession>, on = true) =>
      projectVoiceMonitor(
        source({ sessions: [session(over)] }),
        settings({ 'monitor.voice.live_indicators': on }),
      ).indicator;
    expect(state({ lastActivityAt: ago(5) })).toBe('talking');
    expect(state({ lastActivityAt: ago(120) })).toBe('ready');
    expect(state({ status: 'ended', endReason: 'user' })).toBe('off');
    expect(state({}, false)).toBeNull();
  });

  it('shows nothing current, and not live, when no session is in scope', () => {
    const view = projectVoiceMonitor(source({ sessions: [endedToday] }), settings());
    expect(view.live).toBe(false);
    expect(view.current).toBeNull();
    expect(view.sessions).toEqual([]);
    expect(view.indicator).toBe('off');
  });

  it('masks the assistant name too', () => {
    expect(
      projectVoiceMonitor(source(), settings({ 'monitor.blocked_words': ['Docoo'] })).assistantName,
    ).toBe(MASK);
  });
});

// ---- the leak test ----------------------------------------------------------------------------

const SECRET = 'SECRET-SENTINEL-7731';

/** The source as the database might give it, with everything forbidden planted in it. */
function poisoned(): VoiceMonitorSource {
  const plant = <T extends object>(item: T, extra: Record<string, unknown>): T => ({
    ...item,
    ...extra,
  });
  return {
    ...source(),
    sessions: [live, endedToday, endedOld].map((s) =>
      plant(s, {
        accessProjectIds: [SECRET],
        connectionId: SECRET,
        executorConnectionId: SECRET,
        accessRules: [{ projectIds: [SECRET] }],
        params: { token: SECRET },
        caps: { secret: SECRET },
        userId: SECRET,
        email: `${SECRET}@example.com`,
      }),
    ),
    messages: messages.map((m) => plant(m, { id: SECRET, sessionId: SECRET })),
    actions: actions.map((a) =>
      plant(a, {
        params: { password: SECRET },
        result: { key: SECRET },
        errorCode: SECRET,
        projectId: SECRET,
        currentProjectId: SECRET,
        refusalReason: SECRET,
      }),
    ),
  };
}

/** A small deterministic generator, so a failure can be reproduced. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('nothing forbidden reaches a screen', () => {
  const voiceDefinitions = monitorSettingDefinitions.filter(
    (definition) => definition.group === 'voice' || definition.key === 'monitor.delay_s',
  );

  const everyOption = (definition: (typeof voiceDefinitions)[number]): MonitorSettingValue[] => {
    switch (definition.kind) {
      case 'choice':
        return [...definition.options];
      case 'boolean':
        return [true, false];
      default:
        return [definition.default];
    }
  };

  it('whatever the settings, the secrets planted in the source never come out', () => {
    const rng = random(20261109);
    const combos: Partial<Record<MonitorSettingKey, MonitorSettingValue>>[] = [];
    // Each setting at each of its choices, the others at their most open.
    for (const definition of voiceDefinitions) {
      for (const option of everyOption(definition)) combos.push({ [definition.key]: option });
    }
    // And many random mixes.
    for (let i = 0; i < 400; i += 1) {
      const combo: Partial<Record<MonitorSettingKey, MonitorSettingValue>> = {};
      for (const definition of voiceDefinitions) {
        const options = everyOption(definition);
        combo[definition.key] = options[Math.floor(rng() * options.length)] as MonitorSettingValue;
      }
      combos.push(combo);
    }
    for (const combo of combos) {
      const json = JSON.stringify(
        projectVoiceMonitor(poisoned(), settings({ 'monitor.delay_s': 0, ...combo })),
      );
      expect(json, JSON.stringify(combo)).not.toContain(SECRET);
      expect(json, JSON.stringify(combo)).not.toContain('params');
      expect(json, JSON.stringify(combo)).not.toContain('password');
    }
  });

  it('whatever the settings, a blocked word and an address in the work never come out', () => {
    const rng = random(7);
    const dirty: VoiceMonitorSource = {
      ...source(),
      messages: [
        {
          role: 'assistant',
          content: 'Acme at 10.1.2.3 mail boss@acme.example',
          createdAt: ago(100),
        },
        { role: 'user', content: 'call +98 912 345 6789 about Acme', createdAt: ago(100) },
      ],
      actions: [
        {
          status: 'executed',
          summary: 'Update Acme',
          targetName: 'Acme Ltd',
          steps: ['ask boss@acme.example'],
          tier: 'T1',
          proposedAt: ago(100),
          finishedAt: null,
        },
      ],
    };
    for (let i = 0; i < 200; i += 1) {
      const combo: Partial<Record<MonitorSettingKey, MonitorSettingValue>> = {
        'monitor.delay_s': 0,
        'monitor.blocked_words': ['Acme'],
        'monitor.redaction': rng() < 0.5 ? 'standard' : 'strict',
        'monitor.voice.transcript': rng() < 0.5 ? 'full' : 'assistant_only',
        'monitor.voice.action_cards': rng() < 0.5 ? 'detail' : 'summary',
      };
      const json = JSON.stringify(projectVoiceMonitor(dirty, settings(combo)));
      for (const forbidden of ['Acme', 'acme', '10.1.2.3', 'boss@', '912 345', '6789']) {
        expect(json, `${forbidden} ${JSON.stringify(combo)}`).not.toContain(forbidden);
      }
    }
  });

  it('gives back no field that is not part of the view', () => {
    const view = projectVoiceMonitor(
      poisoned(),
      settings({
        'monitor.voice.transcript': 'full',
        'monitor.voice.action_cards': 'detail',
        'monitor.voice.model_info': 'all',
        'monitor.voice.tokens': 'split_executor',
        'monitor.voice.cost': 'with_caps',
        'monitor.voice.access_info': 'scope_level',
        'monitor.voice.people': 'full_name',
        'monitor.voice.sessions': 'all',
        'monitor.delay_s': 0,
      }),
    );
    expect(Object.keys(view).sort()).toEqual(
      [
        'access',
        'assistantName',
        'cost',
        'current',
        'delayS',
        'generatedAt',
        'indicator',
        'live',
        'model',
        'sessions',
        'tokens',
      ].sort(),
    );
    expect(Object.keys(view.sessions[0] ?? {}).sort()).toEqual(
      [
        'costUsd',
        'current',
        'endReason',
        'id',
        'live',
        'messageCount',
        'minutes',
        'person',
        'startedAt',
        'tokens',
      ].sort(),
    );
    expect(Object.keys(view.current?.cards?.[0] ?? {}).sort()).toEqual([
      'at',
      'detail',
      'status',
      'summary',
    ]);
    expect(Object.keys(view.current?.cards?.[0]?.detail ?? {}).sort()).toEqual([
      'finishedAt',
      'steps',
      'targetName',
      'tier',
    ]);
    expect(Object.keys(view.current?.lines?.[0] ?? {}).sort()).toEqual(['at', 'role', 'text']);
  });
});
