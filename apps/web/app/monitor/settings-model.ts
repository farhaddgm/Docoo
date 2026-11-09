import {
  detectMonitorPreset,
  isMonitorSettingValue,
  monitorPresetKeys,
  monitorPresetValues,
  monitorSettingKeys,
  monitorSettingsFrom,
  normalizeBlockedWords,
  type MonitorPreset,
  type MonitorSettingKey,
  type MonitorSettingValue,
} from '@docoo/contracts';

/**
 * What the monitor settings page edits (ADR-0056 §8): the draft of every setting, the profile it
 * matches, which settings changed, and what stops a save. Kept free of React so it can be tested.
 */

export type Draft = Record<MonitorSettingKey, MonitorSettingValue>;

/** Every setting, the saved value of the workspace or else the careful default. */
export const draftFrom = (values: Record<string, unknown> | undefined): Draft =>
  monitorSettingsFrom(values ?? {});

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** `monitor.preset` is never edited by hand: it always says which profile the draft matches. */
export const withDetectedPreset = (draft: Draft): Draft => ({
  ...draft,
  'monitor.preset': detectMonitorPreset(draft),
});

/** Picks a profile: it sets the settings it decides and leaves every other setting alone. */
export const applyPreset = (draft: Draft, preset: MonitorPreset): Draft =>
  withDetectedPreset({ ...draft, ...monitorPresetValues(preset) });

/** The settings the profile decides, which differ from what the draft has now. */
export const presetChanges = (draft: Draft, preset: MonitorPreset): MonitorSettingKey[] => {
  const wanted = monitorPresetValues(preset);
  return monitorPresetKeys.filter((key) => !same(draft[key], wanted[key]));
};

export const changedKeys = (draft: Draft, saved: Draft): MonitorSettingKey[] =>
  monitorSettingKeys.filter((key) => !same(draft[key], saved[key]));

export type ProblemCode = 'invalid_value';

export interface Problem {
  readonly key: MonitorSettingKey;
  readonly code: ProblemCode;
}

/** The reasons a draft cannot be saved yet. An empty list means it can. */
export function validateDraft(draft: Draft): Problem[] {
  const problems: Problem[] = [];
  for (const key of monitorSettingKeys) {
    if (key === 'monitor.preset') continue;
    if (!isMonitorSettingValue(key, draft[key])) problems.push({ key, code: 'invalid_value' });
  }
  return problems;
}

/** The blocked words as the page shows them: one per line. */
export const wordsToText = (words: unknown): string =>
  Array.isArray(words) ? words.filter((word) => typeof word === 'string').join('\n') : '';

/** The words typed one per line (or separated by commas) become the clean list that is saved. */
export const textToWords = (text: string): string[] => normalizeBlockedWords(text.split(/[\n,،]/u));

/** The batch endpoint changes at most this many settings at once, all or none. */
export const BATCH = 20;

/**
 * What to save: the changed settings, and the profile name kept in step with them. The switches go
 * last, so turning a monitor on never lands before the rest of what it needs.
 */
export function saveItems(
  draft: Draft,
  saved: Draft,
): { key: MonitorSettingKey; value: MonitorSettingValue }[] {
  const next = withDetectedPreset({
    ...draft,
    'monitor.blocked_words': normalizeBlockedWords(draft['monitor.blocked_words']),
  });
  const rank = (key: MonitorSettingKey) =>
    key === 'monitor.viewer.enabled' || key === 'monitor.voice.enabled' ? 1 : 0;
  return changedKeys(next, saved)
    .sort((a, b) => rank(a) - rank(b))
    .map((key) => ({ key, value: next[key] }));
}
