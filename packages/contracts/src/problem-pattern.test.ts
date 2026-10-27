import { describe, expect, it } from 'vitest';
import {
  meetingProblemPattern,
  marketingExperimentProblemPattern,
} from './problem-pattern-examples.js';
import {
  problemPatternDefinitionSchema,
  resolveProblemPatternSnapshot,
} from './problem-pattern.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const snapshot = () => ({
  patternId: '00000000-0000-4000-8000-000000000002',
  workspaceId,
  version: 1,
  lifecycle: 'published',
  publishedAt: '2026-10-26T10:00:00Z',
  definition: structuredClone(meetingProblemPattern),
});

describe('optional execution patterns', () => {
  it('keeps absent patterns on the legacy path', () => {
    expect(resolveProblemPatternSnapshot(null, workspaceId)).toBeNull();
    expect(resolveProblemPatternSnapshot(undefined, workspaceId)).toBeNull();
  });
  it('validates both distinct example processes', () => {
    expect(problemPatternDefinitionSchema.safeParse(meetingProblemPattern).success).toBe(true);
    expect(
      problemPatternDefinitionSchema.safeParse(marketingExperimentProblemPattern).success,
    ).toBe(true);
  });
  it('rejects drafts, cross-workspace selections and malformed snapshots', () => {
    expect(() =>
      resolveProblemPatternSnapshot({ ...snapshot(), lifecycle: 'draft' }, workspaceId),
    ).toThrow();
    expect(() => resolveProblemPatternSnapshot(snapshot(), 'another-workspace')).toThrow();
    expect(() => resolveProblemPatternSnapshot({}, workspaceId)).toThrow();
  });
  it('detaches the selected definition from subsequent catalog mutations', () => {
    const source = snapshot();
    const selected = resolveProblemPatternSnapshot(source, workspaceId)!;
    source.definition.title = 'Changed later';
    expect(selected.definition.title).toBe('جلسه');
    expect(selected.version).toBe(1);
  });
  it('rejects duplicate keys and dangling input references', () => {
    const duplicate = structuredClone(meetingProblemPattern);
    duplicate.inputs.push(duplicate.inputs[0]!);
    expect(problemPatternDefinitionSchema.safeParse(duplicate).success).toBe(false);
    const dangling = structuredClone(meetingProblemPattern);
    dangling.stages[0]!.inputKeys = ['missing'];
    expect(problemPatternDefinitionSchema.safeParse(dangling).success).toBe(false);
  });
  it('rejects contradictory research policy and unsupported schema versions', () => {
    expect(
      problemPatternDefinitionSchema.safeParse({
        ...marketingExperimentProblemPattern,
        research: { mode: 'never', triggers: [] },
      }).success,
    ).toBe(false);
    expect(
      problemPatternDefinitionSchema.safeParse({ ...meetingProblemPattern, schemaVersion: 2 })
        .success,
    ).toBe(false);
  });
});
