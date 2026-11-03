import { describe, expect, it } from 'vitest';

import {
  type AssistantAccessRule,
  type CapabilityMeta,
  assistantAccessRulesSchema,
  liveActionStatuses,
  decideCapability,
  defaultAssistantAccessRules,
  evaluateAssistantAccess,
  evaluateCaps,
  isLiveActionExpired,
  liveAssistantCapsSchema,
  liveAssistantDefaults,
  matchTargetEcho,
  nextLiveActionStatus,
  normalizeSpoken,
  planConfirmation,
  readSpokenAnswer,
  terminalLiveActionStatuses,
} from './live-assistant.js';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

const allProjectsRead: AssistantAccessRule[] = [{ scope: { mode: 'all_projects' }, level: 'read' }];
const allProjectsAct: AssistantAccessRule[] = [{ scope: { mode: 'all_projects' }, level: 'act' }];
const backofficeRead: AssistantAccessRule[] = [{ scope: { mode: 'backoffice' }, level: 'read' }];
const selected = (level: 'read' | 'act', includeCurrent = false): AssistantAccessRule[] => [
  { scope: { mode: 'selected_projects', projectIds: [P1], includeCurrent }, level },
];

describe('access rules', () => {
  it('start with the projects area, read only', () => {
    expect(defaultAssistantAccessRules()).toEqual(allProjectsRead);
    expect(assistantAccessRulesSchema.safeParse(defaultAssistantAccessRules()).success).toBe(true);
  });

  it('refuse an empty list, an unknown mode and a project id that is not a uuid', () => {
    expect(assistantAccessRulesSchema.safeParse([]).success).toBe(false);
    expect(
      assistantAccessRulesSchema.safeParse([{ scope: { mode: 'everything' }, level: 'read' }])
        .success,
    ).toBe(false);
    expect(
      assistantAccessRulesSchema.safeParse([
        {
          scope: { mode: 'selected_projects', projectIds: ['abc'], includeCurrent: false },
          level: 'act',
        },
      ]).success,
    ).toBe(false);
  });

  it('all-projects reaches every project and the overview but not the rest of the back office', () => {
    const read = (target: Parameters<typeof evaluateAssistantAccess>[1]['target']) =>
      evaluateAssistantAccess(allProjectsRead, { target, write: false });
    expect(read({ area: 'project', projectId: P1 })).toEqual({ allowed: true });
    expect(read({ area: 'projects_overview' })).toEqual({ allowed: true });
    expect(read({ area: 'backoffice' })).toEqual({ allowed: false, reason: 'out_of_scope' });
  });

  it('read level never allows a change, act level does', () => {
    const target = { area: 'project', projectId: P1 } as const;
    expect(evaluateAssistantAccess(allProjectsRead, { target, write: true })).toEqual({
      allowed: false,
      reason: 'read_only',
    });
    expect(evaluateAssistantAccess(allProjectsAct, { target, write: true })).toEqual({
      allowed: true,
    });
    expect(evaluateAssistantAccess(allProjectsAct, { target, write: false })).toEqual({
      allowed: true,
    });
  });

  it('the whole back office reaches everything', () => {
    for (const target of [
      { area: 'backoffice' },
      { area: 'projects_overview' },
      { area: 'project', projectId: P2 },
    ] as const) {
      expect(evaluateAssistantAccess(backofficeRead, { target, write: false }).allowed).toBe(true);
    }
  });

  it('chosen projects reach only those, not the overview or other projects', () => {
    const read = (target: Parameters<typeof evaluateAssistantAccess>[1]['target']) =>
      evaluateAssistantAccess(selected('act'), { target, write: false });
    expect(read({ area: 'project', projectId: P1 }).allowed).toBe(true);
    expect(read({ area: 'project', projectId: P2 })).toEqual({
      allowed: false,
      reason: 'out_of_scope',
    });
    expect(read({ area: 'projects_overview' })).toEqual({ allowed: false, reason: 'out_of_scope' });
    expect(read({ area: 'backoffice' })).toEqual({ allowed: false, reason: 'out_of_scope' });
  });

  it('"the project that is open now" counts only when switched on and only for that project', () => {
    const target = { area: 'project', projectId: P2 } as const;
    expect(
      evaluateAssistantAccess(selected('act', false), { target, write: true, currentProjectId: P2 })
        .allowed,
    ).toBe(false);
    expect(
      evaluateAssistantAccess(selected('act', true), { target, write: true, currentProjectId: P2 })
        .allowed,
    ).toBe(true);
    expect(
      evaluateAssistantAccess(selected('act', true), { target, write: true, currentProjectId: P1 })
        .allowed,
    ).toBe(false);
    expect(evaluateAssistantAccess(selected('act', true), { target, write: true }).allowed).toBe(
      false,
    );
  });

  it('rules combine as a union: read everywhere, act in one project', () => {
    const rules: AssistantAccessRule[] = [...backofficeRead, ...selected('act')];
    const p1 = { area: 'project', projectId: P1 } as const;
    const p2 = { area: 'project', projectId: P2 } as const;
    expect(evaluateAssistantAccess(rules, { target: p1, write: true }).allowed).toBe(true);
    expect(evaluateAssistantAccess(rules, { target: p2, write: true })).toEqual({
      allowed: false,
      reason: 'read_only',
    });
    expect(evaluateAssistantAccess(rules, { target: p2, write: false }).allowed).toBe(true);
  });

  it('no rules allows nothing', () => {
    expect(evaluateAssistantAccess([], { target: { area: 'backoffice' }, write: false })).toEqual({
      allowed: false,
      reason: 'out_of_scope',
    });
  });
});

describe('confirmation plans', () => {
  const plan = (klass: Parameters<typeof planConfirmation>[0]['klass'], over = {}) =>
    planConfirmation({ klass, tainted: false, strictness: 'standard', t3Enabled: false, ...over });

  it('reads need no confirmation', () => {
    expect(plan('T0')).toEqual({ allowed: true, tier: 'T0', steps: [] });
  });

  it('a simple change needs a preview and one spoken or clicked confirmation', () => {
    expect(plan('T1')).toEqual({ allowed: true, tier: 'T1', steps: ['preview', 'voice_or_click'] });
  });

  it('a costly change also has its target and cost read back first', () => {
    expect(plan('T2')).toEqual({
      allowed: true,
      tier: 'T2',
      steps: ['preview', 'readback', 'voice_or_click'],
    });
  });

  it('untrusted content read in the turn, or strict mode, lifts a simple change one tier', () => {
    expect(plan('T1', { tainted: true })).toMatchObject({ tier: 'T2' });
    expect(plan('T1', { strictness: 'strict' })).toMatchObject({ tier: 'T2' });
    expect(plan('T2', { tainted: true })).toMatchObject({ tier: 'T2' });
    expect(plan('T0', { tainted: true, strictness: 'strict' })).toMatchObject({ tier: 'T0' });
  });

  it('an irreversible change is off until enabled, then needs two confirmations', () => {
    expect(plan('T3')).toEqual({ allowed: false, reason: 't3_disabled' });
    expect(plan('T3', { t3Enabled: true })).toEqual({
      allowed: true,
      tier: 'T3',
      steps: ['preview', 'readback', 'voice_or_click', 'target_echo_or_click'],
    });
  });

  it('taint cannot switch a disabled T3 on', () => {
    expect(plan('T3', { tainted: true })).toEqual({ allowed: false, reason: 't3_disabled' });
  });

  it('forbidden stays forbidden whatever is enabled', () => {
    expect(plan('forbidden', { t3Enabled: true })).toEqual({ allowed: false, reason: 'forbidden' });
  });
});

describe('the capability gateway decision', () => {
  const create: CapabilityMeta = {
    name: 'create_project',
    klass: 'T1',
    area: 'project',
    write: true,
  };
  const read: CapabilityMeta = { name: 'read_stage', klass: 'T0', area: 'project', write: false };
  const settings: CapabilityMeta = {
    name: 'set_setting',
    klass: 'T1',
    area: 'backoffice',
    write: true,
  };
  const remove: CapabilityMeta = {
    name: 'delete_project',
    klass: 'T3',
    area: 'project',
    write: true,
    t3Category: 'delete',
  };
  const base = { tainted: false, strictness: 'standard', enabledT3: [] } as const;

  it('allows a change inside scope at act level and returns its plan', () => {
    const result = decideCapability({
      ...base,
      capability: create,
      rules: selected('act'),
      projectId: P1,
    });
    expect(result).toMatchObject({ allowed: true, plan: { tier: 'T1' } });
  });

  it('refuses a change at read level, outside scope, or without a project', () => {
    expect(
      decideCapability({ ...base, capability: create, rules: allProjectsRead, projectId: P1 }),
    ).toEqual({
      allowed: false,
      reason: 'read_only',
    });
    expect(
      decideCapability({ ...base, capability: create, rules: selected('act'), projectId: P2 }),
    ).toEqual({
      allowed: false,
      reason: 'out_of_scope',
    });
    expect(decideCapability({ ...base, capability: create, rules: allProjectsAct })).toEqual({
      allowed: false,
      reason: 'project_required',
    });
    expect(decideCapability({ ...base, capability: settings, rules: allProjectsAct })).toEqual({
      allowed: false,
      reason: 'out_of_scope',
    });
  });

  it('reading in scope needs no confirmation even at read level', () => {
    expect(
      decideCapability({ ...base, capability: read, rules: allProjectsRead, projectId: P1 }),
    ).toEqual({
      allowed: true,
      plan: { allowed: true, tier: 'T0', steps: [] },
    });
  });

  it('an irreversible change needs both the scope and the owner to have enabled its category', () => {
    const args = {
      ...base,
      capability: remove,
      rules: backofficeRead.map((r) => ({ ...r, level: 'act' as const })),
      projectId: P1,
    };
    expect(decideCapability(args)).toEqual({ allowed: false, reason: 't3_disabled' });
    expect(decideCapability({ ...args, enabledT3: ['accounts'] })).toEqual({
      allowed: false,
      reason: 't3_disabled',
    });
    expect(decideCapability({ ...args, enabledT3: ['delete'] })).toMatchObject({
      allowed: true,
      plan: { tier: 'T3' },
    });
  });

  it('a forbidden capability is refused even with every permission', () => {
    const secret: CapabilityMeta = {
      name: 'read_key',
      klass: 'forbidden',
      area: 'backoffice',
      write: false,
    };
    expect(
      decideCapability({
        ...base,
        capability: secret,
        rules: [{ scope: { mode: 'backoffice' }, level: 'act' }],
      }),
    ).toEqual({ allowed: false, reason: 'forbidden' });
  });

  it('a capability whose class and write flag disagree fails closed', () => {
    const rules = [
      { scope: { mode: 'backoffice' }, level: 'act' },
    ] as const satisfies AssistantAccessRule[];
    const writeButT0: CapabilityMeta = { name: 'x', klass: 'T0', area: 'backoffice', write: true };
    const readButT1: CapabilityMeta = { name: 'y', klass: 'T1', area: 'backoffice', write: false };
    expect(decideCapability({ ...base, capability: writeButT0, rules })).toEqual({
      allowed: false,
      reason: 'misconfigured',
    });
    expect(decideCapability({ ...base, capability: readButT1, rules })).toEqual({
      allowed: false,
      reason: 'misconfigured',
    });
  });
});

describe('normalizeSpoken', () => {
  it('unifies letters, digits, marks, half-spaces and punctuation', () => {
    expect(normalizeSpoken('تأیید می‌کنم!')).toBe('تایید می کنم');
    expect(normalizeSpoken('پروژهٔ ۱۲، «طرح»؟')).toBe('پروژه 12 طرح');
    expect(normalizeSpoken('آره   OK.')).toBe('اره ok');
    expect(normalizeSpoken("Don't do it")).toBe('do not do it');
  });
});

describe('reading a spoken answer', () => {
  const confirms = [
    'بله',
    'بله، انجامش بده',
    'تایید',
    'تأیید می‌کنم',
    'تایید میکنم',
    'تایید نهایی',
    'آره',
    'اره انجام بده',
    'ثبتش کن',
    'لطفا ثبت کن',
    'درسته',
    'بله تایید',
    'اوکی انجام بده',
    'باشه، تایید',
    'yes',
    'Yes, please.',
    'do it',
    'Confirm',
    'go ahead',
    'ok do it',
  ];
  it.each(confirms)('confirms "%s"', (text) => {
    expect(readSpokenAnswer(text)).toBe('confirm');
  });

  const rejects = [
    'نه',
    'نه، لغوش کن',
    'نخیر',
    'تایید نکن',
    'تایید نمی‌کنم',
    'بله ولی صبر کن',
    'بله نه',
    'انجامش نده',
    'انجامش ندید',
    'نذار ثبت بشه',
    'اشتباه است',
    'مخالفم',
    'انصراف',
    'no',
    "don't do it",
    'stop',
    'cancel that',
  ];
  it.each(rejects)('rejects "%s"', (text) => {
    expect(readSpokenAnswer(text)).toBe('reject');
  });

  const unclear = [
    '',
    '   ',
    'اوکی',
    'ok',
    'باشه',
    'بله؟',
    'مطمئنی؟',
    'پروژه را حذف کن',
    'بله من فکر می‌کنم باید یک بار دیگر همه چیز را با دقت بررسی کنیم',
    'hmm',
    'تایید تایید تایید تایید',
  ];
  it.each(unclear)('cannot tell for "%s"', (text) => {
    expect(readSpokenAnswer(text)).toBe('unclear');
  });

  it('"final confirmation" is not mistaken for a "no" because it contains the letters of one', () => {
    expect(readSpokenAnswer('تایید نهایی')).toBe('confirm');
  });
});

describe('echoing the target of a T3 change', () => {
  it('accepts the exact name inside a sentence', () => {
    expect(matchTargetEcho('حذف پروژه طرح فروش بهاره تایید', 'طرح فروش بهاره')).toBe(true);
    expect(matchTargetEcho('طرح فروش بهاره', 'طرح فروش بهاره')).toBe(true);
  });

  it('ignores digit style and half-spaces', () => {
    expect(matchTargetEcho('پروژه 12 را حذف کن', 'پروژه ۱۲')).toBe(true);
    expect(matchTargetEcho('گزارش نیم فاصله', 'گزارش نیم‌فاصله')).toBe(true);
  });

  it('rejects another name, a bare confirmation, and a partial word', () => {
    expect(matchTargetEcho('طرح فروش پاییزه', 'طرح فروش بهاره')).toBe(false);
    expect(matchTargetEcho('تایید', 'طرح فروش بهاره')).toBe(false);
    expect(matchTargetEcho('طرح فروش بهارهها', 'طرح فروش بهاره')).toBe(false);
  });

  it('never accepts a negation, and a name too short to tell apart needs a click', () => {
    expect(matchTargetEcho('نه طرح فروش بهاره را حذف نکن', 'طرح فروش بهاره')).toBe(false);
    expect(matchTargetEcho('الف', 'الف')).toBe(false);
    expect(matchTargetEcho('', '')).toBe(false);
  });
});

describe('caps', () => {
  const caps = {
    sessionCostCapUsd: 5,
    sessionMaxMinutes: 30,
    dailyCostCapUsd: 20,
    taskCostCapUsd: 1,
  };
  const usage = { sessionCostUsd: 1, sessionMinutes: 5, dailyCostUsd: 3 };

  it('is ok well under every cap', () => {
    expect(evaluateCaps(usage, caps)).toEqual({ status: 'ok' });
  });

  it('warns from 80% and names which cap', () => {
    expect(evaluateCaps({ ...usage, sessionCostUsd: 4 }, caps)).toEqual({
      status: 'warn',
      which: ['session_cost'],
    });
    expect(evaluateCaps({ ...usage, sessionCostUsd: 3.99 }, caps).status).toBe('ok');
  });

  it('is exceeded at the cap itself, and exceeding beats warning', () => {
    expect(evaluateCaps({ ...usage, sessionMinutes: 30, dailyCostUsd: 17 }, caps)).toEqual({
      status: 'exceeded',
      which: ['session_minutes'],
    });
  });

  it('checks the cost of the current task only when it is given', () => {
    expect(evaluateCaps({ ...usage, taskCostUsd: 1 }, caps)).toEqual({
      status: 'exceeded',
      which: ['task_cost'],
    });
    expect(evaluateCaps({ ...usage, taskCostUsd: 0.5 }, caps)).toEqual({ status: 'ok' });
  });

  it('fails closed when a measurement is not a sane number', () => {
    expect(evaluateCaps({ ...usage, sessionCostUsd: Number.NaN }, caps).status).toBe('exceeded');
    expect(evaluateCaps({ ...usage, dailyCostUsd: -1 }, caps).status).toBe('exceeded');
    expect(evaluateCaps({ ...usage, sessionMinutes: Number.POSITIVE_INFINITY }, caps).status).toBe(
      'exceeded',
    );
  });

  it('the proposed defaults sit inside the allowed ranges', () => {
    expect(liveAssistantCapsSchema.safeParse(liveAssistantDefaults).success).toBe(true);
  });

  it('refuses caps outside the allowed ranges, including a session longer than the provider allows', () => {
    expect(
      liveAssistantCapsSchema.safeParse({ ...liveAssistantDefaults, sessionMaxMinutes: 60 })
        .success,
    ).toBe(false);
    expect(
      liveAssistantCapsSchema.safeParse({ ...liveAssistantDefaults, maxActionsPerTask: 2.5 })
        .success,
    ).toBe(false);
  });
});

describe('the action ledger', () => {
  it('a simple change goes proposed, confirmed, executed', () => {
    expect(nextLiveActionStatus('proposed', 'confirm')).toBe('confirmed');
    expect(nextLiveActionStatus('confirmed', 'executed')).toBe('executed');
    expect(nextLiveActionStatus('confirmed', 'failed')).toBe('failed');
  });

  it('an irreversible change passes through first_confirmed before it can run', () => {
    expect(nextLiveActionStatus('proposed', 'confirm', { doubleConfirmation: true })).toBe(
      'first_confirmed',
    );
    expect(nextLiveActionStatus('first_confirmed', 'confirm')).toBe('confirmed');
    expect(nextLiveActionStatus('first_confirmed', 'executed')).toBeNull();
  });

  it('can be cancelled or can expire until it is confirmed, and not after', () => {
    for (const from of ['proposed', 'first_confirmed'] as const) {
      expect(nextLiveActionStatus(from, 'cancel')).toBe('cancelled');
      expect(nextLiveActionStatus(from, 'expire')).toBe('expired');
    }
    expect(nextLiveActionStatus('confirmed', 'cancel')).toBeNull();
    expect(nextLiveActionStatus('confirmed', 'expire')).toBeNull();
  });

  it('nothing runs without being confirmed, and a finished action never moves', () => {
    expect(nextLiveActionStatus('proposed', 'executed')).toBeNull();
    for (const done of terminalLiveActionStatuses) {
      for (const event of ['confirm', 'cancel', 'expire', 'executed', 'failed'] as const) {
        expect(nextLiveActionStatus(done, event)).toBeNull();
      }
    }
    expect(terminalLiveActionStatuses.every((status) => liveActionStatuses.includes(status))).toBe(
      true,
    );
  });

  it('an unconfirmed action expires at its timeout, never before', () => {
    expect(isLiveActionExpired(0, 299_999, 300)).toBe(false);
    expect(isLiveActionExpired(0, 300_000, 300)).toBe(true);
  });
});
