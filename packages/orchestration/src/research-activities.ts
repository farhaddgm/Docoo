import type { PromptResearchQuestion } from '@docoo/domain';
import type { PoolClient } from 'pg';

import { retrieveKnowledge, type RetrievedPassage } from './knowledge-retrieval.js';
import {
  assignReferences,
  buildResearchQueries,
  verifyResearch,
  type KnowledgePassage,
  type ResearchContent,
  type WebRun,
} from './research.js';
import type { Settings } from './settings.js';
import { loadToolCalls, recordToolCall, toolDecision, type ToolCallScope } from './tool-calls.js';

/** The knowledge the research stage works with for one attempt. */
export interface ResearchRun {
  readonly passages: readonly KnowledgePassage[];
  readonly queries: readonly string[];
  readonly snapshots: readonly {
    readonly id: string;
    readonly query: string;
    readonly results: number;
  }[];
  readonly excludedRestricted: boolean;
  readonly retrieveTool: 'allowed' | 'denied';
  readonly verifierTool: 'allowed' | 'denied';
  /** The web side of the attempt; set by the activity after its search step (ADR-0026). */
  readonly web?: WebRun | undefined;
}

/**
 * Retrieves the approved knowledge of the research stage through the tool gate (FR-AGT-005).
 * The pinned definition must allow `knowledge_retrieve`; if it does not, a denied call is
 * recorded and the stage goes on without knowledge. A retry of the same attempt reuses the
 * snapshots of the first try, so the prompt (and its digest) stays the same.
 */
export async function prepareResearch(
  client: PoolClient,
  input: {
    readonly scope: ToolCallScope;
    readonly config: Settings;
    readonly projectTitle: string;
    readonly problem: string;
    readonly topics: readonly string[];
    /** The content of the approved analysis output. */
    readonly analysis: unknown;
    /** The confirmed research questions (ADR-0038); they replace the default queries. */
    readonly plan?: readonly PromptResearchQuestion[] | undefined;
  },
): Promise<ResearchRun> {
  const { scope, config } = input;
  const excludedRestricted = !config.researchAllowRestricted;
  const verifierTool = toolDecision(scope, 'citation_verifier');
  const earlier = await loadToolCalls(client, scope.attemptId!, 'knowledge_retrieve');

  if (earlier.length > 0) {
    const snapshotIds = earlier.flatMap((call) =>
      call.decision === 'allowed' && call.outputRef?.type === 'retrieval_snapshot'
        ? [call.outputRef.id]
        : [],
    );
    const rows = snapshotIds.length
      ? (
          await client.query<{ id: string; query: string; results: RetrievedPassage[] }>(
            'select id, query, results from retrieval_snapshots where id = any($1::uuid[]) order by created_at, id',
            [snapshotIds],
          )
        ).rows
      : [];
    return {
      passages: assignReferences(
        rows.map((row) => ({ snapshotId: row.id, results: row.results })),
        config.researchKnowledgeLimit,
        config.researchMaxSources,
      ),
      queries: rows.map((row) => row.query),
      snapshots: rows.map((row) => ({ id: row.id, query: row.query, results: row.results.length })),
      excludedRestricted,
      retrieveTool: earlier.some((call) => call.decision === 'allowed') ? 'allowed' : 'denied',
      verifierTool,
    };
  }

  const retrieveTool = toolDecision(scope, 'knowledge_retrieve');
  if (retrieveTool === 'denied') {
    await recordToolCall(client, scope, {
      tool: 'knowledge_retrieve',
      decision: 'denied',
      input: { reason: 'tool_not_allowed' },
      errorCode: 'tool_not_allowed',
    });
    return {
      passages: [],
      queries: [],
      snapshots: [],
      excludedRestricted,
      retrieveTool,
      verifierTool,
    };
  }
  if (config.researchKnowledgeLimit <= 0) {
    // The administrator switched knowledge off for research: nothing to retrieve, nothing to record.
    return {
      passages: [],
      queries: [],
      snapshots: [],
      excludedRestricted,
      retrieveTool,
      verifierTool,
    };
  }

  // The administrator's confirmed questions are the queries; without them the stage derives its
  // own from the problem statement as before.
  const planned = (input.plan ?? []).filter((question) => question.channel !== 'web');
  const queries =
    input.plan && input.plan.length > 0
      ? planned.map((question) => question.question)
      : buildResearchQueries({
          projectTitle: input.projectTitle,
          problem: input.problem,
          topics: input.topics,
          analysis: input.analysis,
          max: config.researchMaxQueries,
        });
  const retrievals: { snapshotId: string; results: RetrievedPassage[] }[] = [];
  const snapshots: { id: string; query: string; results: number }[] = [];
  const exclude = excludedRestricted ? ['restricted'] : [];
  for (const query of queries) {
    const started = Date.now();
    const retrieval = await retrieveKnowledge(client, {
      workspaceId: scope.workspaceId,
      actorId: null,
      query,
      projectId: scope.projectId,
      role: scope.role,
      limit: config.researchKnowledgeLimit,
      excludeConfidentiality: exclude,
      minAuditScore: config.knowledgeMinAuditScore,
    });
    await recordToolCall(client, scope, {
      tool: 'knowledge_retrieve',
      decision: 'allowed',
      input: {
        query,
        projectId: scope.projectId,
        role: scope.role,
        limit: config.researchKnowledgeLimit,
        excludeConfidentiality: exclude,
      },
      outputRef: { type: 'retrieval_snapshot', id: retrieval.snapshotId },
      result: {
        results: retrieval.results.length,
        knowledgeIds: [...new Set(retrieval.results.map((passage) => passage.knowledgeId))],
      },
      latencyMs: Date.now() - started,
    });
    retrievals.push({ snapshotId: retrieval.snapshotId, results: retrieval.results });
    snapshots.push({ id: retrieval.snapshotId, query, results: retrieval.results.length });
  }
  return {
    passages: assignReferences(
      retrievals,
      config.researchKnowledgeLimit,
      config.researchMaxSources,
    ),
    queries,
    snapshots,
    excludedRestricted,
    retrieveTool,
    verifierTool,
  };
}

/**
 * Verifies the citations of the model's research answer through the `citation_verifier` gate
 * and records the call. The returned content is what the stage stores (FR-AGT-005).
 */
export async function finishResearch(
  client: PoolClient,
  scope: ToolCallScope,
  run: ResearchRun,
  output: unknown,
  plan?: { readonly versionNo: number; readonly questions: readonly PromptResearchQuestion[] },
): Promise<ResearchContent> {
  const started = Date.now();
  const { content, cited } = verifyResearch({ output, ...run, plan });
  await recordToolCall(client, scope, {
    tool: 'citation_verifier',
    decision: run.verifierTool,
    input: output,
    result:
      run.verifierTool === 'allowed'
        ? {
            ...content.verification,
            cited: cited.map((passage) => ({
              ref: passage.ref,
              knowledgeId: passage.knowledgeId,
              versionId: passage.versionId,
            })),
          }
        : {},
    latencyMs: Date.now() - started,
    errorCode: run.verifierTool === 'denied' ? 'tool_not_allowed' : null,
  });
  return content;
}
