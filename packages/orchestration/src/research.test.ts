import { defaultDefinition } from '@docoo/domain';
import { sampleForSchema } from '@docoo/providers';
import { describe, expect, it } from 'vitest';

import { fakeResearchResponder } from './fake-responders.js';
import type { RetrievedPassage } from './knowledge-retrieval.js';
import {
  assignReferences,
  buildResearchQueries,
  compactResearchForPrompt,
  knowledgePromptItems,
  quoteInText,
  RESEARCH_LIMITS,
  verifyResearch,
  type KnowledgePassage,
} from './research.js';
import { KNOWLEDGE_RULES, NO_KNOWLEDGE_RULES, STAGE_SCHEMAS, stagePrompt } from './stages.js';

function passage(overrides: Partial<RetrievedPassage> & { chunkId: string }): RetrievedPassage {
  return {
    knowledgeId: `k-${overrides.chunkId}`,
    versionId: `v-${overrides.chunkId}`,
    versionNo: 1,
    title: `Title ${overrides.chunkId}`,
    confidentiality: 'internal',
    chunkOrdinal: 0,
    text: 'Customers who contact support twice in a month are three times likelier to cancel.',
    score: 0.03,
    lexicalRank: 1,
    vectorRank: 1,
    similarity: 0.5,
    reviewId: 'r',
    auditScore: 90,
    effectiveDecision: 'approved',
    conflictWarnings: [],
    ...overrides,
  };
}

const passages = (): KnowledgePassage[] =>
  assignReferences(
    [
      {
        snapshotId: 's1',
        results: [
          passage({ chunkId: 'a', score: 0.04 }),
          passage({
            chunkId: 'b',
            score: 0.02,
            text: 'مشتریانی که در ماه دو بار با پشتیبانی تماس می‌گیرند بیشتر لغو می‌کنند.',
            effectiveDecision: 'approved_by_override',
            conflictWarnings: [
              {
                conflictId: 'c1',
                conflictType: 'contradiction',
                severity: 'high',
                claim: { id: 'x', text: 'mine' },
                conflictingClaim: { id: 'y', text: 'the opposite', knowledgeId: 'k-z' },
              },
            ],
          }),
        ],
      },
    ],
    12,
  );

describe('research queries', () => {
  it('starts from the approved problem statement and objectives, without duplicates', () => {
    const queries = buildResearchQueries({
      projectTitle: 'Churn',
      problem: 'Customers leave',
      topics: ['Retail'],
      analysis: {
        problemStatement: 'Reduce monthly churn',
        objectives: ['Reduce monthly churn', 'Find early signals', ''],
        needStatement: 'Keep revenue',
      },
      max: 5,
    });
    expect(queries).toEqual([
      'Reduce monthly churn',
      'Find early signals',
      'Keep revenue',
      'Customers leave',
      'Churn',
    ]);
  });

  it('falls back to the project text and honours the cap and the length limit', () => {
    const queries = buildResearchQueries({
      projectTitle: 'Churn',
      problem: 'x'.repeat(1000),
      topics: ['Retail', 'Telecom'],
      analysis: null,
      max: 2,
    });
    expect(queries).toHaveLength(2);
    expect(queries[0]!.length).toBeLessThanOrEqual(RESEARCH_LIMITS.maxQueryLength);
    expect(queries[1]).toBe('Churn');
  });

  it('asks nothing when there is nothing worth asking', () => {
    expect(
      buildResearchQueries({ projectTitle: '', problem: ' ', topics: [], analysis: {}, max: 5 }),
    ).toEqual([]);
  });
});

describe('references', () => {
  it('numbers passages by score, keeps the best score of a repeated chunk and cuts to the limit', () => {
    const refs = assignReferences(
      [
        { snapshotId: 's1', results: [passage({ chunkId: 'a', score: 0.01 })] },
        {
          snapshotId: 's2',
          results: [passage({ chunkId: 'a', score: 0.05 }), passage({ chunkId: 'b', score: 0.03 })],
        },
      ],
      2,
    );
    expect(refs.map((item) => [item.ref, item.chunkId, item.snapshotId])).toEqual([
      ['K1', 'a', 's2'],
      ['K2', 'b', 's2'],
    ]);
    expect(
      assignReferences([{ snapshotId: 's', results: [passage({ chunkId: 'a' })] }], 0),
    ).toEqual([]);
  });

  it('gives the model no ids or scores, only what it needs to cite', () => {
    const items = knowledgePromptItems(passages());
    expect(items.map((item) => item.ref)).toEqual(['K1', 'K2']);
    expect(Object.keys(items[0]!).sort()).toEqual(['approval', 'ref', 'text', 'title', 'version']);
    expect(items[1]).toMatchObject({
      approval: 'approved by administrator override',
      openConflicts: ['the opposite'],
    });
  });
});

describe('quote checking', () => {
  const text = 'Customers who contact support twice in a month are three times likelier to cancel.';

  it('accepts a verbatim excerpt regardless of case, spacing and digits', () => {
    expect(quoteInText('CONTACT   support twice in a month', text)).toBe('ok');
    expect(quoteInText('مشتریان ۲ بار', 'مشتریان 2 بار تماس گرفتند')).toBe('ok');
  });

  it('accepts skipped words only in order', () => {
    expect(quoteInText('Customers who … likelier to cancel', text)).toBe('ok');
    expect(quoteInText('likelier to cancel … Customers who contact', text)).toBe('not_found');
  });

  it('rejects text that is not in the passage and quotes too short to prove anything', () => {
    expect(quoteInText('Customers rarely cancel after contacting support', text)).toBe('not_found');
    expect(quoteInText('twice', text)).toBe('too_short');
    expect(quoteInText('…', text)).toBe('too_short');
  });
});

describe('citation verification', () => {
  const base = () => ({
    passages: passages(),
    queries: ['q'],
    snapshots: [{ id: 's1', query: 'q', results: 2 }],
    excludedRestricted: true,
    retrieveTool: 'allowed' as const,
    verifierTool: 'allowed' as const,
  });

  it('marks a finding supported only by a verified citation and keeps failed ones visible', () => {
    const { content, cited } = verifyResearch({
      ...base(),
      output: {
        findings: [
          {
            claim: 'Support contacts predict churn',
            source: 'Title a',
            evidence: [
              { ref: 'k1', quote: 'contact support twice in a month' },
              { ref: 'K1', quote: 'contact support twice in a month' },
              { ref: 'K9', quote: 'made up' },
              { ref: 'K2', quote: 'something the passage never said' },
            ],
          },
          { claim: 'Others do it too', source: 'general knowledge', evidence: [] },
          {
            claim: 'Only a failed citation',
            source: 'x',
            evidence: [{ ref: 'K2', quote: 'invented sentence about nothing' }],
          },
          { claim: '', source: 'dropped', evidence: [] },
        ],
        gaps: ['cost unknown', ' '],
        conflicts: [{ description: 'K1 and K2 disagree', refs: ['K1', 'K2', 'K7'] }],
      },
    });
    expect(content.findings.map((finding) => finding.support)).toEqual([
      'knowledge',
      'unverified',
      'unverified',
    ]);
    const evidence = content.findings[0]!.evidence;
    expect(evidence).toHaveLength(3); // the repeated K1 quote is one citation
    expect(evidence.map((item) => [item.ref, item.verified, item.problem])).toEqual([
      ['K1', true, null],
      ['K9', false, 'unknown_ref'],
      ['K2', false, 'quote_not_found'],
    ]);
    expect(evidence[0]).toMatchObject({ knowledgeId: 'k-a', versionId: 'v-a', title: 'Title a' });
    expect(content.gaps).toEqual(['cost unknown']);
    expect(content.conflicts).toEqual([{ description: 'K1 and K2 disagree', refs: ['K1', 'K2'] }]);
    expect(content.verification).toEqual({
      findings: 3,
      supported: 1,
      unverified: 2,
      citations: 4,
      verified: 1,
      rejected: 3,
    });
    expect(cited.map((item) => item.ref)).toEqual(['K1']);
    expect(content.knowledge.offered.map((item) => [item.ref, item.cited])).toEqual([
      ['K1', true],
      ['K2', false],
    ]);
    expect(content.knowledge.conflictWarnings).toEqual([{ conflictId: 'c1', refs: ['K2'] }]);
  });

  it('verifies Persian quotes against Persian passages', () => {
    const { content } = verifyResearch({
      ...base(),
      output: {
        findings: [
          {
            claim: 'لغو',
            source: 's',
            evidence: [{ ref: 'K2', quote: 'در ماه دو بار با پشتیبانی تماس می‌گیرند' }],
          },
        ],
        gaps: [],
        conflicts: [],
      },
    });
    expect(content.findings[0]!.support).toBe('knowledge');
  });

  it('cannot verify anything when the role may not use the verifier', () => {
    const { content, cited } = verifyResearch({
      ...base(),
      verifierTool: 'denied',
      output: {
        findings: [
          {
            claim: 'c',
            source: 's',
            evidence: [
              { ref: 'K1', quote: 'contact support twice in a month' },
              { ref: 'K5', quote: 'contact support twice in a month' },
            ],
          },
        ],
        gaps: [],
        conflicts: [],
      },
    });
    expect(content.findings[0]!.support).toBe('unverified');
    expect(content.findings[0]!.evidence.map((item) => item.problem)).toEqual([
      'verifier_not_allowed',
      'unknown_ref',
    ]);
    expect(cited).toEqual([]);
  });

  it('survives malformed model output and enforces the caps', () => {
    expect(verifyResearch({ ...base(), output: null }).content.findings).toEqual([]);
    expect(verifyResearch({ ...base(), output: 'text' }).content.verification.findings).toBe(0);
    const many = verifyResearch({
      ...base(),
      output: {
        findings: Array.from({ length: 100 }, (_, index) => ({
          claim: `claim ${index}`,
          source: 's',
          evidence: Array.from({ length: 9 }, (__, n) => ({ ref: 'K1', quote: `quote ${n}` })),
        })),
      },
    });
    expect(many.content.findings).toHaveLength(RESEARCH_LIMITS.maxFindings);
    expect(many.content.findings[0]!.evidence).toHaveLength(RESEARCH_LIMITS.maxEvidencePerFinding);
  });
});

describe('research output for later stages', () => {
  it('shows the claims with their support and the titles of verified evidence only', () => {
    const { content } = verifyResearch({
      passages: passages(),
      queries: [],
      snapshots: [],
      excludedRestricted: true,
      retrieveTool: 'allowed',
      verifierTool: 'allowed',
      output: {
        findings: [
          {
            claim: 'c',
            source: 's',
            evidence: [
              { ref: 'K1', quote: 'contact support twice in a month' },
              { ref: 'K2', quote: 'not in the passage at all' },
            ],
          },
        ],
        gaps: ['g'],
        conflicts: [],
      },
    });
    expect(compactResearchForPrompt(content)).toEqual({
      findings: [
        { claim: 'c', source: 's', support: 'knowledge', approvedKnowledge: ['Title a (v1)'] },
      ],
      gaps: ['g'],
    });
  });

  it('treats an older output without support as unverified and leaves other shapes alone', () => {
    expect(compactResearchForPrompt({ findings: [{ claim: 'c', source: 's' }], gaps: [] })).toEqual(
      { findings: [{ claim: 'c', source: 's', support: 'unverified' }], gaps: [] },
    );
    expect(compactResearchForPrompt('edited by hand')).toBe('edited by hand');
    expect(compactResearchForPrompt({ summary: 'x' })).toEqual({ summary: 'x' });
  });
});

describe('research prompt and schema', () => {
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

  it('adds the citation rules and the passages as data only when knowledge was found', () => {
    const items = knowledgePromptItems(passages());
    const prompt = stagePrompt({ ...context, knowledge: items });
    for (const rule of KNOWLEDGE_RULES) expect(prompt.instructions).toContain(rule);
    expect(prompt.instructions).not.toContain('Contact support');
    expect(JSON.parse(prompt.message.slice(6, -7)).approvedKnowledge).toHaveLength(2);
  });

  it('says so when no knowledge is available, and adds nothing to other stages', () => {
    const none = stagePrompt(context);
    for (const rule of NO_KNOWLEDGE_RULES) expect(none.instructions).toContain(rule);
    expect(none.message).not.toContain('approvedKnowledge');
    const ideation = stagePrompt({
      ...context,
      stage: 'ideation',
      definition: defaultDefinition('ideator'),
    });
    expect(ideation.instructions).not.toContain('approvedKnowledge');
    expect(ideation.instructions).not.toContain('No approved knowledge');
  });

  it('keeps the research schema closed and satisfied by the generic sampler', () => {
    const schema = STAGE_SCHEMAS.research;
    expect(schema['required']).toEqual(['findings', 'gaps', 'conflicts']);
    const sample = sampleForSchema(schema, 'research') as { findings: { evidence: unknown[] }[] };
    expect(sample.findings[0]!.evidence).toHaveLength(1);
  });
});

describe('fake researcher', () => {
  it('cites the first approved passage with a quote that verifies, and adds an unverified finding', () => {
    const items = knowledgePromptItems(passages());
    const prompt = stagePrompt({
      stage: 'research',
      definition: defaultDefinition('researcher'),
      language: 'en',
      projectTitle: 'Churn',
      problem: 'p',
      topics: [],
      previous: [],
      feedback: [],
      knowledge: items,
    });
    const answer = fakeResearchResponder({
      model: 'm',
      instructions: prompt.instructions,
      messages: [{ role: 'user', content: prompt.message }],
      responseSchema: { name: 'research_output', schema: STAGE_SCHEMAS.research },
    });
    const { content } = verifyResearch({
      output: answer,
      passages: passages(),
      queries: [],
      snapshots: [],
      excludedRestricted: true,
      retrieveTool: 'allowed',
      verifierTool: 'allowed',
    });
    expect(content.findings.map((finding) => finding.support)).toEqual(['knowledge', 'unverified']);
  });

  it('answers only research requests', () => {
    expect(
      fakeResearchResponder({
        model: 'm',
        messages: [{ role: 'user', content: '<data>{}</data>' }],
        responseSchema: { name: 'other', schema: {} },
      }),
    ).toBeNull();
  });
});
