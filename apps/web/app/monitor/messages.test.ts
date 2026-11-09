import { monitorSettingDefinitions } from '@docoo/contracts';
import { describe, expect, it } from 'vitest';

import { fillText, monitorMessages, optionLabel } from './messages';

const shape = (value: unknown): unknown =>
  value !== null && typeof value === 'object'
    ? Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, shape(item)]),
      )
    : typeof value;

describe('the monitor words', () => {
  it('have the same shape in both languages', () => {
    // The override keys are data, not words; their sets must match too.
    const strip = (messages: ReturnType<typeof monitorMessages>) => ({
      ...messages,
      optionOverrides: Object.keys(messages.optionOverrides).sort(),
    });
    expect(shape(strip(monitorMessages('en')))).toEqual(shape(strip(monitorMessages('fa'))));
    expect(Object.keys(monitorMessages('en').optionOverrides).sort()).toEqual(
      Object.keys(monitorMessages('fa').optionOverrides).sort(),
    );
  });

  it('name every choice of every setting, in both languages', () => {
    for (const locale of ['fa', 'en'] as const) {
      const messages = monitorMessages(locale);
      for (const definition of monitorSettingDefinitions) {
        if (definition.kind !== 'choice' || definition.key === 'monitor.preset') continue;
        for (const option of definition.options) {
          const known =
            `${definition.key}|${option}` in messages.optionOverrides ||
            option in messages.optionLabels;
          expect(known, `${locale} ${definition.key} ${option}`).toBe(true);
        }
      }
    }
  });

  it('name the three profiles and the custom one', () => {
    for (const locale of ['fa', 'en'] as const) {
      expect(Object.keys(monitorMessages(locale).settings.presets).sort()).toEqual([
        'custom',
        'personal',
        'room',
        'team',
      ]);
    }
  });

  it('prefer a wording made for one setting over the shared one', () => {
    const messages = monitorMessages('en');
    expect(optionLabel(messages, 'monitor.viewer.documents', 'names')).toBe('Names only');
    expect(optionLabel(messages, 'monitor.viewer.human_gates', 'names')).toBe('With the approver');
    expect(optionLabel(messages, 'monitor.unknown', 'mystery')).toBe('mystery');
  });

  it('fill placeholders and leave unknown ones', () => {
    expect(fillText('{a} and {b} and {c}', { a: '1', b: '2' })).toBe('1 and 2 and {c}');
  });
});
