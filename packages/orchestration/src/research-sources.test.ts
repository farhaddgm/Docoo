import { defaultDefinition, RESEARCH_DECISION_RULES, WEB_SOURCE_CLASS_RULES } from '@docoo/domain';
import { describe, expect, it } from 'vitest';

import { describeRef, researchConflicts } from './research-conflicts.js';
import {
  assignReferences,
  compactResearchForPrompt,
  verifyResearch,
  webPromptItems,
  type WebRun,
} from './research.js';
import { stagePrompt, type StageContext } from './stages.js';
import { webRunFrom } from './web-research.js';

const found = {
  queries: ['q'],
  sources: [
    {
      url: 'https://data.worldbank.org/a',
      title: 'World Bank',
      text: 'Churn in retail is 20 percent per year.',
    },
    {
      url: 'https://blog.example.com/b',
      title: 'A blog',
      text: 'Many shops see churn of 30 percent per year.',
    },
    {
      url: 'https://reports.regulator.test/c',
      title: 'Regulator',
      text: 'Annual churn is regulated at 25 percent.',
    },
  ],
};

describe('web pages carry their class (ADR-0040)', () => {
  it('decides official or public from the address, and from the listed domains', () => {
    const run = webRunFrom(found, 0, ['regulator.test']);
    expect(run.sources.map((source) => [source.ref, source.sourceClass])).toEqual([
      ['W1', 'official'],
      ['W2', 'public'],
      ['W3', 'official'],
    ]);
    expect(webRunFrom(found).sources[2]?.sourceClass).toBe('public');
    expect(webPromptItems(run).map((item) => item.sourceClass)).toEqual([
      'official',
      'public',
      'official',
    ]);
  });
});

describe('what backs a finding (ADR-0040)', () => {
  const web: WebRun = webRunFrom(found, 0, []);
  const passages = assignReferences(
    [
      {
        snapshotId: 's',
        results: [
          {
            chunkId: 'a',
            knowledgeId: 'k',
            versionId: 'v',
            versionNo: 1,
            title: 'Internal study',
            confidentiality: 'internal',
            chunkOrdinal: 0,
            text: 'Support contact predicts cancelling within a month.',
            score: 0.04,
            lexicalRank: 1,
            vectorRank: 1,
            similarity: 0.5,
            reviewId: 'r',
            auditScore: 90,
            effectiveDecision: 'approved',
            conflictWarnings: [],
          },
        ],
      },
    ],
    12,
  );
  const { content } = verifyResearch({
    passages,
    queries: [],
    snapshots: [],
    excludedRestricted: true,
    retrieveTool: 'allowed',
    verifierTool: 'allowed',
    web,
    output: {
      findings: [
        {
          claim: 'Retail churn is about a fifth a year',
          source: 'bank',
          evidence: [
            { ref: 'W1', quote: 'churn in retail is 20 percent' },
            { ref: 'K1', quote: 'contact predicts cancelling' },
          ],
        },
        {
          claim: 'Shops see thirty percent',
          source: 'blog',
          evidence: [{ ref: 'W2', quote: 'churn of 30 percent per year' }],
        },
        { claim: 'A guess', source: 'memory', evidence: [] },
      ],
      gaps: [],
      conflicts: [{ description: 'Rates differ', refs: ['W1', 'W2'] }],
    },
  });

  it('records the class of every source and how many verified ones back a finding', () => {
    expect(content.findings.map((finding) => finding.sourceKinds)).toEqual([
      ['official', 'knowledge'],
      ['public'],
      [],
    ]);
    expect(content.findings.map((finding) => finding.verifiedSources)).toEqual([2, 1, 0]);
    expect(content.findings[0]?.evidence.map((cite) => cite.sourceClass)).toEqual([
      'official',
      'knowledge',
    ]);
    // The regulator is public here: its domain is not in the administrator's list.
    expect(content.web?.sources.map((source) => source.sourceClass)).toEqual([
      'official',
      'public',
      'public',
    ]);
  });

  it('counts the cited pages by class and the findings that rest on one source', () => {
    expect(content.summary?.sources).toEqual({ knowledge: 1, web: 2, official: 1, public: 1 });
    expect(content.summary?.singleSource).toBe(1);
  });

  it('hands later stages the kinds of source and a single-source flag', () => {
    const compact = compactResearchForPrompt(content) as {
      findings: Record<string, unknown>[];
    };
    expect(compact.findings[0]).toMatchObject({ sourceKinds: ['official', 'knowledge'] });
    expect(compact.findings[0]).not.toHaveProperty('singleSource');
    expect(compact.findings[1]).toMatchObject({ sourceKinds: ['public'], singleSource: true });
  });

  it('names the sources of a conflict with their titles and classes', () => {
    const [conflict] = researchConflicts(content);
    expect(conflict?.fingerprint).toMatch(/^[0-9a-f]{16}$/u);
    expect(conflict?.sources).toEqual([
      { ref: 'W1', title: 'World Bank', url: 'https://data.worldbank.org/a', kind: 'official' },
      { ref: 'W2', title: 'A blog', url: 'https://blog.example.com/b', kind: 'public' },
    ]);
    expect(describeRef(content, 'K1')).toMatchObject({
      title: 'Internal study',
      kind: 'knowledge',
    });
    expect(describeRef(content, 'W9')).toMatchObject({ title: '', kind: 'public' });
    // An output without a conflicts list reports none.
    expect(researchConflicts({ findings: [] })).toEqual([]);
    expect(researchConflicts('edited by hand')).toEqual([]);
  });

  it('puts the administrator’s decisions into what later stages read', () => {
    const decisions = [
      { conflict: 'Rates differ', decision: 'trust' as const, trustedSource: 'W1 — World Bank' },
    ];
    const compact = compactResearchForPrompt(content, decisions) as {
      conflictDecisions?: unknown;
    };
    expect(compact.conflictDecisions).toEqual(decisions);
    expect(compactResearchForPrompt(content)).not.toHaveProperty('conflictDecisions');
  });
});

describe('rules about sources in the prompts (ADR-0040)', () => {
  const context = (extra: Partial<StageContext>): StageContext => ({
    stage: 'ideation',
    definition: defaultDefinition('ideator'),
    language: 'en',
    projectTitle: 'Churn',
    problem: 'p',
    topics: [],
    previous: [],
    feedback: [],
    ...extra,
  });

  it('tells the researcher about the class of web pages only when it has pages', () => {
    const withPages = stagePrompt(
      context({
        stage: 'research',
        definition: defaultDefinition('researcher'),
        web: webPromptItems(webRunFrom(found)),
      }),
    );
    for (const rule of WEB_SOURCE_CLASS_RULES) expect(withPages.instructions).toContain(rule);
    const without = stagePrompt(
      context({ stage: 'research', definition: defaultDefinition('researcher') }),
    );
    for (const rule of WEB_SOURCE_CLASS_RULES) expect(without.instructions).not.toContain(rule);
  });

  it('makes the decisions binding for the stages after the research, and only then', () => {
    const decided = stagePrompt(
      context({
        previous: [
          {
            stage: 'research',
            content: {
              findings: [],
              conflictDecisions: [{ conflict: 'Rates differ', decision: 'dismiss' }],
            },
          },
        ],
      }),
    );
    for (const rule of RESEARCH_DECISION_RULES) expect(decided.instructions).toContain(rule);
    const plain = stagePrompt(
      context({ previous: [{ stage: 'research', content: { findings: [] } }] }),
    );
    for (const rule of RESEARCH_DECISION_RULES) expect(plain.instructions).not.toContain(rule);
  });
});
