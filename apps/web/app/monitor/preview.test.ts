import { monitorSettingDefinitions } from '@docoo/contracts';
import { describe, expect, it } from 'vitest';

import { monitorMessages } from './messages';
import { isHiddenValue, previewKeys } from './preview';

describe('the preview before a monitor opens', () => {
  it('lists only choice settings of the monitor, each with a label in both languages', () => {
    const keys = new Set(monitorSettingDefinitions.map((definition) => definition.key));
    for (const kind of ['viewer', 'voice'] as const) {
      for (const key of previewKeys[kind]) {
        expect(keys.has(key as never), key).toBe(true);
        expect(key.startsWith(`monitor.${kind}.`), key).toBe(true);
        for (const locale of ['fa', 'en'] as const) {
          expect(
            monitorMessages(locale).launcher.preview.labels[key],
            `${locale} ${key}`,
          ).toBeTruthy();
        }
      }
    }
  });

  it('knows what hidden is', () => {
    expect(isHiddenValue('hidden')).toBe(true);
    expect(isHiddenValue('full')).toBe(false);
  });
});
