import { expect, it } from 'vitest';
import {
  evaluationInvocationIntentSchema,
  evaluationInvocationReceiptSchema,
} from './evaluation-invocation.js';

const intent = {
  experimentId: 'experiment-1',
  experimentHash: 'a'.repeat(64),
  runId: 'baseline-1',
  caseId: 'CASE-1',
  modelSnapshotHash: 'b'.repeat(64),
  requestHash: 'c'.repeat(64),
};
const response = {
  provider: 'deterministic',
  modelId: 'fake-standard',
  output: '{}',
  inputTokens: 12,
  outputTokens: 5,
  costUsd: null,
};
const receipt = {
  invocationId: '11111111-1111-4111-8111-111111111111',
  observedProvider: 'deterministic',
  observedModelId: 'fake-standard',
  outputHash: 'd'.repeat(64),
  response,
  errorCode: null,
};

it('accepts only hash-bound intent metadata, never credentials or raw requests', () => {
  expect(evaluationInvocationIntentSchema.parse(intent)).toEqual(intent);
  for (const extra of [
    { apiKey: 'private' },
    { request: { instructions: 'private' } },
    { workspaceId: 'spoof' },
  ])
    expect(evaluationInvocationIntentSchema.safeParse({ ...intent, ...extra }).success).toBe(false);
});
it('separates returned results from safe observed failures and rejects estimated cost', () => {
  expect(evaluationInvocationReceiptSchema.parse(receipt)).toEqual(receipt);
  expect(
    evaluationInvocationReceiptSchema.safeParse({
      ...receipt,
      response: { ...response, costUsd: 0.01 },
    }).success,
  ).toBe(false);
  expect(
    evaluationInvocationReceiptSchema.safeParse({ ...receipt, observedModelId: 'other' }).success,
  ).toBe(false);
  expect(evaluationInvocationReceiptSchema.safeParse({ ...receipt, response: null }).success).toBe(
    false,
  );
  expect(
    evaluationInvocationReceiptSchema.parse({
      ...receipt,
      response: null,
      errorCode: 'invalid_response',
    }).response,
  ).toBeNull();
});
