import { describe, expect, it } from 'vitest';

import {
  estimateResearch,
  presetOf,
  RESEARCH_PRESET_IDS,
  RESEARCH_PRESET_KEYS,
  RESEARCH_PRESETS,
  researchUnits,
  researchValuesOf,
} from './research-presets.js';

describe('research presets', () => {
  it('set every key, and the standard preset is what a workspace runs before anyone changes it', () => {
    for (const id of RESEARCH_PRESET_IDS) {
      expect(Object.keys(RESEARCH_PRESETS[id]).sort()).toEqual([...RESEARCH_PRESET_KEYS].sort());
    }
    expect(presetOf({})).toBe('standard');
  });

  it('recognises each preset from its own values, and anything else as custom', () => {
    for (const id of RESEARCH_PRESET_IDS) expect(presetOf(RESEARCH_PRESETS[id])).toBe(id);
    expect(presetOf({ ...RESEARCH_PRESETS.deep, 'research.web_max_searches': 14 })).toBe('custom');
    expect(presetOf({ ...RESEARCH_PRESETS.standard, 'research.dual_enabled': true })).toBe(
      'custom',
    );
  });

  it('only the sensitive preset turns the second model on', () => {
    for (const id of RESEARCH_PRESET_IDS) {
      expect(RESEARCH_PRESETS[id]['research.dual_enabled']).toBe(id === 'sensitive');
    }
  });

  it('keeps every minimum under its maximum', () => {
    for (const id of RESEARCH_PRESET_IDS) {
      const preset = RESEARCH_PRESETS[id];
      expect(preset['research.web_min_searches']).toBeLessThanOrEqual(
        preset['research.web_max_searches'] as number,
      );
      expect(preset['research.web_min_rounds']).toBeLessThanOrEqual(
        preset['research.web_max_rounds'] as number,
      );
    }
  });
});

describe('researchValuesOf', () => {
  it('takes the standard value for a missing or unusable one and clamps the rest', () => {
    const values = researchValuesOf({
      'research.web_enabled': 'yes',
      'research.web_max_searches': 500,
      'research.web_min_searches': 40,
      'research.web_max_rounds': Number.NaN,
      'research.web_source_limit': -3,
      'research.web_target_sources': 12.6,
    });
    expect(values['research.web_enabled']).toBe(true);
    expect(values['research.web_max_searches']).toBe(50);
    expect(values['research.web_min_searches']).toBe(40);
    expect(values['research.web_max_rounds']).toBe(1);
    expect(values['research.web_source_limit']).toBe(1);
    expect(values['research.web_target_sources']).toBe(13);
  });

  it('brings a minimum above its maximum down to it', () => {
    const values = researchValuesOf({
      'research.web_min_searches': 9,
      'research.web_max_searches': 4,
      'research.web_min_rounds': 5,
      'research.web_max_rounds': 2,
    });
    expect(values['research.web_min_searches']).toBe(4);
    expect(values['research.web_min_rounds']).toBe(2);
  });
});

describe('researchUnits and estimateResearch', () => {
  it('grow from quick to standard to deep to sensitive', () => {
    const typical = RESEARCH_PRESET_IDS.map((id) => researchUnits(RESEARCH_PRESETS[id], 'typical'));
    expect(typical).toEqual([...typical].sort((a, b) => a - b));
    expect(new Set(typical).size).toBe(4);
  });

  it('are ordered low <= typical <= high', () => {
    for (const id of RESEARCH_PRESET_IDS) {
      const preset = RESEARCH_PRESETS[id];
      expect(researchUnits(preset, 'low')).toBeLessThanOrEqual(researchUnits(preset, 'typical'));
      expect(researchUnits(preset, 'typical')).toBeLessThanOrEqual(researchUnits(preset, 'high'));
    }
  });

  it('count two models as about double the searches, and no web as the smallest run', () => {
    const single = researchUnits(RESEARCH_PRESETS.deep, 'high');
    const dual = researchUnits({ ...RESEARCH_PRESETS.deep, 'research.dual_enabled': true }, 'high');
    expect(dual).toBeGreaterThan(single * 1.5);
    expect(
      researchUnits({ ...RESEARCH_PRESETS.quick, 'research.web_enabled': false }, 'high'),
    ).toBeLessThan(researchUnits(RESEARCH_PRESETS.quick, 'low'));
  });

  it('gives a factor of 1 for standard and quotes dollars and seconds only from enough history', () => {
    expect(estimateResearch(RESEARCH_PRESETS.standard, null).factor).toBe(1);
    expect(estimateResearch(RESEARCH_PRESETS.standard, null).usd).toBeNull();
    expect(
      estimateResearch(RESEARCH_PRESETS.deep, { usd: 0.1, seconds: 10, sample: 2 }).usd,
    ).toBeNull();
    const estimate = estimateResearch(RESEARCH_PRESETS.deep, { usd: 0.1, seconds: 10, sample: 5 });
    expect(estimate.factor).toBeGreaterThan(1);
    expect(estimate.usd!.low).toBeLessThan(estimate.usd!.high);
    expect(estimate.seconds!.low).toBeLessThan(estimate.seconds!.high);
    expect(estimate.usd!.low).toBeCloseTo(researchUnits(RESEARCH_PRESETS.deep, 'low') * 0.1, 6);
  });
});
