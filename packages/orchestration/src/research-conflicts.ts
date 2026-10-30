import {
  conflictFingerprint,
  type ConflictDecision,
  type PromptConflictDecision,
  type SourceClass,
} from '@docoo/domain';
import type { PoolClient } from 'pg';

/** A source a conflict names, with what the reader needs to recognise it. */
export interface ConflictSource {
  readonly ref: string;
  readonly title: string;
  readonly url: string | null;
  readonly kind: SourceClass;
}

export interface ResearchConflictView {
  readonly fingerprint: string;
  readonly description: string;
  readonly sources: readonly ConflictSource[];
}

export interface StoredConflictDecision {
  readonly fingerprint: string;
  readonly decision: ConflictDecision;
  readonly trustedRef: string | null;
  readonly note: string;
  readonly decidedBy: string;
  readonly createdAt: string;
}

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');
const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === 'object' && !Array.isArray(item),
      )
    : [];

/** What the stored output says about one reference: a knowledge item or a web page. */
export function describeRef(content: unknown, ref: string): ConflictSource {
  const raw =
    content !== null && typeof content === 'object' ? (content as Record<string, unknown>) : {};
  const knowledge = raw['knowledge'] as Record<string, unknown> | undefined;
  const web = raw['web'] as Record<string, unknown> | undefined;
  const item = records(knowledge?.['offered']).find((entry) => entry['ref'] === ref);
  if (item) {
    return { ref, title: asText(item['title']), url: null, kind: 'knowledge' };
  }
  const page = records(web?.['sources']).find((entry) => entry['ref'] === ref);
  if (page) {
    return {
      ref,
      title: asText(page['title']),
      url: asText(page['url']) || null,
      kind: page['sourceClass'] === 'official' ? 'official' : 'public',
    };
  }
  return { ref, title: '', url: null, kind: ref.startsWith('W') ? 'public' : 'knowledge' };
}

/** The conflicts of a stored research output with their fingerprints and the sources they name. */
export function researchConflicts(content: unknown): ResearchConflictView[] {
  const raw =
    content !== null && typeof content === 'object' ? (content as Record<string, unknown>) : {};
  return records(raw['conflicts']).flatMap((entry) => {
    const description = asText(entry['description']);
    if (description === '') return [];
    const refs = Array.isArray(entry['refs'])
      ? entry['refs'].filter((ref): ref is string => typeof ref === 'string')
      : [];
    return [
      {
        fingerprint: conflictFingerprint(description, refs),
        description,
        sources: refs.map((ref) => describeRef(content, ref)),
      },
    ];
  });
}

/** The newest decision of each conflict of a stage run. */
export async function latestConflictDecisions(
  client: PoolClient,
  stageRunId: string,
): Promise<Map<string, StoredConflictDecision>> {
  const rows = (
    await client.query<StoredConflictDecision>(
      `select distinct on (fingerprint) fingerprint, decision, trusted_ref as "trustedRef", note,
              decided_by as "decidedBy",
              to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"
         from research_conflict_decisions where stage_run_id = $1
        order by fingerprint, created_at desc, id desc`,
      [stageRunId],
    )
  ).rows;
  return new Map(rows.map((row) => [row.fingerprint, row]));
}

/**
 * What the stages after the research are told: the decisions on conflicts that are still in the
 * output (a conflict the output no longer reports needs no decision).
 */
export async function promptConflictDecisions(
  client: PoolClient,
  stageRunId: string,
  content: unknown,
): Promise<PromptConflictDecision[]> {
  const conflicts = researchConflicts(content);
  if (conflicts.length === 0) return [];
  const decisions = await latestConflictDecisions(client, stageRunId);
  return conflicts.flatMap((conflict) => {
    const decided = decisions.get(conflict.fingerprint);
    if (!decided) return [];
    const trusted = decided.trustedRef
      ? conflict.sources.find((source) => source.ref === decided.trustedRef)
      : undefined;
    return [
      {
        conflict: conflict.description,
        decision: decided.decision,
        ...(trusted
          ? {
              trustedSource: `${decided.trustedRef}${trusted.title ? ` — ${trusted.title}` : ''}${trusted.url ? ` (${trusted.url})` : ''}`,
            }
          : {}),
        ...(decided.note ? { note: decided.note } : {}),
      },
    ];
  });
}
