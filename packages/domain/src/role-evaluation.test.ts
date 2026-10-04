import { describe, expect, it } from 'vitest';

import { defaultDefinition } from './agents.js';
import {
  charterItems,
  EVALUATION_LIMITS,
  evaluationPromptData,
  normalizeEvaluation,
  ROLE_EVALUATION_SCHEMA,
  sampleContent,
  type EvaluationSample,
} from './role-evaluation.js';

const charter = charterItems(defaultDefinition('researcher'));
const samples: EvaluationSample[] = [
  {
    ref: 'S1',
    outputId: 'out-1',
    projectId: 'p1',
    createdAt: '2026-10-01T00:00:00.000Z',
    content: '{"findings":[]}',
    reviews: [{ action: 'reject', comment: 'no sources' }],
  },
  {
    ref: 'S2',
    outputId: 'out-2',
    projectId: 'p1',
    createdAt: '2026-10-02T00:00:00.000Z',
    content: '{"findings":[]}',
    reviews: [],
  },
];
const finding = (overrides: Record<string, unknown> = {}) => ({
  kind: 'deviation',
  severity: 'high',
  detail: 'The findings name no source.',
  recommendation: 'Require a source for every finding.',
  clauseRefs: ['P1'],
  sampleRefs: ['S1'],
  ...overrides,
});

describe('charter items', () => {
  it('numbers principles P1.. and duties D1.. in order', () => {
    const definition = defaultDefinition('researcher');
    expect(charter).toHaveLength(definition.principles.length + definition.duties.length);
    expect(charter[0]).toEqual({ ref: 'P1', kind: 'principle', text: definition.principles[0] });
    expect(charter.find((item) => item.ref === 'D1')).toMatchObject({
      kind: 'duty',
      text: definition.duties[0],
    });
  });
});

describe('samples and prompt data', () => {
  it('cuts long content and says so', () => {
    expect(sampleContent({ a: 1 })).toBe('{"a":1}');
    const long = sampleContent({ text: 'x'.repeat(10_000) });
    expect(long.length).toBeLessThan(EVALUATION_LIMITS.sampleChars + 20);
    expect(long.endsWith('…[truncated]')).toBe(true);
  });

  it('gives the judge refs and review text but no record ids', () => {
    const data = evaluationPromptData({
      role: 'researcher',
      stage: 'research',
      charter,
      samples,
      knownDeviations: [],
    });
    expect(JSON.stringify(data)).not.toContain('out-1');
    expect(JSON.stringify(data)).not.toContain('"p1"');
    expect(data.samples[0]).toMatchObject({
      ref: 'S1',
      reviews: [{ action: 'reject', comment: 'no sources' }],
    });
  });
});

describe('role evaluation contract', () => {
  it('requires every field of the answer in its closed schema', () => {
    expect(ROLE_EVALUATION_SCHEMA['required']).toEqual(['score', 'summary', 'findings']);
    expect(ROLE_EVALUATION_SCHEMA['additionalProperties']).toBe(false);
  });

  it('keeps a finding with valid evidence and resolves it to charter text and output ids', () => {
    const result = normalizeEvaluation(
      {
        score: 3,
        summary: 'Mixed.',
        findings: [finding({ clauseRefs: ['p1', 'D2'], sampleRefs: ['s1', 'S2'] })],
      },
      { charter, samples },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evaluation.score).toBe(3);
    expect(result.evaluation.discarded).toBe(0);
    const [first] = result.evaluation.findings;
    expect(first!.clauses.map((clause) => clause.ref)).toEqual(['P1', 'D2']);
    expect(first!.clauses[0]!.text).toBe(charter[0]!.text);
    expect(first!.evidence).toEqual([
      { type: 'stage_output', id: 'out-1', ref: 'S1' },
      { type: 'stage_output', id: 'out-2', ref: 'S2' },
    ]);
    expect(first!.severity).toBe('high');
  });

  it('discards findings without a known sample, without a known clause, empty, or repeated', () => {
    const result = normalizeEvaluation(
      {
        score: 2,
        summary: 'Weak.',
        findings: [
          finding({ sampleRefs: ['S9'] }),
          finding({ sampleRefs: [] }),
          finding({ clauseRefs: ['P99'] }),
          finding({ detail: '  ' }),
          finding({ kind: 'opinion' }),
          finding(),
          finding(),
        ],
      },
      { charter, samples },
    );
    expect(result.ok && result.evaluation.findings).toHaveLength(1);
    expect(result.ok && result.evaluation.discarded).toBe(6);
  });

  it('drops unknown references inside an otherwise valid finding', () => {
    const result = normalizeEvaluation(
      {
        score: 4,
        summary: 'Good.',
        findings: [finding({ sampleRefs: ['S1', 'S9'], clauseRefs: ['P1', 'X1'] })],
      },
      { charter, samples },
    );
    expect(result.ok && result.evaluation.findings[0]!.evidence).toHaveLength(1);
    expect(result.ok && result.evaluation.findings[0]!.clauses).toHaveLength(1);
  });

  it('gives a strength no severity and a deviation without a valid one the mildest', () => {
    const result = normalizeEvaluation(
      {
        score: 4,
        summary: 'Good.',
        findings: [
          finding({ kind: 'strength', severity: 'high', detail: 'Cites sources.' }),
          finding({ severity: 'catastrophic', detail: 'Other.' }),
        ],
      },
      { charter, samples },
    );
    expect(result.ok && result.evaluation.findings.map((item) => item.severity)).toEqual([
      'low',
      'low',
    ]);
  });

  it('caps the findings', () => {
    const many = Array.from({ length: 20 }, (_, index) => finding({ detail: `Finding ${index}` }));
    const result = normalizeEvaluation(
      { score: 3, summary: 's', findings: many },
      { charter, samples },
    );
    expect(result.ok && result.evaluation.findings).toHaveLength(EVALUATION_LIMITS.maxFindings);
    expect(result.ok && result.evaluation.discarded).toBe(20 - EVALUATION_LIMITS.maxFindings);
  });

  it.each([
    ['not an object', 'text'],
    ['null', null],
    ['no score', { summary: 's', findings: [] }],
    ['score out of range', { score: 6, summary: 's', findings: [] }],
    ['fractional score', { score: 3.5, summary: 's', findings: [] }],
    ['score as text', { score: '3', summary: 's', findings: [] }],
    ['no summary', { score: 3, summary: ' ', findings: [] }],
    ['no findings list', { score: 3, summary: 's' }],
  ])('rejects the whole answer when it is %s', (_label, answer) => {
    expect(normalizeEvaluation(answer, { charter, samples })).toEqual({
      ok: false,
      reason: 'invalid_output',
    });
  });

  it('accepts an answer with no findings (nothing to point at is a valid verdict)', () => {
    const result = normalizeEvaluation(
      { score: 5, summary: 'Fine.', findings: [] },
      { charter, samples },
    );
    expect(result.ok && result.evaluation.findings).toEqual([]);
  });
});
