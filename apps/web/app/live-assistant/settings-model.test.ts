import {
  accessScopeModes,
  assistantAccessLevels,
  confirmStrictnessLevels,
  liveAssistantLanguages,
  liveAssistantListeningModes,
  liveAssistantModes,
  liveAssistantSettingDefaults,
  liveAssistantSettingKeys,
  t3Categories,
} from '@docoo/contracts';
import { describe, expect, it } from 'vitest';

import {
  BATCH,
  changedKeys,
  draftFrom,
  effectiveRule,
  saveOrder,
  validateDraft,
  type Draft,
  type ProblemCode,
} from './settings-model';
import { fillText, liveSettingsMessages } from './settings-messages';

const P1 = '11111111-1111-4111-8111-111111111111';
const withValues = (over: Record<string, unknown>): Draft => draftFrom(over);
const codes = (draft: Draft): string[] =>
  validateDraft(draft).map(
    (problem) => `${problem.key.replace('live_assistant.', '')}:${problem.code}`,
  );

describe('the draft', () => {
  it('is the defaults for a workspace that has set nothing', () => {
    const draft = draftFrom(undefined);
    expect(Object.keys(draft).sort()).toEqual([...liveAssistantSettingKeys].sort());
    for (const key of liveAssistantSettingKeys) {
      expect(draft[key]).toEqual(liveAssistantSettingDefaults[key]);
    }
  });

  it('takes the workspace value over the default, and ignores keys it does not know', () => {
    const draft = draftFrom({ 'live_assistant.access_level': 'act', 'other.key': 1 });
    expect(draft['live_assistant.access_level']).toBe('act');
    expect(draft['live_assistant.access_scope']).toBe('all_projects');
    expect(Object.keys(draft)).not.toContain('other.key');
  });

  it('knows which settings changed, comparing lists by content', () => {
    const saved = draftFrom({});
    expect(changedKeys(saved, saved)).toEqual([]);
    const draft = {
      ...saved,
      'live_assistant.access_level': 'act',
      'live_assistant.access_project_ids': [P1],
    };
    expect(changedKeys(draft, saved)).toEqual([
      'live_assistant.access_level',
      'live_assistant.access_project_ids',
    ]);
    expect(changedKeys({ ...saved, 'live_assistant.t3_categories': [] }, saved)).toEqual([]);
  });

  it('saves "on" last, in chunks no larger than the batch endpoint takes', () => {
    const order = saveOrder([
      'live_assistant.enabled',
      'live_assistant.disclosure_accepted',
      'live_assistant.model',
    ]);
    expect(order.at(-1)).toBe('live_assistant.enabled');
    expect(order).toHaveLength(3);
    expect(BATCH).toBe(20);
  });
});

describe('what stops a save', () => {
  it('nothing, for the untouched defaults', () => {
    expect(codes(draftFrom({}))).toEqual([]);
  });

  it('refuses to switch on without the privacy notice accepted, and asks for no voice model', () => {
    expect(codes(withValues({ 'live_assistant.enabled': true }))).toEqual([
      'disclosure_accepted:consent_needed',
    ]);
    // Typing needs no voice connection at all: accepted notice alone is enough to switch on.
    expect(
      codes(
        withValues({
          'live_assistant.enabled': true,
          'live_assistant.disclosure_accepted': true,
        }),
      ),
    ).toEqual([]);
    expect(
      codes(
        withValues({
          'live_assistant.enabled': true,
          'live_assistant.disclosure_accepted': true,
          'live_assistant.connection_id': P1,
          'live_assistant.model': 'some-realtime-model',
        }),
      ),
    ).toEqual([]);
  });

  it('wants the voice connection and its model together, never half', () => {
    expect(codes(withValues({ 'live_assistant.connection_id': P1 }))).toEqual([
      'model:model_needed',
    ]);
    expect(codes(withValues({ 'live_assistant.model': 'some-realtime-model' }))).toEqual([
      'model:model_needed',
    ]);
    expect(
      codes(withValues({ 'live_assistant.connection_id': P1, 'live_assistant.model': '   ' })),
    ).toEqual(['model:model_needed']);
  });

  it('wants the text connection and its model together too, or typing stays off in silence', () => {
    expect(codes(withValues({ 'live_assistant.executor_connection_id': P1 }))).toEqual([
      'executor_model:executor_model_needed',
    ]);
    expect(codes(withValues({ 'live_assistant.executor_model': 'text-model' }))).toEqual([
      'executor_model:executor_model_needed',
    ]);
    expect(
      codes(
        withValues({
          'live_assistant.executor_connection_id': P1,
          'live_assistant.executor_model': 'text-model',
        }),
      ),
    ).toEqual([]);
  });

  it('refuses a missing name and one that is too long', () => {
    expect(codes(withValues({ 'live_assistant.display_name': '  ' }))).toEqual([
      'display_name:name_required',
    ]);
    expect(codes(withValues({ 'live_assistant.display_name': 'x'.repeat(41) }))).toEqual([
      'display_name:name_required',
    ]);
    expect(codes(withValues({ 'live_assistant.display_name': 'داکو' }))).toEqual([]);
  });

  it('refuses numbers outside the allowed range, not a number, or not whole where it must be', () => {
    expect(codes(withValues({ 'live_assistant.session_max_minutes': 60 }))).toEqual([
      'session_max_minutes:out_of_range',
    ]);
    expect(codes(withValues({ 'live_assistant.session_cost_cap_usd': 0.1 }))).toEqual([
      'session_cost_cap_usd:out_of_range',
    ]);
    expect(codes(withValues({ 'live_assistant.daily_cost_cap_usd': Number.NaN }))).toEqual([
      'daily_cost_cap_usd:out_of_range',
    ]);
    expect(codes(withValues({ 'live_assistant.max_actions_per_task': 2.5 }))).toEqual([
      'max_actions_per_task:not_whole',
    ]);
    expect(codes(withValues({ 'live_assistant.transcript_retention_days': 1.5 }))).toEqual([
      'transcript_retention_days:not_whole',
    ]);
    expect(codes(withValues({ 'live_assistant.session_cost_cap_usd': 7.5 }))).toEqual([]);
  });

  it('refuses chosen projects with nothing chosen, unless the open project counts', () => {
    const chosen = { 'live_assistant.access_scope': 'selected_projects' };
    expect(codes(withValues(chosen))).toEqual(['access_project_ids:projects_needed']);
    expect(codes(withValues({ ...chosen, 'live_assistant.access_include_current': true }))).toEqual(
      [],
    );
    expect(codes(withValues({ ...chosen, 'live_assistant.access_project_ids': [P1] }))).toEqual([]);
  });
});

describe('the rule the page shows', () => {
  it('is the same rule the enforcement builds from the settings', () => {
    expect(effectiveRule(draftFrom({}))).toEqual({
      scope: { mode: 'all_projects' },
      level: 'read',
    });
    expect(
      effectiveRule(
        withValues({
          'live_assistant.access_scope': 'selected_projects',
          'live_assistant.access_level': 'act',
          'live_assistant.access_project_ids': [P1],
          'live_assistant.access_include_current': true,
        }),
      ),
    ).toEqual({
      scope: { mode: 'selected_projects', projectIds: [P1], includeCurrent: true },
      level: 'act',
    });
  });

  it('is nothing when the settings make no sense, so the page says the assistant can do nothing', () => {
    expect(effectiveRule(withValues({ 'live_assistant.access_scope': 'everything' }))).toBeNull();
  });
});

describe('the words of the page', () => {
  const keys = (value: unknown, prefix = ''): string[] =>
    typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([key, inner]) => keys(inner, `${prefix}${key}.`))
      : [prefix];

  it('both languages say the same things', () => {
    expect(keys(liveSettingsMessages('fa')).sort()).toEqual(
      keys(liveSettingsMessages('en')).sort(),
    );
  });

  it('every problem, choice and category has a text in both languages', () => {
    const problemCodes: ProblemCode[] = [
      'name_required',
      'out_of_range',
      'not_whole',
      'consent_needed',
      'model_needed',
      'executor_model_needed',
      'projects_needed',
    ];
    for (const locale of ['fa', 'en'] as const) {
      const text = liveSettingsMessages(locale);
      for (const code of problemCodes) expect(text.problems[code].length).toBeGreaterThan(0);
      for (const mode of accessScopeModes) {
        expect(text.access.scopes[mode].label.length).toBeGreaterThan(0);
        expect(text.access.scopes[mode].hint.length).toBeGreaterThan(0);
      }
      for (const level of assistantAccessLevels) {
        expect(text.access.levels[level].label.length).toBeGreaterThan(0);
      }
      for (const mode of liveAssistantModes)
        expect(text.model.modes[mode].length).toBeGreaterThan(0);
      for (const language of liveAssistantLanguages) {
        expect(text.model.languages[language].length).toBeGreaterThan(0);
      }
      for (const mode of liveAssistantListeningModes) {
        expect(text.listening.modes[mode].length).toBeGreaterThan(0);
      }
      for (const level of confirmStrictnessLevels) {
        expect(text.confirm.strictnesses[level].length).toBeGreaterThan(0);
      }
      for (const category of t3Categories)
        expect(text.confirm.t3[category].length).toBeGreaterThan(0);
    }
  });

  it('the summary sentences name the assistant and the place, with no placeholder left over', () => {
    for (const locale of ['fa', 'en'] as const) {
      const text = liveSettingsMessages(locale);
      for (const sentence of [text.access.summaryRead, text.access.summaryAct]) {
        const filled = fillText(sentence, { name: 'داکو', scope: 'X' });
        expect(filled).toContain('داکو');
        expect(filled).not.toMatch(/\{/u);
      }
      expect(fillText(text.access.summaryNone, { name: 'داکو' })).not.toMatch(/\{/u);
      expect(fillText(text.limits.range, { min: '1', max: '2' })).not.toMatch(/\{/u);
    }
  });
});
