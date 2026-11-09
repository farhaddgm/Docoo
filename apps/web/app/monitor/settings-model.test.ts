import { monitorPresetKeys, monitorPresetValues, monitorSettingKeys } from '@docoo/contracts';
import { describe, expect, it } from 'vitest';

import {
  applyPreset,
  BATCH,
  changedKeys,
  draftFrom,
  presetChanges,
  saveItems,
  textToWords,
  validateDraft,
  withDetectedPreset,
  wordsToText,
} from './settings-model';

describe('the monitor settings draft', () => {
  it('starts from the careful defaults and takes saved values over them', () => {
    const empty = draftFrom(undefined);
    expect(Object.keys(empty).sort()).toEqual([...monitorSettingKeys].sort());
    expect(empty['monitor.viewer.cost']).toBe('hidden');
    expect(draftFrom({ 'monitor.viewer.cost': 'total' })['monitor.viewer.cost']).toBe('total');
    expect(draftFrom({ 'monitor.viewer.cost': 'nonsense' })['monitor.viewer.cost']).toBe('hidden');
  });

  it('is valid as it comes, and refuses a value outside the allowed ones', () => {
    const draft = draftFrom(undefined);
    expect(validateDraft(draft)).toEqual([]);
    const bad = { ...draft, 'monitor.delay_s': 99, 'monitor.viewer.cost': 'all' };
    expect(validateDraft(bad).map((problem) => problem.key)).toEqual([
      'monitor.delay_s',
      'monitor.viewer.cost',
    ]);
  });
});

describe('picking a profile', () => {
  it('sets what the profile decides and leaves the rest alone', () => {
    const base = { ...draftFrom(undefined), 'monitor.refresh_s': 7, 'monitor.theme': 'light' };
    const team = applyPreset(base, 'team');
    expect(team['monitor.viewer.cost']).toBe('total');
    expect(team['monitor.redaction']).toBe('standard');
    expect(team['monitor.refresh_s']).toBe(7);
    expect(team['monitor.theme']).toBe('light');
    expect(team['monitor.preset']).toBe('team');
  });

  it('becomes custom as soon as one decided setting is edited by hand', () => {
    const personal = applyPreset(draftFrom(undefined), 'personal');
    expect(personal['monitor.preset']).toBe('personal');
    const edited = withDetectedPreset({ ...personal, 'monitor.viewer.cost': 'hidden' });
    expect(edited['monitor.preset']).toBe('custom');
  });

  it('tells which settings a profile would change', () => {
    const room = draftFrom(undefined);
    expect(presetChanges(room, 'room')).toEqual([]);
    const changes = presetChanges(room, 'personal');
    expect(changes).toContain('monitor.viewer.cost');
    expect(changes.every((key) => monitorPresetKeys.includes(key))).toBe(true);
    expect(changes).toHaveLength(
      monitorPresetKeys.filter((key) => monitorPresetValues('personal')[key] !== room[key]).length,
    );
  });
});

describe('saving', () => {
  it('has nothing to save until something changes', () => {
    const saved = draftFrom(undefined);
    expect(changedKeys(saved, saved)).toEqual([]);
    expect(saveItems(saved, saved)).toEqual([]);
  });

  it('saves the changes together with the profile name that matches them, switches last', () => {
    const saved = draftFrom(undefined);
    const draft = {
      ...applyPreset(saved, 'team'),
      'monitor.viewer.enabled': true,
      'monitor.voice.enabled': true,
    };
    const items = saveItems(draft, saved);
    const keys = items.map((item) => item.key);
    expect(keys).toContain('monitor.preset');
    expect(keys.slice(-2).sort()).toEqual(['monitor.viewer.enabled', 'monitor.voice.enabled']);
    expect(items.find((item) => item.key === 'monitor.preset')?.value).toBe('team');
    expect(items.length).toBeLessThanOrEqual(BATCH * 2);
  });

  it('saves a clean list of blocked words', () => {
    const saved = draftFrom(undefined);
    const draft = { ...saved, 'monitor.blocked_words': ['  Acme ', 'acme', '', 'Beta'] };
    expect(saveItems(draft, saved)).toEqual([
      { key: 'monitor.blocked_words', value: ['Acme', 'Beta'] },
    ]);
  });
});

describe('blocked words as text', () => {
  it('turn one word per line (or comma separated) into a clean list and back', () => {
    expect(textToWords('Acme\n  Beta Corp \n\nacme, Gamma،Delta')).toEqual([
      'Acme',
      'Beta Corp',
      'Gamma',
      'Delta',
    ]);
    expect(wordsToText(['Acme', 'Beta'])).toBe('Acme\nBeta');
    expect(wordsToText('nope')).toBe('');
    expect(textToWords('')).toEqual([]);
  });
});
