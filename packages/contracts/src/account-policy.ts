import { z } from 'zod';

import type { AccountRole } from './account.js';

/**
 * Per-account settings the owner sets on top of the role (ADR-0042). The role says how much an
 * account can ever do (editor: change, viewer: look); the policy narrows it: which sections it
 * reaches, whether it may create projects or topics, how much AI it may spend, and until when.
 * The owner and other super administrators ignore it.
 */
export const policySections = [
  'knowledge',
  'business',
  'agents',
  'workflow',
  'documents',
  'topics',
  'audit',
] as const;
export type PolicySection = (typeof policySections)[number];

export const sectionLevels = ['none', 'view', 'edit'] as const;
export type SectionLevel = (typeof sectionLevels)[number];

export interface AiLimits {
  /** When false the account can read everything it may see but starts nothing that calls a model. */
  enabled: boolean;
  /** Input plus output tokens per calendar month (UTC); null: no limit. */
  monthlyTokens: number | null;
  /** Spend per calendar month (UTC) in US dollars; null: no limit. */
  monthlyCostUsd: number | null;
  /** Model calls per day (UTC); null: no limit. */
  dailyCalls: number | null;
}

export interface AccountPolicy {
  canCreateProjects: boolean;
  canCreateTopics: boolean;
  /** Projects the account may have created at once; null: no limit. */
  maxProjects: number | null;
  /** Only the sections that differ from the role's default are stored. */
  sections: Partial<Record<PolicySection, SectionLevel>>;
  canUploadFiles: boolean;
  ai: AiLimits;
  /** The account stops working at this moment (ISO); null: never. */
  expiresAt: string | null;
  note: string;
}

export const policyLimits = {
  maxTokens: 10_000_000_000,
  maxCostUsd: 1_000_000,
  maxDailyCalls: 1_000_000,
  maxProjects: 10_000,
  noteMax: 500,
} as const;

/** What an account that has no policy row can do: the owner has to switch creation on. */
export const defaultPolicy = (): AccountPolicy => ({
  canCreateProjects: false,
  canCreateTopics: false,
  maxProjects: null,
  sections: {},
  canUploadFiles: true,
  ai: { enabled: true, monthlyTokens: null, monthlyCostUsd: null, dailyCalls: null },
  expiresAt: null,
  note: '',
});

const count = (max: number) => z.number().int().min(0).max(max).nullable();

export const accountPolicySchema = z
  .object({
    canCreateProjects: z.boolean(),
    canCreateTopics: z.boolean(),
    maxProjects: z.number().int().min(1).max(policyLimits.maxProjects).nullable(),
    sections: z
      .object(
        Object.fromEntries(policySections.map((key) => [key, z.enum(sectionLevels).optional()])),
      )
      .strict(),
    canUploadFiles: z.boolean(),
    ai: z
      .object({
        enabled: z.boolean(),
        monthlyTokens: count(policyLimits.maxTokens),
        monthlyCostUsd: z.number().min(0).max(policyLimits.maxCostUsd).nullable(),
        dailyCalls: count(policyLimits.maxDailyCalls),
      })
      .strict(),
    expiresAt: z.iso.datetime().nullable(),
    note: z.string().trim().max(policyLimits.noteMax),
  })
  .strict() as unknown as z.ZodType<AccountPolicy>;

/** The level a role gives a section when the policy says nothing: editors change, viewers look. */
export const roleSectionLevel = (role: AccountRole): SectionLevel =>
  role === 'viewer' ? 'view' : 'edit';

const rank: Record<SectionLevel, number> = { none: 0, view: 1, edit: 2 };

/** What an account can really do: the policy cut down to what the role allows. */
export interface EffectiveAccess {
  /** The owner and administrators: no policy applies. */
  unrestricted: boolean;
  canCreateProjects: boolean;
  canCreateTopics: boolean;
  maxProjects: number | null;
  sections: Record<PolicySection, SectionLevel>;
  canUploadFiles: boolean;
  ai: AiLimits;
}

export function resolveAccess(
  role: AccountRole,
  policy: AccountPolicy | null | undefined,
): EffectiveAccess {
  const own = policy ?? defaultPolicy();
  const ceiling = roleSectionLevel(role);
  const sections = Object.fromEntries(
    policySections.map((key) => {
      const wanted = own.sections[key] ?? ceiling;
      return [key, rank[wanted] > rank[ceiling] ? ceiling : wanted];
    }),
  ) as Record<PolicySection, SectionLevel>;
  if (role === 'super_admin') {
    return {
      unrestricted: true,
      canCreateProjects: true,
      canCreateTopics: true,
      maxProjects: null,
      sections: Object.fromEntries(policySections.map((key) => [key, 'edit'])) as Record<
        PolicySection,
        SectionLevel
      >,
      canUploadFiles: true,
      ai: { enabled: true, monthlyTokens: null, monthlyCostUsd: null, dailyCalls: null },
    };
  }
  const editor = role === 'editor';
  return {
    unrestricted: false,
    canCreateProjects: editor && own.canCreateProjects,
    canCreateTopics: editor && own.canCreateTopics,
    maxProjects: own.maxProjects,
    sections,
    // A viewer cannot add sources whatever the policy says: it never changes anything.
    canUploadFiles: editor && own.canUploadFiles,
    ai: editor ? own.ai : { ...own.ai, enabled: false },
  };
}

/** The permission prefixes each controllable section covers. */
const SECTION_PREFIXES: readonly (readonly [PolicySection, RegExp])[] = [
  ['knowledge', /^knowledge\./],
  ['business', /^business\./],
  ['agents', /^agent_definition\./],
  ['workflow', /^(workflow\.|analysis\.|project\.(run|pause|resume)$)/],
  ['documents', /^document\./],
  ['topics', /^topic\./],
  ['audit', /^audit\./],
];

export function sectionOfPermission(permission: string): PolicySection | null {
  return SECTION_PREFIXES.find(([, pattern]) => pattern.test(permission))?.[0] ?? null;
}

/** Whether an account with this access may use a permission, before any resource grant. */
export function sectionAllows(access: EffectiveAccess, permission: string, read: boolean): boolean {
  const section = sectionOfPermission(permission);
  if (!section) return true;
  const level = access.sections[section];
  return level === 'edit' || (level === 'view' && read);
}

/** What an account has used, to set against its limits. */
export interface AiUsage {
  monthTokens: number;
  monthCostUsd: number;
  todayCalls: number;
}

export type AiBlock = 'disabled' | 'tokens' | 'cost' | 'calls';

/** Why the account may not start another model call, or null when it may. */
export function aiBlock(ai: AiLimits, usage: AiUsage): AiBlock | null {
  if (!ai.enabled) return 'disabled';
  if (ai.monthlyTokens !== null && usage.monthTokens >= ai.monthlyTokens) return 'tokens';
  if (ai.monthlyCostUsd !== null && usage.monthCostUsd >= ai.monthlyCostUsd) return 'cost';
  if (ai.dailyCalls !== null && usage.todayCalls >= ai.dailyCalls) return 'calls';
  return null;
}
