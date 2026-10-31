import { describe, expect, it } from 'vitest';

import {
  ADVANCED_STEP,
  CONTEXT_STEP,
  PROBLEM_STEP,
  REVIEW_STEP,
  candidateSeed,
  changedInSection,
  migrateDraftStep,
  reachableSteps,
  seedFields,
  shouldApplySeed,
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

describe('making a project from a candidate problem (ADR-0044)', () => {
  const detail = {
    exploration: { id: 'e1', title: 'Large clients left', outputLanguage: 'en' as const },
    candidates: [
      {
        candidateKey: 'k1',
        title: ' Slow onboarding ',
        problemDraft: ' Clients wait. ',
        expectedOutput: ' A plan ',
        state: 'proposed',
      },
      {
        candidateKey: 'k2',
        title: 'Old idea',
        problemDraft: 'x',
        expectedOutput: '',
        state: 'dropped',
      },
      {
        candidateKey: 'k3',
        title: 'Already a project',
        problemDraft: 'y',
        expectedOutput: '',
        state: 'promoted',
      },
    ],
  };

  it('turns a usable candidate into the fields of the first step, trimmed', () => {
    const { seed, reason } = candidateSeed(detail, 'k1');
    expect(reason).toBeNull();
    expect(seed).toMatchObject({
      explorationTitle: 'Large clients left',
      candidateTitle: ' Slow onboarding ',
    });
    expect(seedFields(seed!)).toEqual({
      title: 'Slow onboarding',
      initialProblem: 'Clients wait.',
      expectedOutput: 'A plan',
      outputLanguage: 'en',
    });
  });

  it('allows a promoted candidate (it can give another project) but not a dropped or missing one', () => {
    expect(candidateSeed(detail, 'k3').seed).not.toBeNull();
    expect(candidateSeed(detail, 'k2')).toEqual({ seed: null, reason: 'dropped' });
    expect(candidateSeed(detail, 'nope')).toEqual({ seed: null, reason: 'missing' });
  });

  it('replaces any draft except one already started from the same candidate', () => {
    const seed = { explorationId: 'e1', candidateKey: 'k1' };
    expect(shouldApplySeed(null, seed)).toBe(true);
    expect(shouldApplySeed(undefined, seed)).toBe(true);
    expect(shouldApplySeed({ explorationId: 'e1', candidateKey: 'k9' }, seed)).toBe(true);
    expect(shouldApplySeed({ explorationId: 'e2', candidateKey: 'k1' }, seed)).toBe(true);
    expect(shouldApplySeed({ explorationId: 'e1', candidateKey: 'k1' }, seed)).toBe(false);
  });
});
