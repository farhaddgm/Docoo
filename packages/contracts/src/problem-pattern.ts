import { z } from 'zod';

const key = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/u);
const text = z.string().trim().min(1).max(4_000);
const list = z.array(text).min(1).max(20);

/** Execution guidance, distinct from the legacy candidate problem templates. */
export const problemPatternDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    key,
    title: text,
    purpose: text,
    applicability: list,
    inputs: z
      .array(z.object({ key, question: text, required: z.boolean() }).strict())
      .min(1)
      .max(30),
    stages: z
      .array(
        z
          .object({
            key,
            title: text,
            guidance: list,
            inputKeys: z.array(key).max(30),
            activity: z.enum(['clarify', 'analyze', 'research', 'rehearse', 'produce', 'reflect']),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    research: z
      .object({ mode: z.enum(['never', 'when-needed']), triggers: z.array(text).max(20) })
      .strict(),
    outputs: z
      .array(z.object({ key, title: text, sections: list }).strict())
      .min(1)
      .max(10),
    qualityCriteria: list,
    boundaries: list,
  })
  .strict()
  .superRefine((definition, context) => {
    for (const field of ['inputs', 'stages', 'outputs'] as const) {
      const keys = definition[field].map((item) => item.key);
      if (new Set(keys).size !== keys.length) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: 'Keys must be unique within each collection.',
        });
      }
    }
    const inputKeys = new Set(definition.inputs.map((input) => input.key));
    definition.stages.forEach((stage, index) => {
      if (
        new Set(stage.inputKeys).size !== stage.inputKeys.length ||
        stage.inputKeys.some((input) => !inputKeys.has(input))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['stages', index, 'inputKeys'],
          message: 'Input references must be unique and defined.',
        });
      }
    });
    if (
      definition.research.mode === 'never' &&
      definition.stages.some((stage) => stage.activity === 'research')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['research'],
        message: 'Research stages require conditional research permission.',
      });
    }
  });

/** Only explicitly published versions can become execution snapshots. */
export const problemPatternSnapshotSchema = z
  .object({
    patternId: z.uuid(),
    workspaceId: z.uuid(),
    version: z.number().int().positive(),
    lifecycle: z.literal('published'),
    publishedAt: z.iso.datetime({ offset: true }),
    definition: problemPatternDefinitionSchema,
  })
  .strict();

export const problemPatternDraftSchema = z
  .object({
    lifecycle: z.literal('draft'),
    revision: z.number().int().positive(),
    definition: problemPatternDefinitionSchema,
  })
  .strict();

export type ProblemPatternDefinition = z.infer<typeof problemPatternDefinitionSchema>;
export type ProblemPatternSnapshot = z.infer<typeof problemPatternSnapshotSchema>;

/** Null is the complete legacy path. Invalid selections never silently lose guidance. */
export function resolveProblemPatternSnapshot(
  snapshot: unknown,
  workspaceId: string,
): ProblemPatternSnapshot | null {
  if (snapshot === null || snapshot === undefined) return null;
  const parsed = problemPatternSnapshotSchema.parse(snapshot);
  if (parsed.workspaceId !== workspaceId) throw new Error('Problem pattern workspace mismatch.');
  return parsed;
}
