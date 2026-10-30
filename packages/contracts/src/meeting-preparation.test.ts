import { describe, expect, it } from 'vitest';
import {
  emptyMeetingState,
  meetingRequestSchema,
  meetingStateSchema,
  supportsMeetingPreparation,
} from './meeting-preparation.js';
import {
  meetingProblemPattern,
  marketingExperimentProblemPattern,
} from './problem-pattern-examples.js';
describe('meeting preparation', () => {
  it('supports optional practice and empty preparation without fabricating information', () => {
    const state = emptyMeetingState();
    state.practice = 'skipped';
    expect(meetingStateSchema.parse(state)).toEqual(state);
  });
  it('requires the meeting to have occurred before saving a reflection', () => {
    const state = emptyMeetingState();
    state.reflection.outcome = 'It went well';
    expect(meetingStateSchema.safeParse(state).success).toBe(false);
    state.reflection.occurred = true;
    expect(meetingStateSchema.safeParse(state).success).toBe(true);
  });
  it('labels counterpart perspectives as hypotheses and limits the brief to three points', () => {
    expect(
      meetingStateSchema.safeParse({
        ...emptyMeetingState(),
        perspectives: [{ kind: 'fact', text: 'They will agree' }],
      }).success,
    ).toBe(false);
    const state = emptyMeetingState();
    state.brief.points = ['a', 'b', 'c', 'd'];
    expect(meetingStateSchema.safeParse(state).success).toBe(false);
  });
  it('validates the UTF-8 storage budget before persistence', () => {
    const state = emptyMeetingState();
    const long = 'ا'.repeat(4000);
    state.context = {
      counterpart: long,
      relationship: long,
      topic: long,
      goal: long,
      concerns: long,
      boundaries: long,
      flexibility: long,
    };
    state.brief = {
      goal: long,
      opening: long,
      hardPart: long,
      response: long,
      boundary: long,
      points: [long, long, long],
    };
    expect(meetingStateSchema.safeParse(state).success).toBe(false);
  });
  it('requires explicit provider consent and accepts custom rehearsal patterns', () => {
    expect(
      meetingRequestSchema.safeParse({ mode: 'prepare', content: 'Help', expectedRevision: 1 })
        .success,
    ).toBe(false);
    expect(supportsMeetingPreparation(meetingProblemPattern)).toBe(true);
    expect(supportsMeetingPreparation({ ...meetingProblemPattern, key: 'custom-interview' })).toBe(
      true,
    );
    expect(supportsMeetingPreparation(marketingExperimentProblemPattern)).toBe(false);
  });
});
