import {
  defaultDefinition,
  NO_RESEARCH_PLAN_RULES,
  RESEARCH_FOLLOWUP_RULES,
  RESEARCH_PLAN_STAGE_RULES,
  type PromptResearchQuestion,
} from '@docoo/domain';
import { describe, expect, it } from 'vitest';

import type { RetrievedPassage } from './knowledge-retrieval.js';
import {
  assignReferences,
  classifyFinding,
  compactResearchForPrompt,
  mergeFollowup,
  refOffsetsOf,
  verifyResearch,
  type WebRun,
} from './research.js';
import { STAGE_SCHEMAS, stagePrompt } from './stages.js';
import { webRunFrom, webSearchPrompt } from './web-research.js';

function passage(chunkId: string, text: string, conflict = false): RetrievedPassage {
  return {
    chunkId,
    knowledgeId: `k-${chunkId}`,
    versionId: `v-${chunkId}`,
    versionNo: 1,
    title: `Title ${chunkId}`,
    confidentiality: 'internal',
    chunkOrdinal: 0,
    text,
    score: chunkId === 'a' ? 0.04 : 0.02,
    lexicalRank: 1,
    vectorRank: 1,
    similarity: 0.5,
    reviewId: 'r',
    auditScore: 90,
    effectiveDecision: 'approved',
    conflictWarnings: conflict
      ? [
          {
            conflictId: 'c1',
            conflictType: 'contradiction',
            severity: 'high',
            claim: { id: 'x', text: 'mine' },
            conflictingClaim: { id: 'y', text: 'the opposite', knowledgeId: 'k-z' },
          },
        ]
      : [],
  };
}

const passages = () =>
  assignReferences(
    [
      {
        snapshotId: 's1',
        results: [
          passage('a', 'Customers who contact support twice in a month cancel three times more.'),
          passage('b', 'Onboarding calls cut early churn by a fifth in the pilot region.', true),
        ],
      },
    ],
    12,
  );

const web: WebRun = {
  status: 'used',
  code: null,
  queries: ['q'],
  sources: [
    {
      ref: 'W1',
      url: 'https://example.test/report',
      title: 'Industry report',
      text: 'Average annual churn in subscription retail is near twenty percent.',
    },
  ],
};

const plan = {
  versionNo: 2,
  questions: [
    { id: 'Q1', question: 'What drives early churn?', why: 'w', channel: 'both' },
    { id: 'Q2', question: 'What is the market benchmark?', why: 'w', channel: 'web' },
    { id: 'Q3', question: 'Which laws apply?', why: 'w', channel: 'knowledge' },
    { id: 'Q4', question: 'Which fix worked elsewhere?', why: 'w', channel: 'both' },
  ] satisfies PromptResearchQuestion[],
};

const base = {
  queries: [],
  snapshots: [],
  excludedRestricted: true,
  retrieveTool: 'allowed' as const,
  verifierTool: 'allowed' as const,
};

const output = {
  findings: [
    {
      questionId: 'q1',
      claim: 'Repeat support contact predicts cancelling',
      source: 'k',
      evidence: [{ ref: 'K1', quote: 'contact support twice in a month' }],
    },
    {
      questionId: 'Q2',
      claim: 'Industry churn is about twenty percent',
      source: 'report',
      evidence: [{ ref: 'W1', quote: 'near twenty percent' }],
    },
    {
      questionId: 'Q4',
      claim: 'Onboarding calls help',
      source: 'pilot',
      evidence: [{ ref: 'K2', quote: 'cut early churn by a fifth' }],
    },
    { questionId: 'Q9', claim: 'A guess with no support', source: 'guess', evidence: [] },
    { questionId: 'Q3', claim: 'Some law applies', source: 'memory', evidence: [] },
  ],
  gaps: ['Q3: no legal source'],
  conflicts: [{ description: 'Onboarding result is contested', refs: ['K2'] }],
};

describe('research findings filed under planned questions (ADR-0038)', () => {
  const { content } = verifyResearch({ ...base, passages: passages(), web, plan, output });

  it('keeps the question a finding answers, normalised, and drops an unknown one', () => {
    expect(content.findings.map((finding) => finding.questionId)).toEqual([
      'Q1',
      'Q2',
      'Q4',
      '',
      'Q3',
    ]);
  });

  it('grades each finding by what supports it and whether a conflict names it', () => {
    expect(content.findings.map((finding) => finding.level)).toEqual([
      'solid',
      'limited',
      'disputed',
      'unverified',
      'unverified',
    ]);
  });

  it('says how each planned question fared', () => {
    expect(content.plan?.versionNo).toBe(2);
    expect(
      content.plan?.questions.map((item) => [item.id, item.status, item.findings, item.supported]),
    ).toEqual([
      ['Q1', 'answered', 1, 1],
      ['Q2', 'answered', 1, 1],
      ['Q3', 'weak', 1, 0],
      ['Q4', 'answered', 1, 1],
    ]);
  });

  it('counts the whole output at a glance', () => {
    expect(content.summary).toEqual({
      findings: 5,
      solid: 1,
      limited: 1,
      unverified: 2,
      disputed: 1,
      questions: { total: 4, answered: 3, weak: 1, unanswered: 0 },
      sources: { knowledge: 2, web: 1, official: 0, public: 1 },
      singleSource: 3,
    });
  });

  it('marks a planned question with no finding as unanswered', () => {
    const lonely = verifyResearch({
      ...base,
      passages: [],
      plan,
      output: { findings: [], gaps: [], conflicts: [] },
    });
    expect(lonely.content.summary?.questions).toEqual({
      total: 4,
      answered: 0,
      weak: 0,
      unanswered: 4,
    });
  });

  it('works without a plan: no plan block, findings under no question', () => {
    const plain = verifyResearch({ ...base, passages: passages(), output });
    expect(plain.content.plan).toBeUndefined();
    expect(plain.content.findings.every((finding) => finding.questionId === '')).toBe(true);
    expect(plain.content.summary?.questions.total).toBe(0);
  });

  it('classifies by support, with a dispute overriding it', () => {
    expect(classifyFinding('knowledge', false)).toBe('solid');
    expect(classifyFinding('web', false)).toBe('limited');
    expect(classifyFinding('unverified', false)).toBe('unverified');
    expect(classifyFinding('knowledge', true)).toBe('disputed');
  });

  it('hands later stages the question, the grade and what stayed open', () => {
    const compact = compactResearchForPrompt(content) as {
      findings: { questionId?: string; level?: string }[];
      openQuestions?: { id: string; status: string }[];
    };
    expect(compact.findings[0]).toMatchObject({ questionId: 'Q1', level: 'solid' });
    expect(compact.findings[3]).not.toHaveProperty('questionId');
    expect(compact.openQuestions).toEqual([
      { id: 'Q3', question: 'Which laws apply?', status: 'weak' },
    ]);
  });
});

describe('research prompt with a plan', () => {
  const context = {
    stage: 'research' as const,
    definition: defaultDefinition('researcher'),
    language: 'en' as const,
    projectTitle: 'Churn',
    problem: 'p',
    topics: [],
    previous: [],
    feedback: [],
  };
  const data = (message: string) => JSON.parse(message.slice(6, -7)) as Record<string, unknown>;

  it('gives the researcher the questions as data and the rules that file findings under them', () => {
    const prompt = stagePrompt({ ...context, researchPlan: plan.questions });
    for (const rule of RESEARCH_PLAN_STAGE_RULES) expect(prompt.instructions).toContain(rule);
    expect(data(prompt.message)['researchPlan']).toEqual(plan.questions);
    expect(prompt.instructions).not.toContain('What drives early churn?');
  });

  it('tells the researcher to leave questionId empty when there is no plan', () => {
    for (const researchPlan of [undefined, []]) {
      const prompt = stagePrompt({ ...context, researchPlan });
      for (const rule of NO_RESEARCH_PLAN_RULES) expect(prompt.instructions).toContain(rule);
      expect(data(prompt.message)).not.toHaveProperty('researchPlan');
    }
  });

  it('does not leak the plan to the other stages', () => {
    const prompt = stagePrompt({ ...context, stage: 'ideation', researchPlan: plan.questions });
    expect(data(prompt.message)).not.toHaveProperty('researchPlan');
    expect(prompt.instructions).not.toContain('questionId');
  });

  it('asks the web search for the planned questions that may use the web', () => {
    const search = webSearchPrompt({
      language: 'en',
      projectTitle: 'Churn',
      problem: 'p',
      topics: [],
      analysis: null,
      questions: plan.questions.filter((question) => question.channel !== 'knowledge'),
    });
    expect(search.instructions).toContain('researchQuestions');
    expect(data(search.message)['researchQuestions']).toHaveLength(3);
    const plain = webSearchPrompt({
      language: 'en',
      projectTitle: 'Churn',
      problem: 'p',
      topics: [],
      analysis: null,
    });
    expect(plain.instructions).not.toContain('researchQuestions');
  });

  it('requires questionId in every finding of the structured answer', () => {
    const finding = (
      (STAGE_SCHEMAS.research['properties'] as Record<string, { items: { required: string[] } }>)[
        'findings'
      ] as { items: { required: string[] } }
    ).items;
    expect(finding.required).toContain('questionId');
  });
});

describe('follow-up round (ADR-0039)', () => {
  const previous = verifyResearch({ ...base, passages: passages(), web, plan, output }).content;
  const fullPlan = {
    versionNo: 3,
    questions: [
      ...plan.questions,
      { id: 'Q5', question: 'What do rivals charge?', why: 'w', channel: 'web' },
    ] satisfies PromptResearchQuestion[],
  };
  const focus = fullPlan.questions.filter((question) => ['Q3', 'Q5'].includes(question.id));
  const offsets = refOffsetsOf(previous);
  const freshWeb: WebRun = {
    status: 'used',
    code: null,
    queries: ['rivals'],
    sources: [
      {
        ref: `W${offsets.web + 1}`,
        url: 'https://example.test/prices',
        title: 'Price survey',
        text: 'Rivals charge between nine and fifteen euros a month for the basic tier.',
      },
    ],
  };
  const freshPassages = assignReferences(
    [
      {
        snapshotId: 's2',
        results: [
          passage('c', 'Data protection law requires consent before any profiling of customers.'),
        ],
      },
    ],
    12,
    Number.POSITIVE_INFINITY,
    offsets.knowledge,
  );
  const fresh = verifyResearch({
    ...base,
    queries: ['laws'],
    passages: freshPassages,
    web: freshWeb,
    plan: { versionNo: 3, questions: focus },
    output: {
      findings: [
        {
          questionId: 'Q3',
          claim: 'Profiling needs consent',
          source: 'law',
          evidence: [{ ref: 'K3', quote: 'requires consent before any profiling' }],
        },
        {
          questionId: 'Q5',
          claim: 'Rivals charge nine to fifteen euros',
          source: 'survey',
          evidence: [{ ref: 'W2', quote: 'between nine and fifteen euros a month' }],
        },
      ],
      gaps: ['Q5: only one survey'],
      conflicts: [],
    },
  }).content;
  const merged = mergeFollowup({
    previous,
    fresh,
    focus: focus.map((question) => question.id),
    plan: fullPlan,
  });

  it('continues the references after the earlier ones, so they never collide', () => {
    expect(offsets).toEqual({ knowledge: 2, web: 1 });
    expect(freshPassages.map((item) => item.ref)).toEqual(['K3']);
    expect(merged.knowledge.offered.map((item) => item.ref)).toEqual(['K1', 'K2', 'K3']);
    expect(merged.web?.sources.map((item) => item.ref)).toEqual(['W1', 'W2']);
  });

  it('replaces the findings of the worked questions and keeps every other one as it was', () => {
    expect(merged.findings.map((finding) => finding.questionId)).toEqual([
      'Q1',
      'Q2',
      'Q4',
      '',
      'Q3',
      'Q5',
    ]);
    // The kept findings are the very same objects' content, citations included.
    expect(merged.findings[0]?.evidence).toEqual(previous.findings[0]?.evidence);
    expect(merged.findings.find((finding) => finding.questionId === 'Q3')?.claim).toBe(
      'Profiling needs consent',
    );
    expect(merged.findings.filter((finding) => finding.claim === 'Some law applies')).toEqual([]);
  });

  it('counts everything again over the joined findings', () => {
    expect(merged.plan?.questions.map((item) => [item.id, item.status, item.findings])).toEqual([
      ['Q1', 'answered', 1],
      ['Q2', 'answered', 1],
      ['Q3', 'answered', 1],
      ['Q4', 'answered', 1],
      ['Q5', 'answered', 1],
    ]);
    expect(merged.plan?.versionNo).toBe(3);
    expect(merged.summary).toEqual({
      findings: 6,
      solid: 2,
      limited: 2,
      unverified: 1,
      disputed: 1,
      questions: { total: 5, answered: 5, weak: 0, unanswered: 0 },
      sources: { knowledge: 3, web: 2, official: 0, public: 2 },
      singleSource: 5,
    });
    expect(merged.verification.findings).toBe(6);
    expect(merged.verification.supported).toBe(5);
  });

  it('drops the gaps of the worked questions, keeps the others, and records the round', () => {
    expect(merged.gaps).toEqual(['Q5: only one survey']);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.knowledge.queries).toEqual(['laws']);
    expect(merged.rounds).toEqual([{ questions: ['Q3', 'Q5'] }]);
    const again = mergeFollowup({ previous: merged, fresh, focus: ['Q5'], plan: fullPlan });
    expect(again.rounds).toEqual([{ questions: ['Q3', 'Q5'] }, { questions: ['Q5'] }]);
  });

  it('asks the researcher for the open questions only, with the earlier findings as data', () => {
    const context = {
      stage: 'research' as const,
      definition: defaultDefinition('researcher'),
      language: 'en' as const,
      projectTitle: 'Churn',
      problem: 'p',
      topics: [],
      previous: [],
      feedback: [],
      researchPlan: focus,
    };
    const prompt = stagePrompt({ ...context, earlierFindings: compactResearchForPrompt(previous) });
    for (const rule of RESEARCH_FOLLOWUP_RULES) expect(prompt.instructions).toContain(rule);
    const data = JSON.parse(prompt.message.slice(6, -7)) as Record<string, unknown>;
    expect(data['researchPlan']).toEqual(focus);
    expect(JSON.stringify(data['earlierFindings'])).toContain('Repeat support contact');
    const plain = stagePrompt(context);
    expect(plain.instructions).not.toContain('follow-up round');
    expect(JSON.parse(plain.message.slice(6, -7))).not.toHaveProperty('earlierFindings');
  });

  it('numbers web pages after the earlier ones', () => {
    const run = webRunFrom(
      { queries: ['q'], sources: [{ url: 'https://a.test', title: 'A', text: 't' }] },
      4,
    );
    expect(run.sources.map((item) => item.ref)).toEqual(['W5']);
  });
});
