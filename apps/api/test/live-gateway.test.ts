import { liveAssistantDefaults, liveAssistantSettingDefaults } from '@docoo/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  defineCapability,
  LiveCapabilityRegistry,
  type LiveCapability,
} from '../src/live-assistant/capabilities.js';
import {
  decideProposal,
  judgeConfirmation,
  liveSettingsFrom,
  localeOf,
  MIN_SECOND_CONFIRMATION_MS,
  nextStepOf,
  startBlocker,
  type LiveSettings,
} from '../src/live-assistant/live-gateway.js';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

const ready = {
  'live_assistant.enabled': true,
  'live_assistant.disclosure_accepted': true,
  'live_assistant.connection_id': P1,
  'live_assistant.model': 'some-realtime-model',
};
const settings = (over: Record<string, unknown> = {}): LiveSettings =>
  liveSettingsFrom({ ...ready, ...over });

const projectParams = z.object({ projectId: z.uuid(), reason: z.string().min(1).max(200) });
const capability = (
  name: string,
  klass: 'T0' | 'T1' | 'T2' | 'T3',
  over: Partial<LiveCapability<z.infer<typeof projectParams>, unknown>> = {},
) =>
  defineCapability<z.infer<typeof projectParams>, unknown>({
    meta: {
      name,
      klass,
      area: 'project',
      write: klass !== 'T0',
      ...(klass === 'T3' ? { t3Category: 'delete' as const } : {}),
    },
    params: projectParams,
    projectOf: (params) => params.projectId,
    describe: (params) => ({
      summary: `do ${name} on ${params.projectId}`,
      targetName: 'Spring plan',
    }),
    execute: () => Promise.resolve({ done: true }),
    ...over,
  });

const registry = new LiveCapabilityRegistry([
  capability('project.read', 'T0'),
  capability('project.pause', 'T1'),
  capability('project.spend', 'T2'),
  capability('project.remove', 'T3'),
]);

const propose = (
  name: string,
  over: {
    settings?: LiveSettings;
    params?: unknown;
    tainted?: boolean;
    current?: string | null;
  } = {},
) =>
  decideProposal({
    registry,
    capability: name,
    params: over.params ?? { projectId: P1, reason: 'because' },
    settings: over.settings ?? settings({ 'live_assistant.access_level': 'act' }),
    tainted: over.tainted ?? false,
    currentProjectId: over.current ?? null,
  });

describe('the settings the gateway reads', () => {
  it('are the safe defaults for a workspace that set nothing: off, all projects, read only', () => {
    const fresh = liveSettingsFrom({});
    expect(fresh.enabled).toBe(false);
    expect(fresh.disclosureAccepted).toBe(false);
    expect(fresh.rules).toEqual([{ scope: { mode: 'all_projects' }, level: 'read' }]);
    expect(fresh.caps.sessionCostCapUsd).toBe(liveAssistantDefaults.sessionCostCapUsd);
    expect(fresh.enabledT3).toEqual([]);
    expect(fresh.strictness).toBe('standard');
    expect(startBlocker(fresh)).toBe('disabled');
  });

  it('take a stored value over the default, and the narrow default over a value that makes no sense', () => {
    const wide = liveSettingsFrom({
      'live_assistant.access_scope': 'backoffice',
      'live_assistant.access_level': 'act',
      'live_assistant.session_cost_cap_usd': 7.5,
      'live_assistant.t3_categories': ['delete', 'secrets'],
    });
    expect(wide.rules).toEqual([{ scope: { mode: 'backoffice' }, level: 'act' }]);
    expect(wide.caps.sessionCostCapUsd).toBe(7.5);
    expect(wide.enabledT3).toEqual(['delete']);

    const broken = liveSettingsFrom({
      'live_assistant.access_scope': 'everything',
      'live_assistant.session_max_minutes': 600,
      'live_assistant.mode': 'telepathy',
      'live_assistant.confirm_strictness': 'lenient',
    });
    expect(broken.rules).toEqual([]);
    expect(broken.caps.sessionMaxMinutes).toBe(liveAssistantDefaults.sessionMaxMinutes);
    expect(broken.mode).toBe(liveAssistantSettingDefaults['live_assistant.mode']);
    expect(broken.strictness).toBe('standard');
  });

  it('say why a session cannot start, in the order the owner fixes things', () => {
    expect(startBlocker(liveSettingsFrom({}))).toBe('disabled');
    expect(startBlocker(liveSettingsFrom({ 'live_assistant.enabled': true }))).toBe('disclosure');
    expect(
      startBlocker(
        liveSettingsFrom({
          'live_assistant.enabled': true,
          'live_assistant.disclosure_accepted': true,
        }),
      ),
    ).toBe('not_configured');
    expect(startBlocker(settings())).toBeNull();
    expect(
      startBlocker(
        liveSettingsFrom({
          'live_assistant.enabled': true,
          'live_assistant.disclosure_accepted': true,
          'live_assistant.mode': 'pipeline',
        }),
      ),
    ).toBeNull();
  });

  it('speak Persian unless the owner chose English', () => {
    expect(localeOf('fa')).toBe('fa');
    expect(localeOf('auto')).toBe('fa');
    expect(localeOf('en')).toBe('en');
  });
});

describe('the capability registry', () => {
  it('refuses a set that is inconsistent, so a mistake stops at start-up and not at the owner', () => {
    expect(
      () => new LiveCapabilityRegistry([capability('a.b', 'T1'), capability('a.b', 'T1')]),
    ).toThrow(/twice/u);
    expect(() => new LiveCapabilityRegistry([capability('Bad Name', 'T1')])).toThrow(
      /not allowed/u,
    );
    expect(
      () =>
        new LiveCapabilityRegistry([
          defineCapability({
            ...capability('x.y', 'T1'),
            meta: { name: 'x.y', klass: 'forbidden', area: 'backoffice', write: true },
          }),
        ]),
    ).toThrow(/forbidden/u);
    expect(
      () =>
        new LiveCapabilityRegistry([
          defineCapability({
            ...capability('x.y', 'T1'),
            meta: { name: 'x.y', klass: 'T1', area: 'backoffice', write: false },
          }),
        ]),
    ).toThrow(/only a read is T0/u);
    expect(
      () =>
        new LiveCapabilityRegistry([
          defineCapability({
            ...capability('x.y', 'T1'),
            projectOf: undefined,
          }),
        ]),
    ).toThrow(/which one/u);
    expect(
      () =>
        new LiveCapabilityRegistry([
          defineCapability({
            ...capability('x.y', 'T3'),
            meta: { name: 'x.y', klass: 'T3', area: 'project', write: true },
          }),
        ]),
    ).toThrow(/category/u);
  });

  it('does not find a name that only exists on the prototype', () => {
    expect(registry.get('constructor')).toBeUndefined();
    expect(registry.get('__proto__')).toBeUndefined();
    expect(registry.get('toString')).toBeUndefined();
  });
});

describe('proposing a change', () => {
  it('refuses a name nobody registered, whatever the model says', () => {
    expect(propose('project.delete_everything')).toEqual({
      outcome: 'refused',
      reason: 'unknown_capability',
    });
    expect(propose('constructor')).toEqual({ outcome: 'refused', reason: 'unknown_capability' });
  });

  it('refuses parameters that do not fit, and never lets the model name a different project', () => {
    expect(propose('project.pause', { params: { projectId: 'nope', reason: 'x' } })).toEqual({
      outcome: 'refused',
      reason: 'invalid_params',
    });
    expect(
      propose('project.pause', { params: { projectId: P1, reason: 'x', extra: 1 } }),
    ).toMatchObject({ outcome: 'accepted' });
    const accepted = propose('project.pause', { params: { projectId: P1, reason: 'x', extra: 1 } });
    if (accepted.outcome === 'accepted') {
      expect(accepted.params).toEqual({ projectId: P1, reason: 'x' });
      expect(accepted.projectId).toBe(P1);
    }
  });

  it('lets a read run with no confirmation, and asks for one for every change', () => {
    expect(propose('project.read', { settings: settings() })).toMatchObject({
      outcome: 'accepted',
      tier: 'T0',
      steps: [],
    });
    expect(propose('project.pause')).toMatchObject({
      outcome: 'accepted',
      tier: 'T1',
      steps: ['preview', 'voice_or_click'],
    });
    expect(propose('project.spend')).toMatchObject({
      outcome: 'accepted',
      tier: 'T2',
      steps: ['preview', 'readback', 'voice_or_click'],
    });
  });

  it('keeps a changing assistant read only until the owner raises the level', () => {
    expect(propose('project.pause', { settings: settings() })).toEqual({
      outcome: 'refused',
      reason: 'read_only',
    });
    expect(propose('project.read', { settings: settings() }).outcome).toBe('accepted');
  });

  it('stays inside the projects the owner chose', () => {
    const chosen = settings({
      'live_assistant.access_scope': 'selected_projects',
      'live_assistant.access_level': 'act',
      'live_assistant.access_project_ids': [P1],
    });
    expect(propose('project.pause', { settings: chosen }).outcome).toBe('accepted');
    expect(
      propose('project.pause', { settings: chosen, params: { projectId: P2, reason: 'x' } }),
    ).toEqual({ outcome: 'refused', reason: 'out_of_scope' });
    const withOpen = settings({
      'live_assistant.access_scope': 'selected_projects',
      'live_assistant.access_level': 'act',
      'live_assistant.access_include_current': true,
    });
    expect(
      propose('project.pause', {
        settings: withOpen,
        params: { projectId: P2, reason: 'x' },
        current: P2,
      }).outcome,
    ).toBe('accepted');
    expect(
      propose('project.pause', {
        settings: withOpen,
        params: { projectId: P2, reason: 'x' },
        current: P1,
      }),
    ).toEqual({ outcome: 'refused', reason: 'out_of_scope' });
  });

  it('raises a reversible change to consequential when untrusted content was read or strict mode is on', () => {
    expect(propose('project.pause', { tainted: true })).toMatchObject({ tier: 'T2' });
    expect(
      propose('project.pause', {
        settings: settings({
          'live_assistant.access_level': 'act',
          'live_assistant.confirm_strictness': 'strict',
        }),
      }),
    ).toMatchObject({ tier: 'T2' });
    // It never lowers: a T2 stays T2, and a read stays a read.
    expect(propose('project.spend', { tainted: false }).outcome).toBe('accepted');
  });

  it('keeps irreversible changes off until their category is switched on, then needs two confirmations', () => {
    expect(propose('project.remove')).toEqual({ outcome: 'refused', reason: 't3_disabled' });
    const on = settings({
      'live_assistant.access_level': 'act',
      'live_assistant.t3_categories': ['delete'],
    });
    expect(propose('project.remove', { settings: on })).toMatchObject({
      outcome: 'accepted',
      tier: 'T3',
      steps: ['preview', 'readback', 'voice_or_click', 'target_echo_or_click'],
    });
    const wrongCategory = settings({
      'live_assistant.access_level': 'act',
      'live_assistant.t3_categories': ['accounts'],
    });
    expect(propose('project.remove', { settings: wrongCategory })).toEqual({
      outcome: 'refused',
      reason: 't3_disabled',
    });
  });

  it('refuses an irreversible change that cannot name its target, and a preview that fails', () => {
    const noName = new LiveCapabilityRegistry([
      capability('project.remove', 'T3', {
        describe: () => ({ summary: 'remove it' }),
      }),
      capability('project.boom', 'T1', {
        describe: () => {
          throw new Error('bug');
        },
      }),
      capability('project.blank', 'T1', { describe: () => ({ summary: '   ' }) }),
    ]);
    const on = settings({
      'live_assistant.access_level': 'act',
      'live_assistant.t3_categories': ['delete'],
    });
    for (const name of ['project.remove', 'project.boom', 'project.blank']) {
      expect(
        decideProposal({
          registry: noName,
          capability: name,
          params: { projectId: P1, reason: 'x' },
          settings: on,
          tainted: false,
          currentProjectId: null,
        }),
      ).toEqual({ outcome: 'refused', reason: 'misconfigured' });
    }
  });

  it('can do nothing when the access settings make no sense', () => {
    const none = settings({ 'live_assistant.access_scope': 'everything' });
    expect(propose('project.read', { settings: none })).toEqual({
      outcome: 'refused',
      reason: 'out_of_scope',
    });
  });
});

describe('reading a confirmation', () => {
  const base = { tier: 'T1' as const, targetName: 'Spring plan', nowMs: 1_000_000 };

  it('counts a click, and a clear yes in Persian or English', () => {
    expect(judgeConfirmation({ ...base, status: 'proposed', via: 'click' })).toEqual({
      outcome: 'advance',
      via: 'click',
    });
    for (const yes of ['تایید', 'تأیید می‌کنم', 'بله انجامش بده', 'yes', 'Confirm']) {
      expect(
        judgeConfirmation({ ...base, status: 'proposed', via: 'voice', transcript: yes }),
      ).toEqual({
        outcome: 'advance',
        via: 'voice',
      });
    }
  });

  it('declines on a clear no, and asks again on anything unclear', () => {
    for (const no of ['نه', 'نه انجامش نده', 'cancel', 'no']) {
      expect(
        judgeConfirmation({ ...base, status: 'proposed', via: 'voice', transcript: no }),
      ).toEqual({
        outcome: 'decline',
      });
    }
    for (const unclear of ['هوم', 'شاید', 'what', '   ']) {
      expect(
        judgeConfirmation({ ...base, status: 'proposed', via: 'voice', transcript: unclear }),
      ).toEqual({ outcome: 'retry', reason: 'unclear' });
    }
  });

  it('never counts a spoken answer that carries no words', () => {
    expect(judgeConfirmation({ ...base, status: 'proposed', via: 'voice' })).toEqual({
      outcome: 'retry',
      reason: 'unclear',
    });
  });

  it('needs the name of the thing itself for the second step of an irreversible change', () => {
    const second = {
      ...base,
      tier: 'T3' as const,
      status: 'first_confirmed' as const,
      firstConfirmedAtMs: base.nowMs - MIN_SECOND_CONFIRMATION_MS - 1,
    };
    expect(judgeConfirmation({ ...second, via: 'voice', transcript: 'بله تایید' })).toEqual({
      outcome: 'retry',
      reason: 'echo_mismatch',
    });
    expect(judgeConfirmation({ ...second, via: 'voice', transcript: 'Spring plan' })).toEqual({
      outcome: 'advance',
      via: 'voice',
    });
    expect(judgeConfirmation({ ...second, via: 'voice', transcript: 'نه spring plan نه' })).toEqual(
      {
        outcome: 'decline',
      },
    );
    expect(judgeConfirmation({ ...second, via: 'click' })).toEqual({
      outcome: 'advance',
      via: 'click',
    });
    expect(
      judgeConfirmation({ ...second, targetName: null, via: 'voice', transcript: 'Spring plan' }),
    ).toEqual({ outcome: 'retry', reason: 'echo_mismatch' });
  });

  it('does not take the second confirmation in the same breath as the first', () => {
    const quick = {
      ...base,
      tier: 'T3' as const,
      status: 'first_confirmed' as const,
      firstConfirmedAtMs: base.nowMs - 200,
      via: 'click' as const,
    };
    expect(judgeConfirmation(quick)).toEqual({ outcome: 'retry', reason: 'too_soon' });
    expect(judgeConfirmation({ ...quick, nowMs: base.nowMs + MIN_SECOND_CONFIRMATION_MS })).toEqual(
      {
        outcome: 'advance',
        via: 'click',
      },
    );
  });

  it('counts nothing once a change is no longer waiting', () => {
    for (const status of [
      'confirmed',
      'executed',
      'failed',
      'cancelled',
      'expired',
      'refused',
    ] as const) {
      expect(judgeConfirmation({ ...base, status, via: 'click' })).toEqual({
        outcome: 'retry',
        reason: 'not_open',
      });
    }
  });

  it('tells the screen what the next confirmation must be', () => {
    expect(nextStepOf('proposed')).toBe('confirm');
    expect(nextStepOf('first_confirmed')).toBe('echo');
    for (const status of [
      'confirmed',
      'executed',
      'failed',
      'cancelled',
      'expired',
      'refused',
    ] as const) {
      expect(nextStepOf(status)).toBeNull();
    }
  });
});
