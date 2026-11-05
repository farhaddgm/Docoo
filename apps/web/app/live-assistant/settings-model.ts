import {
  accessRulesFromSettings,
  liveAssistantLimits,
  liveAssistantSettingDefaults,
  liveAssistantSettingKeys,
  type AssistantAccessRule,
  type LiveAssistantSettingKey,
} from '@docoo/contracts';

/**
 * What the assistant settings page edits (ADR-0055 §4-8): the draft of every setting, which ones
 * changed, and what stops a save. Kept free of React so it can be tested on its own.
 */

export type Draft = Record<LiveAssistantSettingKey, unknown>;

/** Every setting, the effective value of the workspace or else its default. */
export function draftFrom(values: Record<string, unknown> | undefined): Draft {
  return Object.fromEntries(
    liveAssistantSettingKeys.map((key) => [
      key,
      values?.[key] === undefined ? liveAssistantSettingDefaults[key] : values[key],
    ]),
  ) as Draft;
}

export function changedKeys(draft: Draft, saved: Draft): LiveAssistantSettingKey[] {
  return liveAssistantSettingKeys.filter(
    (key) => JSON.stringify(draft[key]) !== JSON.stringify(saved[key]),
  );
}

export type ProblemCode =
  | 'name_required'
  | 'out_of_range'
  | 'not_whole'
  | 'consent_needed'
  | 'model_needed'
  | 'executor_model_needed'
  | 'projects_needed';

export interface Problem {
  readonly key: LiveAssistantSettingKey;
  readonly code: ProblemCode;
}

const NUMBERS: readonly [LiveAssistantSettingKey, { min: number; max: number }, boolean][] = [
  ['live_assistant.idle_sleep_s', liveAssistantLimits.idleSleepS, false],
  ['live_assistant.session_max_minutes', liveAssistantLimits.sessionMaxMinutes, false],
  ['live_assistant.session_cost_cap_usd', liveAssistantLimits.sessionCostCapUsd, false],
  ['live_assistant.daily_cost_cap_usd', liveAssistantLimits.dailyCostCapUsd, false],
  ['live_assistant.task_cost_cap_usd', liveAssistantLimits.taskCostCapUsd, false],
  ['live_assistant.max_actions_per_task', liveAssistantLimits.maxActionsPerTask, true],
  ['live_assistant.confirm_timeout_s', liveAssistantLimits.confirmTimeoutS, false],
  ['live_assistant.transcript_retention_days', liveAssistantLimits.transcriptRetentionDays, true],
];

const text = (draft: Draft, key: LiveAssistantSettingKey): string => {
  const value = draft[key];
  return typeof value === 'string' ? value : '';
};

/** The reasons a draft cannot be saved yet. An empty list means it can. */
export function validateDraft(draft: Draft): Problem[] {
  const problems: Problem[] = [];
  const name = text(draft, 'live_assistant.display_name').trim();
  if (name.length === 0 || name.length > 40) {
    problems.push({ key: 'live_assistant.display_name', code: 'name_required' });
  }
  for (const [key, range, whole] of NUMBERS) {
    const value = draft[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      problems.push({ key, code: 'out_of_range' });
    } else if (value < range.min || value > range.max) {
      problems.push({ key, code: 'out_of_range' });
    } else if (whole && !Number.isInteger(value)) {
      problems.push({ key, code: 'not_whole' });
    }
  }
  if (draft['live_assistant.enabled'] === true) {
    if (draft['live_assistant.disclosure_accepted'] !== true) {
      problems.push({ key: 'live_assistant.disclosure_accepted', code: 'consent_needed' });
    }
  }
  // The voice connection and its model go together; both empty is fine (typing needs neither). The
  // assistant can be switched on without them: only a spoken conversation waits for them.
  const voiceConnection = text(draft, 'live_assistant.connection_id') !== '';
  const voiceModel = text(draft, 'live_assistant.model').trim() !== '';
  if (voiceConnection !== voiceModel) {
    problems.push({ key: 'live_assistant.model', code: 'model_needed' });
  }
  // The same for the model that answers typed requests: half a pair would be saved and then leave
  // typing unavailable without a word.
  const executorConnection = text(draft, 'live_assistant.executor_connection_id') !== '';
  const executorModel = text(draft, 'live_assistant.executor_model').trim() !== '';
  if (executorConnection !== executorModel) {
    problems.push({ key: 'live_assistant.executor_model', code: 'executor_model_needed' });
  }
  if (text(draft, 'live_assistant.access_scope') === 'selected_projects') {
    const ids = draft['live_assistant.access_project_ids'];
    const none = !Array.isArray(ids) || ids.length === 0;
    if (none && draft['live_assistant.access_include_current'] !== true) {
      problems.push({ key: 'live_assistant.access_project_ids', code: 'projects_needed' });
    }
  }
  return problems;
}

/**
 * The rule the draft would enforce, built by the same function the server-side policy uses, so the
 * sentence on the page can never say something the enforcement does not do. Null: no rule at all,
 * so the assistant can do nothing.
 */
export function effectiveRule(draft: Draft): AssistantAccessRule | null {
  return accessRulesFromSettings(draft)[0] ?? null;
}

/** The batch endpoint changes at most this many settings at once, all or none. */
export const BATCH = 20;

/** `enabled` goes last, so switching on never lands before what it needs (consent, model). */
export function saveOrder(keys: readonly LiveAssistantSettingKey[]): LiveAssistantSettingKey[] {
  return [...keys].sort(
    (a, b) => Number(a === 'live_assistant.enabled') - Number(b === 'live_assistant.enabled'),
  );
}
