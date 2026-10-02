import { tokenize } from './normalize.js';

export interface ConflictClaim {
  readonly id: string;
  readonly text: string;
}

export type ConflictType = 'numeric_mismatch' | 'negation';

export interface DetectedConflict {
  readonly claimAId: string;
  readonly claimBId: string;
  readonly conflictType: ConflictType;
  readonly severity: 'low' | 'medium' | 'high';
  readonly analysis: string;
}

const NEGATIONS = new Set([
  'not',
  'no',
  'never',
  'cannot',
  'isn',
  'doesn',
  'don',
  'won',
  'نیست',
  'نمی',
  'نه',
  'هرگز',
  'ندارد',
  'نمیشود',
  'نخواهد',
  'نبود',
  'نکرد',
]);

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'in',
  'on',
  'and',
  'is',
  'are',
  'was',
  'to',
  'for',
  'by',
  'with',
  'از',
  'به',
  'در',
  'و',
  'که',
  'را',
  'این',
  'با',
  'است',
  'برای',
]);

interface Profile {
  readonly words: Set<string>;
  readonly numbers: string[];
  readonly negated: boolean;
}

function profile(text: string): Profile {
  const tokens = tokenize(text);
  const words = new Set<string>();
  const numbers: string[] = [];
  let negated = false;
  for (const token of tokens) {
    if (/^\d+$/u.test(token)) {
      numbers.push(token);
    } else if (NEGATIONS.has(token)) {
      negated = true;
    } else if (token.startsWith('نمی') && token.length > 4) {
      // Negated present tense written without a zero-width non-joiner, e.g. «نمیشود».
      negated = true;
      words.add(token.slice(3));
    } else if (!STOP_WORDS.has(token)) {
      words.add(token.startsWith('می') && token.length > 3 ? token.slice(2) : token);
    }
  }
  return { words, numbers, negated };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Similarity of the non-numeric wording above which two claims talk about the same thing. */
export const SAME_SUBJECT_THRESHOLD = 0.6;

/**
 * Deterministic conflict detection (KNO-005): two claims about the same subject that state
 * different numbers, or where exactly one is negated. Both claims stay; the conflict is
 * recorded and surfaced to every retrieval consumer.
 */
export function detectConflicts(
  incoming: readonly ConflictClaim[],
  existing: readonly ConflictClaim[],
): DetectedConflict[] {
  const conflicts: DetectedConflict[] = [];
  const seen = new Set<string>();
  const existingProfiles = existing.map((claim) => ({ claim, profile: profile(claim.text) }));
  for (const claim of incoming) {
    const a = profile(claim.text);
    for (const other of existingProfiles) {
      if (other.claim.id === claim.id) continue;
      const similarity = jaccard(a.words, other.profile.words);
      if (similarity < SAME_SUBJECT_THRESHOLD) continue;
      const [claimAId, claimBId] =
        claim.id < other.claim.id ? [claim.id, other.claim.id] : [other.claim.id, claim.id];
      const key = `${claimAId}:${claimBId}`;
      if (seen.has(key)) continue;
      const numbersDiffer =
        a.numbers.length > 0 &&
        other.profile.numbers.length > 0 &&
        a.numbers.join(',') !== other.profile.numbers.join(',');
      if (numbersDiffer) {
        seen.add(key);
        conflicts.push({
          claimAId,
          claimBId,
          conflictType: 'numeric_mismatch',
          severity: 'high',
          analysis: `Same subject (similarity ${similarity.toFixed(2)}) with different figures: ${a.numbers.join(', ')} vs ${other.profile.numbers.join(', ')}.`,
        });
      } else if (a.negated !== other.profile.negated) {
        seen.add(key);
        conflicts.push({
          claimAId,
          claimBId,
          conflictType: 'negation',
          severity: 'medium',
          analysis: `Same subject (similarity ${similarity.toFixed(2)}) where only one claim is negated.`,
        });
      }
    }
  }
  return conflicts;
}
