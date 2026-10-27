import { z } from 'zod';
const text = z.string().trim().max(4000);
export const meetingBriefSchema = z
  .object({
    goal: text,
    opening: text,
    points: z.array(text).max(3),
    hardPart: text,
    response: text,
    boundary: text,
  })
  .strict();
export const meetingContextSchema = z
  .object({
    counterpart: text,
    relationship: text,
    topic: text,
    goal: text,
    concerns: text,
    boundaries: text,
    flexibility: text,
  })
  .strict();
export const meetingStateSchema = z
  .object({
    context: meetingContextSchema,
    perspectives: z
      .array(
        z
          .object({ text: z.string().trim().min(1).max(2000), kind: z.literal('hypothesis') })
          .strict(),
      )
      .max(8),
    brief: meetingBriefSchema,
    practice: z.enum(['not_started', 'practicing', 'skipped']),
    reflection: z
      .object({ occurred: z.boolean(), outcome: text, surprises: text, nextTime: text })
      .strict(),
  })
  .strict()
  .refine(
    (state) =>
      state.reflection.occurred ||
      ![state.reflection.outcome, state.reflection.surprises, state.reflection.nextTime].some(
        Boolean,
      ),
    'Mark the meeting as occurred before reflecting.',
  )
  .refine(
    (state) => new TextEncoder().encode(JSON.stringify(state)).byteLength <= 99000,
    'Meeting state exceeds the storage budget.',
  );
export const meetingUpdateSchema = z
  .object({ expectedRevision: z.number().int().min(0), state: meetingStateSchema })
  .strict();
export const meetingRequestSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    mode: z.enum(['prepare', 'rehearse']),
    content: z.string().trim().min(1).max(4000),
    difficulty: z.enum(['supportive', 'hesitant', 'challenging']),
    providerConsent: z.literal(true),
    idempotencyKey: z.uuid(),
  })
  .strict();
export const meetingResponseSchema = z
  .object({
    context: meetingContextSchema.nullable(),
    answer: z.string().trim().min(1).max(8000),
    perspectives: z
      .array(
        z
          .object({ text: z.string().trim().min(1).max(2000), kind: z.literal('hypothesis') })
          .strict(),
      )
      .max(8),
    brief: meetingBriefSchema.nullable(),
    feedback: z
      .object({ strength: text, improvement: text, retrySuggestion: text })
      .strict()
      .nullable(),
  })
  .strict();
export type MeetingState = z.infer<typeof meetingStateSchema>;
export type MeetingResponse = z.infer<typeof meetingResponseSchema>;
export const emptyMeetingState = (): MeetingState => ({
  context: {
    counterpart: '',
    relationship: '',
    topic: '',
    goal: '',
    concerns: '',
    boundaries: '',
    flexibility: '',
  },
  perspectives: [],
  brief: { goal: '', opening: '', points: [], hardPart: '', response: '', boundary: '' },
  practice: 'not_started',
  reflection: { occurred: false, outcome: '', surprises: '', nextTime: '' },
});

/** A custom pattern can enable interaction preparation through its rehearsal activity. */
export function supportsMeetingPreparation(pattern: {
  key: string;
  stages: readonly { activity: string }[];
}): boolean {
  return pattern.key === 'meeting' || pattern.stages.some((stage) => stage.activity === 'rehearse');
}
