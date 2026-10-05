import { describe, expect, it } from 'vitest';

import {
  ANALYSIS_LIMITS,
  analysisProgress,
  answerStatuses,
  batchCapacity,
  checkAnswer,
  contradictionKey,
  coverageGaps,
  coverageReport,
  dedupeQuestions,
  decideRound,
  isBatchComplete,
  isQuestionCategory,
  isUnresolved,
  normalizeQuestionText,
  questionCategories,
  questionSimilarity,
  reconcileContradictions,
  requiredCategoriesFor,
  requiredQuestionCategories,
  type QuestionCategory,
  type QuestionStatus,
  type RoundFacts,
} from './analysis.js';

const question = (category: QuestionCategory, status: QuestionStatus) => ({ category, status });

describe('analysis limits (FR-ANL-001, FR-ANL-002)', () => {
  it('fixes thirty to three hundred questions in batches of at most forty', () => {
    expect(ANALYSIS_LIMITS).toEqual({ minimumQuestions: 30, maximumQuestions: 300, batchSize: 40 });
  });

  it('gives the next batch forty places, fewer near the ceiling and none at it', () => {
    expect(batchCapacity(0)).toBe(40);
    expect(batchCapacity(40)).toBe(40);
    expect(batchCapacity(260)).toBe(40);
    expect(batchCapacity(270)).toBe(30);
    expect(batchCapacity(299)).toBe(1);
    expect(batchCapacity(300)).toBe(0);
    expect(batchCapacity(350)).toBe(0);
  });

  it('knows the eight required dimensions of FR-ANL-004 plus the charter extras', () => {
    expect(requiredQuestionCategories).toHaveLength(8);
    expect(questionCategories).toHaveLength(10);
    for (const category of requiredQuestionCategories)
      expect(questionCategories).toContain(category);
    expect(isQuestionCategory('budget')).toBe(true);
    expect(isQuestionCategory('mood')).toBe(false);
    expect(answerStatuses).toEqual(['answered', 'unanswered', 'irrelevant', 'later']);
  });
});

describe('repeated questions', () => {
  it('compares Persian and Arabic letter forms, digits and punctuation as the same', () => {
    expect(normalizeQuestionText('آيا بودجهٔ ۱۰۰ میلیون كافی است؟')).toBe(
      normalizeQuestionText('آیا بودجهٔ 100 میلیون کافی است'),
    );
    expect(normalizeQuestionText('  What   is the BUDGET?!  ')).toBe('what is the budget');
    expect(normalizeQuestionText('می‌خواهیم')).toBe('می خواهیم');
  });

  it('scores identical wording 1 and unrelated wording near 0', () => {
    expect(questionSimilarity('What is the budget?', 'what is the budget')).toBe(1);
    expect(questionSimilarity('What is the budget?', 'Who owns the data?')).toBeLessThan(0.3);
    expect(questionSimilarity('', 'anything')).toBe(0);
  });

  it('drops a question that repeats an earlier one or another one in the same proposal', () => {
    const result = dedupeQuestions(
      [
        { text: 'What is the total budget?' },
        { text: 'What is the total budget' },
        { text: 'Who are the stakeholders?' },
        { text: 'Who are the stakeholders?!' },
        { text: '   ' },
        { text: 'By when must it be finished?' },
      ],
      ['What is the total budget?'],
    );
    expect(result.kept.map((item) => item.text)).toEqual([
      'Who are the stakeholders?',
      'By when must it be finished?',
    ]);
    expect(result.dropped.map((item) => item.of)).toEqual([
      'earlier',
      'earlier',
      'same_batch',
      'same_batch',
    ]);
  });

  it('keeps questions that only share a few words', () => {
    const result = dedupeQuestions(
      [{ text: 'آیا بودجه مشخص است؟' }, { text: 'آیا زمان مشخص است؟' }],
      [],
    );
    expect(result.kept).toHaveLength(2);
  });
});

describe('progress and coverage (FR-ANL-004, UX §7)', () => {
  it('counts what was asked, answered and left open', () => {
    const progress = analysisProgress([
      { status: 'answered' },
      { status: 'answered' },
      { status: 'unanswered' },
      { status: 'irrelevant' },
      { status: 'later' },
      { status: 'open' },
    ]);
    expect(progress).toMatchObject({
      asked: 6,
      answered: 2,
      unanswered: 1,
      irrelevant: 1,
      later: 1,
      open: 1,
      minimum: 30,
      maximum: 300,
      minimumReached: false,
      maximumReached: false,
    });
  });

  it('reaches the minimum and the maximum exactly at thirty and three hundred', () => {
    const many = (count: number) =>
      Array.from({ length: count }, () => ({ status: 'open' as const }));
    expect(analysisProgress(many(29)).minimumReached).toBe(false);
    expect(analysisProgress(many(30)).minimumReached).toBe(true);
    expect(analysisProgress(many(299)).maximumReached).toBe(false);
    expect(analysisProgress(many(300)).maximumReached).toBe(true);
  });

  it('grades every dimension from none to covered', () => {
    const report = coverageReport([
      question('goal', 'answered'),
      question('goal', 'answered'),
      question('constraint', 'answered'),
      question('constraint', 'later'),
      question('context', 'open'),
      question('stakeholder', 'unanswered'),
      question('time', 'irrelevant'),
      question('budget', 'answered'),
      question('budget', 'unanswered'),
    ]);
    const level = (category: QuestionCategory) =>
      report.find((entry) => entry.category === category)!.level;
    expect(report.map((entry) => entry.category)).toEqual([...questionCategories]);
    expect(level('goal')).toBe('covered');
    expect(level('constraint')).toBe('partial');
    expect(level('context')).toBe('pending');
    expect(level('stakeholder')).toBe('gap');
    expect(level('time')).toBe('not_applicable');
    expect(level('budget')).toBe('partial');
    expect(level('data')).toBe('none');
    expect(report.find((entry) => entry.category === 'risk')!.required).toBe(false);
    expect(report.find((entry) => entry.category === 'goal')!.required).toBe(true);
  });

  it('lists required dimensions without any question as gaps', () => {
    const gaps = coverageGaps(
      coverageReport([question('goal', 'answered'), question('risk', 'open')]),
    );
    expect(gaps).toEqual([
      'constraint',
      'context',
      'stakeholder',
      'time',
      'budget',
      'data',
      'success_criteria',
    ]);
    expect(coverageGaps(coverageReport([]))).toHaveLength(8);
  });

  it('names later and unanswered questions as unresolved', () => {
    expect(isUnresolved('later')).toBe(true);
    expect(isUnresolved('unanswered')).toBe(true);
    expect(isUnresolved('answered')).toBe(false);
    expect(isUnresolved('irrelevant')).toBe(false);
    expect(isUnresolved('open')).toBe(false);
  });
});

describe('configurable required dimensions (FR-ANL-004)', () => {
  it('never drops the eight and adds risk and out of scope only when asked', () => {
    expect(requiredCategoriesFor({})).toEqual(requiredQuestionCategories);
    expect(requiredCategoriesFor({ risk: false, outOfScope: false })).toEqual(
      requiredQuestionCategories,
    );
    expect(requiredCategoriesFor({ risk: true })).toEqual([...requiredQuestionCategories, 'risk']);
    expect(requiredCategoriesFor({ outOfScope: true })).toEqual([
      ...requiredQuestionCategories,
      'out_of_scope',
    ]);
    expect(requiredCategoriesFor({ risk: true, outOfScope: true })).toHaveLength(10);
  });

  it('makes a missing optional dimension a gap that blocks "enough"', () => {
    const asked = requiredQuestionCategories.map((category) => question(category, 'answered'));
    expect(coverageGaps(coverageReport(asked))).toEqual([]);
    const strict = coverageReport(asked, requiredCategoriesFor({ risk: true, outOfScope: true }));
    expect(coverageGaps(strict)).toEqual(['risk', 'out_of_scope']);
    expect(strict.find((entry) => entry.category === 'risk')?.required).toBe(true);
    const sufficient = {
      asked: 45,
      finishRequested: false,
      modelSufficient: true,
      newQuestionCount: 0,
    };
    expect(decideRound({ ...sufficient, coverageGaps: coverageGaps(strict) })).toMatchObject({
      action: 'define',
      reason: 'nothing_new',
    });
    expect(
      decideRound({ ...sufficient, newQuestionCount: 3, coverageGaps: coverageGaps(strict) }),
    ).toMatchObject({ action: 'ask', reason: 'coverage' });
  });
});

describe('round decision', () => {
  const facts = (overrides: Partial<RoundFacts> = {}): RoundFacts => ({
    asked: 20,
    finishRequested: false,
    modelSufficient: false,
    newQuestionCount: 10,
    coverageGaps: [],
    ...overrides,
  });

  it('keeps asking until thirty questions exist, even when the model says it has enough', () => {
    expect(decideRound(facts({ modelSufficient: true }))).toEqual({
      action: 'ask',
      reason: 'minimum',
    });
    expect(decideRound(facts({ asked: 29, modelSufficient: true }))).toEqual({
      action: 'ask',
      reason: 'minimum',
    });
  });

  it('accepts "enough" from thirty questions on when every required dimension has a question', () => {
    expect(decideRound(facts({ asked: 30, modelSufficient: true }))).toEqual({
      action: 'define',
      reason: 'sufficient',
    });
  });

  it('refuses "enough" while a required dimension has no question', () => {
    expect(
      decideRound(facts({ asked: 40, modelSufficient: true, coverageGaps: ['budget'] })),
    ).toEqual({
      action: 'ask',
      reason: 'coverage',
    });
  });

  it('keeps asking when the model wants more and there is room', () => {
    expect(decideRound(facts({ asked: 60, modelSufficient: false }))).toEqual({
      action: 'ask',
      reason: 'analyst',
    });
  });

  it('defines on request only from thirty questions on', () => {
    expect(decideRound(facts({ asked: 29, finishRequested: true }))).toEqual({
      action: 'ask',
      reason: 'minimum',
    });
    expect(decideRound(facts({ asked: 30, finishRequested: true, newQuestionCount: 5 }))).toEqual({
      action: 'define',
      reason: 'finish_requested',
    });
  });

  it('stops at three hundred questions whatever else is wanted', () => {
    expect(
      decideRound(
        facts({ asked: 300, modelSufficient: false, newQuestionCount: 40, coverageGaps: ['data'] }),
      ),
    ).toEqual({ action: 'define', reason: 'maximum_reached' });
  });

  it('defines when the model has nothing new after thirty questions, but stalls before that', () => {
    expect(decideRound(facts({ asked: 45, newQuestionCount: 0 }))).toEqual({
      action: 'define',
      reason: 'nothing_new',
    });
    expect(decideRound(facts({ asked: 12, newQuestionCount: 0 }))).toEqual({ action: 'stalled' });
    expect(decideRound(facts({ asked: 0, newQuestionCount: 0, modelSufficient: true }))).toEqual({
      action: 'stalled',
    });
  });

  it('treats a missing model judgement like "not enough"', () => {
    expect(decideRound(facts({ asked: 50, modelSufficient: null, newQuestionCount: 3 }))).toEqual({
      action: 'ask',
      reason: 'analyst',
    });
  });
});

describe('contradiction log', () => {
  it('keys a pair of questions the same way in either order', () => {
    expect(contradictionKey(7, 3)).toBe('3-7');
    expect(contradictionKey(3, 7)).toBe('3-7');
  });

  it('logs new contradictions, resolves vanished ones and reopens returning ones', () => {
    const changes = reconcileContradictions(
      [
        { key: '1-2', status: 'open' },
        { key: '3-4', status: 'open' },
        { key: '5-6', status: 'resolved' },
      ],
      ['1-2', '5-6', '7-8'],
    );
    expect(changes).toEqual({ toOpen: ['7-8'], toReopen: ['5-6'], toResolve: ['3-4'] });
  });

  it('changes nothing when the report matches the log', () => {
    expect(reconcileContradictions([{ key: '1-2', status: 'open' }], ['1-2'])).toEqual({
      toOpen: [],
      toReopen: [],
      toResolve: [],
    });
    expect(reconcileContradictions([], [])).toEqual({ toOpen: [], toReopen: [], toResolve: [] });
  });
});

describe('answers (FR-ANL-003)', () => {
  it('needs text or a file to count as answered', () => {
    expect(
      checkAnswer({ status: 'answered', text: 'We have 3 months.', attachmentCount: 0 }),
    ).toBeNull();
    expect(checkAnswer({ status: 'answered', attachmentCount: 1 })).toBeNull();
    expect(checkAnswer({ status: 'answered', text: '   ', attachmentCount: 0 })).toBe(
      'ANSWER_EMPTY',
    );
    expect(checkAnswer({ status: 'answered', attachmentCount: 0 })).toBe('ANSWER_EMPTY');
  });

  it('lets the three special statuses carry a note but no file', () => {
    for (const status of ['unanswered', 'irrelevant', 'later'] as const) {
      expect(checkAnswer({ status, attachmentCount: 0 })).toBeNull();
      expect(checkAnswer({ status, text: 'Ask finance first', attachmentCount: 0 })).toBeNull();
      expect(checkAnswer({ status, attachmentCount: 1 })).toBe('ANSWER_STATUS_HAS_ATTACHMENTS');
    }
  });

  it('limits the text and the number of files', () => {
    expect(
      checkAnswer({ status: 'answered', text: 'x'.repeat(8000), attachmentCount: 0 }),
    ).toBeNull();
    expect(checkAnswer({ status: 'answered', text: 'x'.repeat(8001), attachmentCount: 0 })).toBe(
      'ANSWER_TOO_LONG',
    );
    expect(checkAnswer({ status: 'answered', attachmentCount: 5 })).toBeNull();
    expect(checkAnswer({ status: 'answered', attachmentCount: 6 })).toBe(
      'ANSWER_TOO_MANY_ATTACHMENTS',
    );
  });

  it('completes a batch only when no question is open', () => {
    expect(isBatchComplete(['answered', 'later', 'irrelevant', 'unanswered'])).toBe(true);
    expect(isBatchComplete(['answered', 'open'])).toBe(false);
    expect(isBatchComplete([])).toBe(false);
  });
});
