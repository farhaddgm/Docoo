import { describe, expect, it } from 'vitest';

import {
  ADVANCED_STEP,
  CONTEXT_STEP,
  PROBLEM_STEP,
  REVIEW_STEP,
  changedInSection,
  migrateDraftStep,
  reachableSteps,
  suggestProjectCode,
} from './wizard-model';
import { PROJECT_CODE_PATTERN } from '../project-fields';

describe('wizard model', () => {
  it('maps a step of the old eight-step draft to the new four steps', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(migrateDraftStep)).toEqual([
      PROBLEM_STEP,
      CONTEXT_STEP,
      ADVANCED_STEP,
      ADVANCED_STEP,
      ADVANCED_STEP,
      ADVANCED_STEP,
      ADVANCED_STEP,
      REVIEW_STEP,
    ]);
    expect(migrateDraftStep(-3)).toBe(PROBLEM_STEP);
    expect(migrateDraftStep(99)).toBe(REVIEW_STEP);
  });

  it('suggests a code from the Latin part of the title', () => {
    expect(suggestProjectCode('Launch the new store', 0)).toBe('LAUNCH-THE-NEW-STORE');
    expect(suggestProjectCode('  Q4 / plan: v2!  ', 0)).toBe('Q4-PLAN-V2');
    expect(suggestProjectCode('x'.repeat(80), 0)).toHaveLength(24);
  });

  it('falls back to a stamped code for a title without Latin letters', () => {
    const code = suggestProjectCode('راه‌اندازی فروشگاه', 123456789);
    expect(code).toMatch(/^PRJ-[0-9A-Z]{5}$/u);
  });

  it('always suggests a code the API accepts', () => {
    for (const title of ['', 'سلام', '---', 'a', '9 lives', 'Ünïcode café']) {
      expect(PROJECT_CODE_PATTERN.test(suggestProjectCode(title, 99999))).toBe(true);
    }
  });

  it('lets the person move forward only up to the first incomplete required step', () => {
    expect(reachableSteps({ problem: false, context: false })).toBe(PROBLEM_STEP);
    expect(reachableSteps({ problem: true, context: false })).toBe(CONTEXT_STEP);
    expect(reachableSteps({ problem: true, context: true })).toBe(REVIEW_STEP);
  });

  it('counts the changes of an advanced section', () => {
    const changed = new Set(['workflow.max_attempts_per_stage', 'solution.count']);
    const none = { modelChanged: false, criteriaChanged: false };
    expect(changedInSection('workflow', changed, none)).toBe(1);
    expect(changedInSection('research', changed, none)).toBe(0);
    expect(changedInSection('model', changed, { ...none, modelChanged: true })).toBe(1);
    expect(changedInSection('solutions', changed, { ...none, criteriaChanged: true })).toBe(2);
  });
});
