/**
 * The research presets an administrator picks instead of eight numbers (ADR-0048): what each
 * preset sets, which preset a set of values amounts to, and a rough size of the work, so the
 * pages can say "about 3 times the standard cost" and, once the workspace has run research, how
 * many dollars and minutes that is. Pure: nothing here touches the database or the network.
 */

export const RESEARCH_PRESET_IDS = ['quick', 'standard', 'deep', 'sensitive'] as const;
export type ResearchPresetId = (typeof RESEARCH_PRESET_IDS)[number];

/** The settings a preset sets, all of them every time, so a preset never leaves a mix behind. */
export const RESEARCH_PRESET_KEYS = [
  'research.web_enabled',
  'research.web_min_searches',
  'research.web_max_searches',
  'research.web_min_rounds',
  'research.web_max_rounds',
  'research.web_target_sources',
  'research.web_source_limit',
  'research.dual_enabled',
  'research.read_pages',
] as const;
export type ResearchPresetKey = (typeof RESEARCH_PRESET_KEYS)[number];
export type ResearchPresetValues = Readonly<Record<ResearchPresetKey, boolean | number>>;

export const RESEARCH_PRESETS: Readonly<Record<ResearchPresetId, ResearchPresetValues>> = {
  quick: {
    'research.web_enabled': true,
    'research.web_min_searches': 1,
    'research.web_max_searches': 3,
    'research.web_min_rounds': 1,
    'research.web_max_rounds': 1,
    'research.web_target_sources': 0,
    'research.web_source_limit': 8,
    'research.dual_enabled': false,
    'research.read_pages': false,
  },
  // The values every workspace has until someone changes them: "standard" is what runs today.
  standard: {
    'research.web_enabled': true,
    'research.web_min_searches': 1,
    'research.web_max_searches': 5,
    'research.web_min_rounds': 1,
    'research.web_max_rounds': 1,
    'research.web_target_sources': 0,
    'research.web_source_limit': 12,
    'research.dual_enabled': false,
    'research.read_pages': false,
  },
  deep: {
    'research.web_enabled': true,
    'research.web_min_searches': 3,
    'research.web_max_searches': 15,
    'research.web_min_rounds': 2,
    'research.web_max_rounds': 3,
    'research.web_target_sources': 15,
    'research.web_source_limit': 25,
    'research.dual_enabled': false,
    'research.read_pages': true,
  },
  sensitive: {
    'research.web_enabled': true,
    'research.web_min_searches': 3,
    'research.web_max_searches': 15,
    'research.web_min_rounds': 2,
    'research.web_max_rounds': 3,
    'research.web_target_sources': 15,
    'research.web_source_limit': 30,
    'research.dual_enabled': true,
    'research.read_pages': true,
  },
};

/** Bounds of the settings (the same as the setting definitions). */
const BOUNDS: Readonly<Record<ResearchPresetKey, readonly [number, number]>> = {
  'research.web_enabled': [0, 1],
  'research.web_min_searches': [0, 50],
  'research.web_max_searches': [1, 50],
  'research.web_min_rounds': [1, 10],
  'research.web_max_rounds': [1, 10],
  'research.web_target_sources': [0, 100],
  'research.web_source_limit': [1, 100],
  'research.dual_enabled': [0, 1],
  'research.read_pages': [0, 1],
};

/**
 * The research values of a set of effective settings: a missing or unusable value takes the
 * standard one, numbers are brought into their bounds, and each minimum stays under its maximum.
 */
export function researchValuesOf(raw: Readonly<Record<string, unknown>>): ResearchPresetValues {
  const standard = RESEARCH_PRESETS.standard;
  const out: Record<string, boolean | number> = {};
  for (const key of RESEARCH_PRESET_KEYS) {
    const value = raw[key];
    if (typeof standard[key] === 'boolean') {
      out[key] = typeof value === 'boolean' ? value : standard[key];
      continue;
    }
    const [low, high] = BOUNDS[key];
    const number = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : NaN;
    out[key] = Number.isNaN(number) ? standard[key] : Math.max(low, Math.min(high, number));
  }
  out['research.web_min_searches'] = Math.min(
    out['research.web_min_searches'] as number,
    out['research.web_max_searches'] as number,
  );
  out['research.web_min_rounds'] = Math.min(
    out['research.web_min_rounds'] as number,
    out['research.web_max_rounds'] as number,
  );
  return out as ResearchPresetValues;
}

/** The preset a set of settings amounts to, or `custom` when it matches none of them. */
export function presetOf(raw: Readonly<Record<string, unknown>>): ResearchPresetId | 'custom' {
  const values = researchValuesOf(raw);
  for (const id of RESEARCH_PRESET_IDS) {
    const preset = RESEARCH_PRESETS[id];
    if (RESEARCH_PRESET_KEYS.every((key) => preset[key] === values[key])) return id;
  }
  return 'custom';
}

export type EstimateMode = 'low' | 'typical' | 'high';

// Rough weights of one call relative to a web search: the structured call reads every page, and
// the judge reads the pages of both models. Only ratios matter; dollars come from the workspace's
// own history (see `estimateResearch`).
const STRUCTURED_CALL = 2;
const JUDGE_CALL = 1.5;
const PAGE_WEIGHT = 0.05;
// Reading key pages in full adds no model call but lengthens the structured call's prompt.
const READ_PAGES_WEIGHT = 1;

/** Relative size of one research run with these values; the standard preset at `typical` is 5.6. */
export function researchUnits(values: ResearchPresetValues, mode: EstimateMode): number {
  if (!values['research.web_enabled']) return STRUCTURED_CALL;
  const min = values['research.web_min_searches'] as number;
  const max = values['research.web_max_searches'] as number;
  const searches = mode === 'low' ? min : mode === 'high' ? max : Math.ceil((min + max) / 2);
  const dual = values['research.dual_enabled'] === true;
  return (
    Math.max(searches, 1) * (dual ? 2 : 1) +
    STRUCTURED_CALL +
    (dual ? JUDGE_CALL : 0) +
    (values['research.web_source_limit'] as number) * PAGE_WEIGHT +
    (values['research.read_pages'] === true ? READ_PAGES_WEIGHT : 0)
  );
}

/** What one unit costs in this workspace, measured from research runs it has completed. */
export interface ResearchUnitCost {
  readonly usd: number;
  readonly seconds: number;
  /** How many completed research runs it was measured from. */
  readonly sample: number;
}

export interface ResearchEstimate {
  /** The typical size compared with the standard preset (1 = as today). */
  readonly factor: number;
  readonly usd: { readonly low: number; readonly high: number } | null;
  readonly seconds: { readonly low: number; readonly high: number } | null;
}

/** Fewer completed runs than this is too little to quote dollars from. */
export const MIN_ESTIMATE_SAMPLE = 3;

export function estimateResearch(
  values: ResearchPresetValues,
  unit: ResearchUnitCost | null,
): ResearchEstimate {
  const standard = researchUnits(RESEARCH_PRESETS.standard, 'typical');
  const low = researchUnits(values, 'low');
  const high = researchUnits(values, 'high');
  const measured = unit !== null && unit.sample >= MIN_ESTIMATE_SAMPLE;
  return {
    factor: Math.round((researchUnits(values, 'typical') / standard) * 10) / 10,
    usd: measured ? { low: low * unit.usd, high: high * unit.usd } : null,
    seconds: measured ? { low: low * unit.seconds, high: high * unit.seconds } : null,
  };
}
