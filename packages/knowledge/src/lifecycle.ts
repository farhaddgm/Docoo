import type { BrainDecision } from './brain.js';

/** KnowledgeVersion lifecycle of docs/02-domain/02-state-machines.md §5. */
export type KnowledgeStatus =
  | 'draft'
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'needs_revision'
  | 'expired'
  | 'superseded';

const TRANSITIONS: Readonly<Record<KnowledgeStatus, readonly KnowledgeStatus[]>> = {
  draft: ['pending', 'superseded'],
  pending: ['in_review', 'superseded'],
  in_review: ['approved', 'rejected', 'needs_revision', 'pending', 'superseded'],
  approved: ['expired', 'superseded', 'rejected'],
  rejected: ['approved', 'superseded'],
  needs_revision: ['approved', 'rejected', 'superseded'],
  expired: ['superseded'],
  superseded: [],
};

export function canTransition(from: KnowledgeStatus, to: KnowledgeStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export type OverrideDecision = 'approve' | 'reject';

export type EffectiveDecision =
  'pending' | BrainDecision | 'approved_by_override' | 'rejected_by_override';

export interface OverrideState {
  readonly decision: OverrideDecision;
  readonly expiresAt: string | null;
}

/**
 * The override never erases the Brain decision; the effective decision is computed next to
 * it, and an expired override no longer counts.
 */
export function effectiveDecision(
  brain: BrainDecision | null,
  override: OverrideState | null,
  now: Date,
): EffectiveDecision {
  if (override && (override.expiresAt === null || Date.parse(override.expiresAt) > now.getTime())) {
    return override.decision === 'approve' ? 'approved_by_override' : 'rejected_by_override';
  }
  return brain ?? 'pending';
}

export function statusForDecision(decision: EffectiveDecision): KnowledgeStatus {
  switch (decision) {
    case 'approved':
    case 'approved_by_override':
      return 'approved';
    case 'rejected':
    case 'rejected_by_override':
      return 'rejected';
    case 'needs_revision':
      return 'needs_revision';
    case 'pending':
      return 'pending';
  }
}

/** Minimum meaningful override reason (03-knowledge-and-brain §10). */
export const MIN_OVERRIDE_REASON_LENGTH = 20;

export function overrideReasonProblem(reason: string | undefined): string | null {
  const trimmed = (reason ?? '').trim();
  if (trimmed.length < MIN_OVERRIDE_REASON_LENGTH) {
    return `An override needs a reason of at least ${MIN_OVERRIDE_REASON_LENGTH} characters.`;
  }
  if (new Set(trimmed.replace(/\s/gu, '')).size < 5) {
    return 'An override reason must be meaningful, not a repeated character.';
  }
  return null;
}
