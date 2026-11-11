import { describe, expect, it } from 'vitest';

import {
  createMonitorShareLinkSchema,
  detectMonitorPreset,
  isMonitorSettingValue,
  monitorDelayChoices,
  monitorLimits,
  monitorPresetKeys,
  monitorPresets,
  monitorPresetValues,
  monitorSettingDefaults,
  monitorSettingDefinitions,
  monitorSettingKeys,
  monitorSettingsFrom,
  normalizeBlockedWords,
  reportMonitorEventSchema,
  type MonitorSettingKey,
} from './monitor.js';

describe('the monitor settings', () => {
  it('have unique keys under the monitor prefix and a description in both languages', () => {
    expect(new Set(monitorSettingKeys).size).toBe(monitorSettingKeys.length);
    for (const definition of monitorSettingDefinitions) {
      expect(definition.key.startsWith('monitor.'), definition.key).toBe(true);
      expect(definition.fa.length, definition.key).toBeGreaterThan(5);
      expect(definition.en.length, definition.key).toBeGreaterThan(5);
    }
  });

  it('name no assistant, so renaming the assistant never touches them', () => {
    for (const key of monitorSettingKeys) expect(key).not.toMatch(/docoo|daku/iu);
  });

  it('start with both monitors off and every default allowed by its own rule', () => {
    expect(monitorSettingDefaults['monitor.viewer.enabled']).toBe(false);
    expect(monitorSettingDefaults['monitor.voice.enabled']).toBe(false);
    for (const key of monitorSettingKeys) {
      expect(isMonitorSettingValue(key, monitorSettingDefaults[key]), key).toBe(true);
    }
  });

  it('default to the careful room profile: no cost, tokens, model or assistant text', () => {
    const values = monitorSettingsFrom({});
    for (const key of [
      'monitor.viewer.cost',
      'monitor.viewer.tokens',
      'monitor.viewer.model_info',
      'monitor.viewer.assistant_transcript',
      'monitor.voice.cost',
      'monitor.voice.tokens',
      'monitor.voice.model_info',
      'monitor.voice.transcript',
      'monitor.viewer.business_name',
    ] as const) {
      expect(values[key], key).toBe('hidden');
    }
    expect(values['monitor.redaction']).toBe('strict');
    expect(values['monitor.delay_s']).toBe(3);
    expect(detectMonitorPreset({})).toBe('room');
  });

  it('show the steps of a project in full, as the owner decided', () => {
    const values = monitorSettingsFrom({});
    expect(values['monitor.viewer.stage_outputs']).toBe('full');
    expect(values['monitor.viewer.documents']).toBe('preview');
    expect(values['monitor.viewer.research_sources']).toBe('full');
    expect(values['monitor.viewer.agents']).toBe('roles_actions');
    expect(values['monitor.viewer.people']).toBe('role');
  });

  it('keep the delay choices inside the bounds of the setting', () => {
    for (const delay of monitorDelayChoices) {
      expect(isMonitorSettingValue('monitor.delay_s', delay)).toBe(true);
    }
    expect(Math.min(...monitorDelayChoices)).toBe(monitorLimits.delayS.min);
    expect(Math.max(...monitorDelayChoices)).toBe(monitorLimits.delayS.max);
  });
});

describe('reading saved values', () => {
  it('takes the default for a missing value and for one that is not allowed', () => {
    const values = monitorSettingsFrom({
      'monitor.viewer.cost': 'everything',
      'monitor.delay_s': -4,
      'monitor.font_scale': 5,
      'monitor.viewer.enabled': 'yes',
      'monitor.voice.cost': 'session',
      'monitor.unknown': true,
    });
    expect(values['monitor.viewer.cost']).toBe('hidden');
    expect(values['monitor.delay_s']).toBe(3);
    expect(values['monitor.font_scale']).toBe(1.5);
    expect(values['monitor.viewer.enabled']).toBe(false);
    expect(values['monitor.voice.cost']).toBe('session');
    expect(Object.keys(values).sort()).toEqual([...monitorSettingKeys].sort());
  });

  it('never gives back the shared default list, so one caller cannot change it for another', () => {
    const first = monitorSettingsFrom({});
    (first['monitor.blocked_words'] as string[]).push('Acme');
    expect(monitorSettingsFrom({})['monitor.blocked_words']).toEqual([]);
    expect(monitorSettingDefaults['monitor.blocked_words']).toEqual([]);
  });
});

describe('the profiles', () => {
  it('only decide settings that exist, and each value is allowed for its setting', () => {
    for (const preset of monitorPresets) {
      const values = monitorPresetValues(preset);
      expect(Object.keys(values).sort()).toEqual([...monitorPresetKeys].sort());
      for (const key of monitorPresetKeys) {
        expect(isMonitorSettingValue(key, values[key]), `${preset} ${key}`).toBe(true);
      }
    }
  });

  it('make the room profile the defaults, and the others differ from it', () => {
    for (const key of monitorPresetKeys) {
      expect(monitorPresetValues('room')[key], key).toEqual(monitorSettingDefaults[key]);
    }
    expect(monitorPresetValues('team')).not.toEqual(monitorPresetValues('room'));
    expect(monitorPresetValues('personal')).not.toEqual(monitorPresetValues('team'));
  });

  it('are recognised from the settings, and any edit makes them custom', () => {
    for (const preset of monitorPresets) {
      expect(detectMonitorPreset(monitorPresetValues(preset))).toBe(preset);
    }
    const edited: Partial<Record<MonitorSettingKey, unknown>> = {
      ...monitorPresetValues('team'),
      'monitor.viewer.cost': 'detailed',
    };
    expect(detectMonitorPreset(edited)).toBe('custom');
  });

  it('give a guest in the room less than the team and the team less than the owner alone', () => {
    const room = monitorPresetValues('room');
    const personal = monitorPresetValues('personal');
    expect(room['monitor.viewer.cost']).toBe('hidden');
    expect(personal['monitor.viewer.cost']).toBe('detailed');
    expect(room['monitor.voice.transcript']).toBe('hidden');
    expect(personal['monitor.voice.transcript']).toBe('full');
    expect(room['monitor.delay_s']).toBeGreaterThan(personal['monitor.delay_s'] as number);
  });
});

describe('blocked words', () => {
  it('are trimmed, deduplicated ignoring case, and empty entries go', () => {
    expect(normalizeBlockedWords(['  Acme ', 'acme', '', '   ', 'Beta Corp', 'ACME'])).toEqual([
      'Acme',
      'Beta Corp',
    ]);
  });

  it('drop what is not text and what is too long, and cap the list', () => {
    const tooLong = 'x'.repeat(monitorLimits.blockedWords.maxLength + 1);
    expect(normalizeBlockedWords([7, null, tooLong, 'ok'])).toEqual(['ok']);
    expect(normalizeBlockedWords('not a list')).toEqual([]);
    const many = Array.from({ length: 150 }, (_, index) => `word${index}`);
    expect(normalizeBlockedWords(many)).toHaveLength(monitorLimits.blockedWords.maxItems);
  });

  it('are checked by the setting rule: a list of non-empty short texts', () => {
    expect(isMonitorSettingValue('monitor.blocked_words', ['Acme'])).toBe(true);
    expect(isMonitorSettingValue('monitor.blocked_words', [''])).toBe(false);
    expect(isMonitorSettingValue('monitor.blocked_words', [1])).toBe(false);
  });
});

describe('the owner controls', () => {
  it('accept a known control for one monitor or for all, and nothing else', () => {
    expect(reportMonitorEventSchema.safeParse({ event: 'blackout', kind: 'all' }).success).toBe(
      true,
    );
    expect(reportMonitorEventSchema.safeParse({ event: 'opened', kind: 'viewer' }).success).toBe(
      true,
    );
    expect(reportMonitorEventSchema.safeParse({ event: 'delete', kind: 'viewer' }).success).toBe(
      false,
    );
    expect(reportMonitorEventSchema.safeParse({ event: 'opened', kind: 'tv' }).success).toBe(false);
    expect(reportMonitorEventSchema.safeParse({}).success).toBe(false);
  });
});

describe('share link input', () => {
  const ok = {
    kind: 'viewer',
    password: 'longenough',
    expiresAt: null,
    maxSessions: 5,
  } as const;

  it('accepts a password, no expiry and a screen limit', () => {
    expect(createMonitorShareLinkSchema.parse(ok).label).toBe('');
  });

  it('refuses a short password, a past expiry and a limit outside the bounds', () => {
    expect(createMonitorShareLinkSchema.safeParse({ ...ok, password: 'short' }).success).toBe(
      false,
    );
    expect(
      createMonitorShareLinkSchema.safeParse({ ...ok, expiresAt: '2020-01-01T00:00:00Z' }).success,
    ).toBe(false);
    expect(createMonitorShareLinkSchema.safeParse({ ...ok, maxSessions: 0 }).success).toBe(false);
    expect(createMonitorShareLinkSchema.safeParse({ ...ok, maxSessions: 101 }).success).toBe(false);
    expect(createMonitorShareLinkSchema.safeParse({ ...ok, kind: 'other' }).success).toBe(false);
  });

  it('accepts a future expiry', () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect(createMonitorShareLinkSchema.safeParse({ ...ok, expiresAt: future }).success).toBe(true);
  });
});
