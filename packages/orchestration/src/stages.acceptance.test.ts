import {
  composeInstructions,
  defaultDefinition,
  charterItems,
  evaluationPromptData,
  normalizeEvaluation,
  ROLE_EVALUATION_RULES,
  ROLE_EVALUATION_SCHEMA,
  ROLE_EVALUATION_SCHEMA_NAME,
  type EvaluationSample,
} from '@docoo/domain';
import { createAdapter, type ProviderKind } from '@docoo/providers';
import { describe, expect, it } from 'vitest';

import { assignReferences, knowledgePromptItems, verifyResearch } from './research.js';
import { STAGE_SCHEMAS, stagePrompt, STAGES } from './stages.js';
import { STAGE_ROLE } from '@docoo/domain';

/**
 * The platform's own structured outputs against the real provider APIs (AI-002..004, ADR-0017):
 * the five stage outputs, with approved knowledge in the research prompt, and the Brain's role
 * evaluation. Each provider runs only when its key is present (the Provider acceptance workflow
 * passes the repository secrets); without keys everything here is skipped. The model comes from
 * <PROVIDER>_MODEL or the first live catalog model with structured output.
 */
const providers: {
  kind: Exclude<ProviderKind, 'fake'>;
  key: string | undefined;
  model: string | undefined;
}[] = [
  { kind: 'openai', key: process.env['OPENAI_API_KEY'], model: process.env['OPENAI_MODEL'] },
  { kind: 'gemini', key: process.env['GEMINI_API_KEY'], model: process.env['GEMINI_MODEL'] },
  {
    kind: 'anthropic',
    key: process.env['ANTHROPIC_API_KEY'],
    model: process.env['ANTHROPIC_MODEL'],
  },
];

const passage = (text: string) =>
  assignReferences(
    [
      {
        snapshotId: 'acceptance',
        results: [
          {
            chunkId: 'c1',
            knowledgeId: 'k1',
            versionId: 'v1',
            versionNo: 1,
            title: 'Support response and churn',
            confidentiality: 'internal',
            chunkOrdinal: 0,
            text,
            score: 0.05,
            lexicalRank: 1,
            vectorRank: 1,
            similarity: 0.6,
            reviewId: 'r1',
            auditScore: 92,
            effectiveDecision: 'approved',
            conflictWarnings: [],
          },
        ],
      },
    ],
    5,
  );

const KNOWLEDGE_TEXT =
  'Repeat customer churn falls when support answers within one hour, because customers who wait leave.';

for (const provider of providers) {
  describe.skipIf(!provider.key)(`${provider.kind}: platform schemas`, () => {
    const adapter = () => createAdapter(provider.kind, { apiKey: provider.key ?? '' });
    async function model(): Promise<string> {
      const models = await adapter().listModels();
      const chosen =
        provider.model ?? models.find((item) => item.capabilities.structuredOutput)?.id;
      expect(
        chosen,
        'set <PROVIDER>_MODEL or use a key with a structured-output model',
      ).toBeTruthy();
      return chosen!;
    }

    for (const stage of STAGES) {
      it(`returns the ${stage} stage output in its schema`, async () => {
        const role = STAGE_ROLE[stage];
        const knowledge =
          stage === 'research' ? knowledgePromptItems(passage(KNOWLEDGE_TEXT)) : undefined;
        const prompt = stagePrompt({
          stage: stage,
          definition: defaultDefinition(role),
          language: 'en',
          projectTitle: 'Churn programme',
          problem: 'Reduce repeat-customer churn by 20% within a year.',
          topics: ['Retail'],
          previous: [],
          feedback: [],
          knowledge,
        });
        const response = await adapter().invoke({
          model: await model(),
          instructions: prompt.instructions,
          messages: [{ role: 'user', content: prompt.message }],
          responseSchema: { name: `${stage}_output`, schema: STAGE_SCHEMAS[stage] },
          maxOutputTokens: 6000,
        });
        expect(response.finishReason).toBe('stop');
        const json = response.json as Record<string, unknown>;
        expect(json).toBeTruthy();
        for (const key of STAGE_SCHEMAS[stage]['required'] as string[])
          expect(json).toHaveProperty(key);
        if (stage === 'research') {
          const { content } = verifyResearch({
            output: json,
            passages: passage(KNOWLEDGE_TEXT),
            queries: [],
            snapshots: [],
            excludedRestricted: true,
            retrieveTool: 'allowed',
            verifierTool: 'allowed',
          });
          // Whether the model quoted the passage verbatim is a quality signal, not a pass/fail.
          console.log(
            `${provider.kind} research: ${content.verification.supported}/${content.verification.findings} findings supported, ${content.verification.verified}/${content.verification.citations} citations verified`,
          );
        }
      }, 180_000);
    }

    it('returns a Brain role evaluation that satisfies the evidence contract', async () => {
      const definition = defaultDefinition('researcher');
      const charter = charterItems(definition);
      const samples: EvaluationSample[] = [
        {
          ref: 'S1',
          outputId: 'o1',
          projectId: 'p1',
          createdAt: '2026-10-01T00:00:00.000Z',
          content: JSON.stringify({
            findings: [{ claim: 'Churn is a problem.', source: 'general knowledge', evidence: [] }],
            gaps: [],
            conflicts: [],
          }),
          reviews: [{ action: 'reject', comment: 'No sources were cited.' }],
        },
      ];
      const instructions = composeInstructions({
        role: 'brain',
        content: defaultDefinition('brain'),
        language: 'en',
        task: defaultDefinition('brain').promptTemplate,
        rules: ROLE_EVALUATION_RULES,
      });
      const data = evaluationPromptData({
        role: 'researcher',
        stage: 'research',
        charter,
        samples,
        knownDeviations: [],
      });
      const response = await adapter().invoke({
        model: await model(),
        instructions,
        messages: [{ role: 'user', content: `<data>${JSON.stringify(data)}</data>` }],
        responseSchema: { name: ROLE_EVALUATION_SCHEMA_NAME, schema: ROLE_EVALUATION_SCHEMA },
        maxOutputTokens: 6000,
      });
      expect(response.finishReason).toBe('stop');
      const result = normalizeEvaluation(response.json, { charter, samples });
      expect(result.ok, JSON.stringify(response.json)).toBe(true);
      if (result.ok) {
        console.log(
          `${provider.kind} evaluation: score ${result.evaluation.score}, ${result.evaluation.findings.length} findings kept, ${result.evaluation.discarded} discarded`,
        );
      }
    }, 180_000);
  });
}

describe('without provider keys', () => {
  it('has the platform schemas to send (nothing to call)', () => {
    expect(Object.keys(STAGE_SCHEMAS)).toHaveLength(STAGES.length);
  });
});
