import { z } from 'zod';
import { adaptiveResearchOptionsSchema } from './decision-intelligence.js';

export const projectResearchWorkflowName = 'projectResearchWorkflow' as const;
export const projectResearchTaskQueue = 'docoo.research' as const;
export const projectResearchCitationLimit = 5 as const;
export const projectResearchKnowledgeSourceTypes = [
  'admin',
  'clue_research',
  'autonomous_research',
] as const;

export type ProjectResearchKnowledgeSourceType =
  (typeof projectResearchKnowledgeSourceTypes)[number];

const researchDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/u,
  );

export const projectResearchPlanSchema = z
  .object({
    version: z.literal(1),
    query: z.string().trim().min(2).max(500),
    language: z.enum(['fa', 'en']),
    knowledgeSourceTypes: z
      .array(z.enum(projectResearchKnowledgeSourceTypes))
      .min(1)
      .max(projectResearchKnowledgeSourceTypes.length)
      .default([...projectResearchKnowledgeSourceTypes])
      .refine((types) => new Set(types).size === types.length),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/u)
      .nullable(),
    timeRange: z
      .object({ from: z.iso.date().nullable(), to: z.iso.date().nullable() })
      .strict()
      .refine(({ from, to }) => from === null || to === null || from <= to),
    sourcePolicy: z
      .object({
        mode: z.enum(['unrestricted', 'whitelist', 'blacklist']),
        domains: z.array(researchDomainSchema).max(50),
      })
      .strict()
      .superRefine(({ mode, domains }, context) => {
        if (mode === 'unrestricted' && domains.length > 0) {
          context.addIssue({
            code: 'custom',
            path: ['domains'],
            message: 'Unrestricted source policy cannot include domains.',
          });
        }
        if (mode !== 'unrestricted' && domains.length === 0) {
          context.addIssue({
            code: 'custom',
            path: ['domains'],
            message: 'Allow and block policies need at least one domain.',
          });
        }
        if (new Set(domains).size !== domains.length) {
          context.addIssue({
            code: 'custom',
            path: ['domains'],
            message: 'Source domains must be unique.',
          });
        }
      }),
    targetCount: z.number().int().min(1).max(50),
    similarSampleCount: z.number().int().min(0).max(20),
    depth: z.enum(['shallow', 'standard', 'deep']),
    sourceLanguages: z
      .array(z.enum(['fa', 'en']))
      .min(1)
      .max(2)
      .optional()
      .refine((languages) => !languages || new Set(languages).size === languages.length),
    adaptive: adaptiveResearchOptionsSchema.optional(),
  })
  .strict()
  .refine(
    (plan) => new TextEncoder().encode(JSON.stringify(plan)).byteLength <= 16000,
    'Research plan exceeds its durable manifest budget.',
  );

export type ProjectResearchPlan = z.infer<typeof projectResearchPlanSchema>;

export interface ProjectResearchWorkflowInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workflowRunId: string;
}

export interface ProjectResearchWorkflowResult {
  readonly status: 'succeeded' | 'failed' | 'cancelled';
  readonly resultCount: number;
  readonly safeErrorCode: string | null;
}

export interface ProjectResearchCitationManifestItem {
  readonly claimId: string;
  readonly knowledgeVersionId: string;
  readonly sourceVersionId: string;
  readonly sourceQuoteHash: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface ProjectResearchManifestItem {
  readonly claimId: string;
  readonly knowledgeVersionId: string;
  readonly sourceVersionId: string;
  readonly claimHash: string;
  readonly sourceQuoteHash: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly auditScore: number;
  readonly matchScore: number;
  /** Added after v1 manifests were persisted; absent only on legacy workflow runs. */
  readonly citations?: readonly ProjectResearchCitationManifestItem[];
  /** Count of eligible citation sources omitted by the per-claim manifest bound. */
  readonly additionalCitationCount?: number;
}
