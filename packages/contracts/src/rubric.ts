import { z } from 'zod';

export const rubricStageSchema = z.enum([
  'analysis',
  'research',
  'ideation',
  'documentation',
  'evaluation',
]);

export type RubricStage = z.infer<typeof rubricStageSchema>;

export interface RubricCriterion {
  readonly key: string;
  readonly label: string;
  readonly weight: number;
  /** Stage a failing criterion goes back to by default. */
  readonly targetStage: RubricStage;
}

export interface Rubric {
  readonly criteria: readonly RubricCriterion[];
  readonly passThreshold: number;
  /** Criteria that must each reach this score regardless of the overall. */
  readonly minimums: Readonly<Record<string, number>>;
}

export interface RubricValidationInput {
  readonly criteria: readonly Pick<RubricCriterion, 'key' | 'weight'>[];
  readonly passThreshold: number;
  readonly minimums: Readonly<Record<string, number>>;
}

/** Return the first semantic validation problem shared by API and evaluator paths. */
export function rubricProblem(rubric: RubricValidationInput): string | null {
  const total = rubric.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (total !== 100) return `rubric weights must add up to 100 (now ${total})`;
  if (rubric.passThreshold < 0 || rubric.passThreshold > 100) return 'pass threshold must be 0-100';
  for (const key of Object.keys(rubric.minimums)) {
    if (!rubric.criteria.some((criterion) => criterion.key === key))
      return `minimum for unknown criterion ${key}`;
  }
  return null;
}

/**
 * Build the common rubric contract with a caller-selected label shape. Problem templates use
 * localized labels, while the existing project evaluation API uses a single display label.
 */
export function createRubricSchema<TLabel extends z.ZodType>(
  labelSchema: TLabel,
  options: {
    minCriteria?: number;
    maxCriteria?: number;
    minWeight?: number;
    integerThreshold?: boolean;
    integerMinimums?: boolean;
    validateSemantics?: boolean;
  } = {},
) {
  const criteria = z
    .array(
      z
        .object({
          key: z.string().trim().min(1).max(64),
          label: labelSchema,
          weight: z
            .number()
            .int()
            .min(options.minWeight ?? 0)
            .max(100),
          targetStage: rubricStageSchema,
        })
        .strict(),
    )
    .min(options.minCriteria ?? 1)
    .max(options.maxCriteria ?? 30);

  const threshold = options.integerThreshold
    ? z.number().int().min(1).max(100)
    : z.number().min(0).max(100);
  const minimum = options.integerMinimums
    ? z.number().int().min(0).max(100)
    : z.number().min(0).max(100);

  const schema = z
    .object({
      criteria,
      passThreshold: threshold,
      minimums: z.record(z.string(), minimum),
    })
    .strict();

  return options.validateSemantics
    ? schema.superRefine((rubric, context) => {
        const problem = rubricProblem(rubric);
        if (problem) {
          context.addIssue({ code: 'custom', path: [], message: problem });
        }
        const keys = rubric.criteria.map(({ key }) => key);
        if (new Set(keys).size !== keys.length) {
          context.addIssue({
            code: 'custom',
            path: ['criteria'],
            message: 'Rubric criterion keys must be unique.',
          });
        }
      })
    : schema;
}

export const projectRubricSchema = createRubricSchema(z.string().trim().min(1).max(200));
