import { PROJECT_CODE_PATTERN } from '../project-fields';

/** The four steps of the creation wizard (ADR-0035). */
export const WIZARD_STEPS = ['problem', 'context', 'advanced', 'review'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export const STEP_COUNT = WIZARD_STEPS.length;
export const PROBLEM_STEP = 0;
export const CONTEXT_STEP = 1;
export const ADVANCED_STEP = 2;
export const REVIEW_STEP = 3;

/** Steps the project cannot be created without; the advanced step keeps inherited values. */
export const REQUIRED_STEPS: readonly number[] = [PROBLEM_STEP, CONTEXT_STEP, REVIEW_STEP];

/** The collapsible sections of the advanced step, with the settings each one offers. */
export const ADVANCED_SECTIONS = [
  {
    id: 'workflow',
    keys: [
      'workflow.require_human_approval',
      'workflow.max_attempts_per_stage',
      'ai.max_cost_usd_per_run',
    ],
  },
  { id: 'model', keys: [] },
  {
    id: 'research',
    keys: [
      'research.max_queries',
      'research.knowledge_limit',
      'research.max_sources',
      'knowledge.min_audit_score',
    ],
  },
  { id: 'solutions', keys: ['solution.count'] },
  {
    id: 'documents',
    keys: ['document.level', 'document.default_template', 'document.default_export_format'],
  },
] as const;
export type AdvancedSection = (typeof ADVANCED_SECTIONS)[number]['id'];

/**
 * Where a step of the earlier eight-step wizard (draft version 1) lives now: basics, topics,
 * then the five optional steps in one, then the review.
 */
export function migrateDraftStep(oldStep: number): number {
  if (oldStep <= 0) return PROBLEM_STEP;
  if (oldStep === 1) return CONTEXT_STEP;
  if (oldStep <= 6) return ADVANCED_STEP;
  return REVIEW_STEP;
}

const MAX_CODE_SUGGESTION = 24;

/**
 * A project code to start from. The Latin letters and digits of the title joined by "-" (upper
 * case, at most 24 characters); a title with none (Persian, say) gets `PRJ-` and a short stamp so
 * the code is never empty. The result always fits the pattern the API accepts.
 */
export function suggestProjectCode(title: string, now: number = Date.now()): string {
  const words = title.match(/[a-zA-Z0-9]+/gu) ?? [];
  const joined = words.join('-').toUpperCase().slice(0, MAX_CODE_SUGGESTION).replace(/-+$/u, '');
  const code = joined || `PRJ-${now.toString(36).slice(-5).toUpperCase()}`;
  return PROJECT_CODE_PATTERN.test(code) ? code : `PRJ-${now.toString(36).slice(-5).toUpperCase()}`;
}

/** The title is empty: there is nothing to suggest a code from yet. */
export function shouldSuggestCode(title: string): boolean {
  return title.trim() !== '';
}

/**
 * Which steps may be entered. Going back is always allowed; going forward stops at the first
 * required step that is not complete, so a required step is never skipped.
 */
export function reachableSteps(complete: { problem: boolean; context: boolean }): number {
  if (!complete.problem) return PROBLEM_STEP;
  if (!complete.context) return CONTEXT_STEP;
  return REVIEW_STEP;
}

/** How many settings an advanced section changes from their inherited values. */
export function changedInSection(
  section: AdvancedSection,
  changedKeys: ReadonlySet<string>,
  extra: { modelChanged: boolean; criteriaChanged: boolean },
): number {
  const entry = ADVANCED_SECTIONS.find((item) => item.id === section);
  if (!entry) return 0;
  let count = entry.keys.filter((key) => changedKeys.has(key)).length;
  if (section === 'model' && extra.modelChanged) count += 1;
  if (section === 'solutions' && extra.criteriaChanged) count += 1;
  return count;
}

// ---------------------------------------------------------------- from a candidate problem

/** A candidate problem of an exploration the project is being made from (ADR-0044 P2). */
export interface CandidateSeed {
  readonly explorationId: string;
  readonly candidateKey: string;
  readonly explorationTitle: string;
  readonly candidateTitle: string;
  readonly title: string;
  readonly initialProblem: string;
  readonly expectedOutput: string;
  readonly outputLanguage: 'fa' | 'en';
}

/** The candidate a saved draft was started from, if any. */
export interface DraftSource {
  readonly explorationId: string;
  readonly candidateKey: string;
}

/**
 * Whether the wizard starts fresh from the candidate. A draft already started from the same
 * candidate comes back with what the person has typed since; any other draft (none, a plain one,
 * one from another candidate) is left aside, so nothing of it leaks into the new project.
 */
export function shouldApplySeed(
  draftSource: DraftSource | null | undefined,
  seed: Pick<CandidateSeed, 'explorationId' | 'candidateKey'>,
): boolean {
  return !(
    draftSource &&
    draftSource.explorationId === seed.explorationId &&
    draftSource.candidateKey === seed.candidateKey
  );
}

/** The fields of the first step a candidate fills in. Nothing else of the draft is touched. */
export function seedFields(seed: CandidateSeed) {
  return {
    title: seed.title.trim(),
    initialProblem: seed.initialProblem.trim(),
    expectedOutput: seed.expectedOutput.trim(),
    outputLanguage: seed.outputLanguage,
  };
}

/**
 * Builds the seed from the exploration the page loaded, or null when the candidate cannot be
 * used: it is not there, or it was dropped (the API refuses a project from a dropped one).
 */
export function candidateSeed(
  detail: {
    exploration: { id: string; title: string; outputLanguage: 'fa' | 'en' };
    candidates: readonly {
      candidateKey: string;
      title: string;
      problemDraft: string;
      expectedOutput: string;
      state: string;
    }[];
  },
  candidateKey: string,
): { seed: CandidateSeed | null; reason: 'missing' | 'dropped' | null } {
  const candidate = detail.candidates.find((item) => item.candidateKey === candidateKey);
  if (!candidate) return { seed: null, reason: 'missing' };
  if (candidate.state === 'dropped') return { seed: null, reason: 'dropped' };
  return {
    seed: {
      explorationId: detail.exploration.id,
      candidateKey: candidate.candidateKey,
      explorationTitle: detail.exploration.title,
      candidateTitle: candidate.title,
      title: candidate.title,
      initialProblem: candidate.problemDraft,
      expectedOutput: candidate.expectedOutput,
      outputLanguage: detail.exploration.outputLanguage,
    },
    reason: null,
  };
}
