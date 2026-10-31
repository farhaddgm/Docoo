import type { Route } from 'next';

import type { Locale } from '../../i18n';

/** What the exploration screens know about the data and what they offer for it (ADR-0044). */

export type CandidateState = 'proposed' | 'parked' | 'dropped' | 'promoted';
export type CandidateDecision = 'proposed' | 'parked' | 'dropped';

export interface CandidateProject {
  id: string;
  code: string;
  title: string;
}

export interface Candidate {
  /** The projects made from this candidate that the person can see (ADR-0044 P2). */
  projects: CandidateProject[];
  candidateKey: string;
  versionNo: number;
  title: string;
  problemDraft: string;
  why: string;
  assumptions: string;
  expectedOutput: string;
  source: 'ai' | 'admin';
  state: CandidateState;
  reason: string;
  decidedAt: string | null;
  createdAt: string;
}

export interface ExplorationMessage {
  id: string;
  seq: number;
  role: 'admin' | 'agent';
  content: string;
  status: 'done' | 'failed';
  createdAt: string;
}

export interface ExplorationHead {
  id: string;
  title: string;
  eventText: string;
  status: 'open' | 'archived';
  outputLanguage: 'fa' | 'en';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExplorationDetail {
  exploration: ExplorationHead;
  messages: ExplorationMessage[];
  candidates: Candidate[];
  limits: {
    maxMessages: number;
    maxCandidates: number;
    usedMessages: number;
    usedCandidates: number;
    textMax: { title: number; eventText: number; message: number; reason: number };
  };
}

export interface ExplorationSummary {
  id: string;
  title: string;
  status: 'open' | 'archived';
  version: number;
  updatedAt: string;
  candidateCount: number;
  byState: Record<CandidateState, number>;
}

export type CandidateFilter = 'all' | CandidateState;

export const CANDIDATE_FILTERS: readonly CandidateFilter[] = [
  'all',
  'proposed',
  'parked',
  'dropped',
  'promoted',
];

/** How many candidates are in each state, and in total. */
export function countByState(candidates: readonly Pick<Candidate, 'state'>[]) {
  const counts: Record<CandidateFilter, number> = {
    all: candidates.length,
    proposed: 0,
    parked: 0,
    dropped: 0,
    promoted: 0,
  };
  for (const candidate of candidates) counts[candidate.state] += 1;
  return counts;
}

export function filterCandidates<T extends Pick<Candidate, 'state'>>(
  candidates: readonly T[],
  filter: CandidateFilter,
): T[] {
  return filter === 'all' ? [...candidates] : candidates.filter((item) => item.state === filter);
}

/**
 * The decisions offered for a candidate in a state. All of them are reversible; a candidate that
 * became a project is no longer decided here (the API refuses it too).
 */
export function offeredDecisions(state: CandidateState): CandidateDecision[] {
  switch (state) {
    case 'proposed':
      return ['parked', 'dropped'];
    case 'parked':
      return ['proposed', 'dropped'];
    case 'dropped':
      return ['proposed', 'parked'];
    case 'promoted':
      return [];
  }
}

export interface ComposerState {
  readonly canSend: boolean;
  /** Why sending is not possible, for the person to read; null when it is. */
  readonly blocked: 'archived' | 'limit' | 'read_only' | 'ai_off' | null;
}

/** Whether the next message can be sent, and if not why, so the screen says so instead of failing. */
export function composerState(input: {
  status: 'open' | 'archived';
  usedMessages: number;
  maxMessages: number;
  readOnly: boolean;
  aiEnabled: boolean;
}): ComposerState {
  const blocked = input.readOnly
    ? 'read_only'
    : input.status === 'archived'
      ? 'archived'
      : !input.aiEnabled
        ? 'ai_off'
        : input.usedMessages >= input.maxMessages
          ? 'limit'
          : null;
  return { canSend: blocked === null, blocked };
}

/** The same for asking the model to propose candidates. */
export function proposeState(input: {
  status: 'open' | 'archived';
  usedCandidates: number;
  maxCandidates: number;
  readOnly: boolean;
  aiEnabled: boolean;
}): ComposerState {
  const blocked = input.readOnly
    ? 'read_only'
    : input.status === 'archived'
      ? 'archived'
      : !input.aiEnabled
        ? 'ai_off'
        : input.usedCandidates >= input.maxCandidates
          ? 'limit'
          : null;
  return { canSend: blocked === null, blocked };
}

/**
 * Whether a project can be made from a candidate now: not read-only, allowed to create projects,
 * and the candidate not dropped (the API refuses a dropped one). A candidate that already gave a
 * project can give another.
 */
export function canMakeProject(input: {
  state: CandidateState;
  readOnly: boolean;
  mayCreateProjects: boolean;
}): boolean {
  return !input.readOnly && input.mayCreateProjects && input.state !== 'dropped';
}

/** The address of the new-project wizard filled from a candidate, as a route the links accept. */
export function newProjectHref(locale: Locale, explorationId: string, candidateKey: string): Route {
  const query = new URLSearchParams({ exploration: explorationId, candidate: candidateKey });
  return `/${locale}/projects/new?${query.toString()}` as Route;
}
