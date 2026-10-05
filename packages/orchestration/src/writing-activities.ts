import { createHash } from 'node:crypto';

import {
  applyOutline,
  assembleDocument,
  checkCompliance,
  countBlocks,
  countDocument,
  DEFAULT_CRITERIA,
  DEFAULT_LEVEL_BOUNDS,
  DOCUMENT_TEMPLATES,
  draftToBlocks,
  fitAdjustments,
  fitStatus,
  OUTLINE_SCHEMA,
  OUTLINE_SCHEMA_NAME,
  planWriting,
  scoreChartBlock,
  scoreSolution,
  scoreTableBlock,
  SECTION_SCHEMA,
  SECTION_SCHEMA_NAME,
  subsectionVerdict,
  WRITING_VERSION,
  type Block,
  type Criterion,
  type Level,
  type StructuredDocument,
  type WritingPlan,
  type WritingReport,
} from '@docoo/documents';
import { type AgentDefinitionContent } from '@docoo/domain';
import {
  checkCostLimit,
  ProviderError,
  retryDelaySeconds,
  type JsonSchema,
} from '@docoo/providers';
import type { Pool, PoolClient } from 'pg';

import { loadAgentVersion, resolveAgentProfile } from './agents.js';
import { audit, inWorkspace } from './db.js';
import { canonicalJson, retrieveKnowledge, type RetrievedPassage } from './knowledge-retrieval.js';
import { compactResearchForPrompt, assignReferences, type KnowledgePassage } from './research.js';
import type { ProviderRuntime } from './runtime.js';
import {
  loadWritingToolCalls,
  recordToolCall,
  toolDecision,
  type ToolCallScope,
} from './tool-calls.js';
import {
  buildWritingQueries,
  CitationRegistry,
  citedReferences,
  EMPTY_CITATION_STATE,
  outlinePrompt,
  promptSha256,
  sectionPrompt,
  writingSettingsFromRow,
  type CitationState,
  type WritingMaterial,
  type WritingSettings,
} from './writing.js';

/** What the writing workflow passes to every activity. */
export interface WritingRef {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly writingId: string;
}

export type WritingBlockReason = 'provider_failure' | 'configuration' | 'cost_limit' | 'tool';

/** Every step answers with its result or with what the workflow must do about it. */
export type WritingStep<T extends object = Record<never, never>> =
  | ({ readonly status: 'ok' } & T)
  | { readonly status: 'retry'; readonly code: string; readonly delaySeconds: number }
  | { readonly status: 'blocked'; readonly code: string; readonly reason: WritingBlockReason }
  | { readonly status: 'failed'; readonly code: string };

export interface WritingActivities {
  writingStart(ref: WritingRef): Promise<{ finished: boolean }>;
  writingPrepare(ref: WritingRef): Promise<WritingStep<{ subsectionIds: readonly string[] }>>;
  writingOutline(
    ref: WritingRef & { retryNo: number },
  ): Promise<WritingStep<{ subsectionIds: readonly string[] }>>;
  writingWrite(
    ref: WritingRef & { subsectionId: string; retryNo: number },
  ): Promise<WritingStep<{ letters: number }>>;
  writingFit(
    ref: WritingRef & { round: number; retryNo: number },
  ): Promise<WritingStep<{ done: boolean; count: number }>>;
  writingFinish(
    ref: WritingRef,
  ): Promise<WritingStep<{ versionId: string; withinBounds: boolean }>>;
  writingBlock(ref: WritingRef & { code: string; reason: string }): Promise<void>;
  writingResume(ref: WritingRef): Promise<void>;
  writingCancel(ref: WritingRef & { reason: string | null }): Promise<void>;
  writingFail(ref: WritingRef & { code: string }): Promise<void>;
}

/** The plan as stored: the plan itself plus what the steps note down about the run. */
type StoredPlan = WritingPlan & {
  outlined?: boolean;
  notes?: string[];
  tablesAllowed?: boolean;
};

interface Part {
  readonly blocks: readonly Block[];
  readonly letters: number;
  readonly tries: number;
  readonly fitRound: number;
  readonly discarded: number;
}

interface WritingRow {
  id: string;
  workspace_id: string;
  project_id: string;
  document_id: string;
  status: string;
  phase: string;
  level: number;
  template_version: string;
  language: 'fa' | 'en';
  notes: string | null;
  settings: unknown;
  base_version_id: string | null;
  agent_definition_version_id: string | null;
  plan: StoredPlan | null;
  parts: Record<string, Part>;
  bibliography: Partial<CitationState>;
  document_title: string;
  document_status: string;
  solution_id: string | null;
  current_version_id: string | null;
}

const LIVE = ['queued', 'running', 'paused'];

function modelFor(definition: AgentDefinitionContent, settings: WritingSettings) {
  return {
    connectionId: definition.modelPolicy?.connectionId ?? settings.connectionId,
    model: definition.modelPolicy?.model ?? settings.model,
  };
}

const sha = (value: string): string => createHash('sha256').update(value).digest('hex');

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const textList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(text).filter((item) => item !== '') : [];

function citationState(row: WritingRow): CitationState {
  const stored = row.bibliography;
  return {
    references: Array.isArray(stored.references) ? stored.references : [],
    stats: stored.stats ?? EMPTY_CITATION_STATE.stats,
  };
}

/**
 * Temporal activities of the document writer (ADR-0019). Each is idempotent: the plan, the
 * subsections written so far and the citations live on the writing row, so a repeated call after
 * a worker crash finds its work done and returns the same result.
 */
export function createWritingActivities(
  pool: Pool,
  runtime: ProviderRuntime,
  options: { delayScale?: number } = {},
): WritingActivities {
  const delayScale = options.delayScale ?? 1;
  const run = <T>(workspaceId: string, work: (client: PoolClient) => Promise<T>) =>
    inWorkspace(pool, { workspaceId }, work);

  async function load(client: PoolClient, ref: WritingRef, lock = false): Promise<WritingRow> {
    const row = (
      await client.query<WritingRow>(
        `select w.id, w.workspace_id, w.project_id, w.document_id, w.status, w.phase, w.level, w.template_version,
                w.language::text as language, w.notes, w.settings, w.base_version_id, w.agent_definition_version_id,
                w.plan, w.parts, w.bibliography, d.title as document_title, d.status::text as document_status,
                d.solution_id, d.current_version_id
           from document_writings w join documents d on d.id = w.document_id
          where w.id = $1 ${lock ? 'for update of w' : ''}`,
        [ref.writingId],
      )
    ).rows[0];
    if (!row) throw new Error('The writing does not exist.');
    return row;
  }

  /** The material a writing works from, read as the documenter's `project_documents_read`. */
  async function loadMaterial(
    client: PoolClient,
    row: WritingRow,
    knowledge: readonly KnowledgePassage[],
  ): Promise<{
    material: WritingMaterial;
    score: ReturnType<typeof scoreSolution> | null;
    solutionTitle: string;
    solutionSummary: string;
    solutionPlan: string[];
    problem: Record<string, unknown>;
  } | null> {
    const project = (
      await client.query<{
        title: string;
        initial_problem: string;
        approved: string | null;
      }>(
        'select title, initial_problem, approved_problem_version_id as approved from projects where id = $1',
        [row.project_id],
      )
    ).rows[0];
    if (!project || !row.solution_id) return null;
    const solution = (
      await client.query<{
        title: string;
        summary: string;
        assumptions: string[];
        evidence: string[];
        plan: string[];
        risks: string[];
        score_inputs: Record<string, number>;
      }>(
        'select title, summary, assumptions, evidence, plan, risks, score_inputs from solutions where id = $1',
        [row.solution_id],
      )
    ).rows[0];
    if (!solution) return null;

    const approved = project.approved
      ? (
          await client.query<{ content: Record<string, unknown> }>(
            'select content from stage_outputs where id = $1',
            [project.approved],
          )
        ).rows[0]?.content
      : undefined;
    const problem: Record<string, unknown> = approved
      ? {
          problemStatement: text(approved['problemStatement']),
          needStatement: text(approved['needStatement']),
          objectives: textList(approved['objectives']),
          constraints: textList(approved['constraints']),
          successCriteria: textList(approved['successCriteria']),
          assumptions: textList(approved['assumptions']),
          unresolved: textList(approved['unresolved']),
          recommendedScope: text(approved['recommendedScope']),
          outOfScope: textList(approved['outOfScope']),
        }
      : { problemStatement: project.initial_problem };

    const criteria =
      (
        await client.query<{ criteria: Criterion[] }>(
          'select criteria from solution_criteria_versions where project_id = $1 order by version_no desc limit 1',
          [row.project_id],
        )
      ).rows[0]?.criteria ?? DEFAULT_CRITERIA;
    const score = scoreSolution(solution.score_inputs, criteria);

    const research = (
      await client.query<{ content: unknown }>(
        `select o.content from stage_runs s join stage_outputs o on o.id = s.latest_output_id
          where s.project_id = $1 and s.stage = 'research' and s.status = 'completed'
          order by s.created_at desc limit 1`,
        [row.project_id],
      )
    ).rows[0]?.content;
    const compact = compactResearchForPrompt(research) as { findings?: unknown } | null;
    const findings = Array.isArray(compact?.findings)
      ? (compact.findings as Record<string, unknown>[])
          .slice(0, 12)
          .map((item) => ({ claim: text(item['claim']), support: text(item['support']) }))
          .filter((item) => item.claim !== '')
      : [];

    const outline = (
      await client.query<{ content: { outline?: unknown } }>(
        `select o.content from stage_runs s join stage_outputs o on o.id = s.latest_output_id
          where s.project_id = $1 and s.stage = 'documentation' and s.status = 'completed'
          order by s.created_at desc limit 1`,
        [row.project_id],
      )
    ).rows[0]?.content?.outline;
    const stageOutline = Array.isArray(outline)
      ? (outline as Record<string, unknown>[])
          .map((item) => ({ heading: text(item['heading']), summary: text(item['summary']) }))
          .filter((item) => item.heading !== '')
          .slice(0, 20)
      : [];

    const material: WritingMaterial = {
      project: project.title,
      language: row.language,
      problem,
      solution: {
        title: solution.title,
        summary: solution.summary,
        assumptions: solution.assumptions,
        evidence: solution.evidence,
        plan: solution.plan,
        risks: solution.risks,
        score: {
          total: score.total,
          criteria: score.criteria.map((item) => ({
            criterion: item.label,
            score: `${item.raw}/${item.max}`,
            weight: item.weight,
            contribution: item.weighted,
          })),
        },
      },
      research: findings,
      stageOutline,
      notes: row.notes,
      knowledge,
    };
    return {
      material,
      score,
      solutionTitle: solution.title,
      solutionSummary: solution.summary,
      solutionPlan: solution.plan,
      problem,
    };
  }

  /** The approved passages of the writing, rebuilt from the snapshots its retrievals pinned. */
  async function loadPassages(
    client: PoolClient,
    row: WritingRow,
    settings: WritingSettings,
  ): Promise<KnowledgePassage[]> {
    const calls = await loadWritingToolCalls(client, row.id, 'knowledge_retrieve');
    const ids = calls.flatMap((call) =>
      call.decision === 'allowed' && call.outputRef?.type === 'retrieval_snapshot'
        ? [call.outputRef.id]
        : [],
    );
    if (ids.length === 0) return [];
    const rows = (
      await client.query<{ id: string; results: RetrievedPassage[] }>(
        'select id, results from retrieval_snapshots where id = any($1::uuid[]) order by created_at, id',
        [ids],
      )
    ).rows;
    return assignReferences(
      rows.map((item) => ({ snapshotId: item.id, results: item.results })),
      settings.knowledgeLimit,
    );
  }

  function toolScope(
    row: WritingRow,
    definition: AgentDefinitionContent & { id: string },
  ): ToolCallScope {
    return {
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      stageRunId: null,
      attemptId: null,
      writingId: row.id,
      role: 'documenter',
      agentDefinitionVersionId: definition.id,
      allowed: definition.tools,
    };
  }

  async function definitionOf(client: PoolClient, row: WritingRow) {
    if (row.agent_definition_version_id) {
      const pinned = await loadAgentVersion(
        client,
        row.workspace_id,
        row.agent_definition_version_id,
      );
      if (pinned) return pinned;
    }
    return (
      await resolveAgentProfile(client, {
        workspaceId: row.workspace_id,
        projectId: row.project_id,
        role: 'documenter',
      })
    ).definition;
  }

  const spent = async (client: PoolClient, writingId: string): Promise<number> =>
    (
      await client.query<{ total: number | null }>(
        'select sum(cost_usd)::real as total from model_invocations where writing_id = $1',
        [writingId],
      )
    ).rows[0]?.total ?? 0;

  /** The score table and chart the code builds itself (never the model). */
  function builtBlocks(
    plan: WritingPlan,
    score: ReturnType<typeof scoreSolution> | null,
    language: 'fa' | 'en',
    tablesAllowed: boolean,
  ): Record<string, Block[]> {
    const built: Record<string, Block[]> = {};
    if (!score || !tablesAllowed) return built;
    for (const section of plan.sections) {
      if (section.source === 'scores') {
        built[section.key] = [
          scoreTableBlock(score, language, `${section.key}-table`),
          scoreChartBlock(score, language, `${section.key}-chart`),
        ];
      }
    }
    return built;
  }

  function wholeDocument(
    row: WritingRow,
    plan: WritingPlan,
    parts: Record<string, Part>,
    score: ReturnType<typeof scoreSolution> | null,
    tablesAllowed: boolean,
  ): StructuredDocument {
    const written = Object.fromEntries(
      plan.sections.flatMap((section) =>
        section.subsections.map((sub) => [sub.id, parts[sub.id]?.blocks ?? []] as const),
      ),
    );
    const built = builtBlocks(plan, score, row.language, tablesAllowed);
    const flat = plan.sections.flatMap((section) => [
      ...(built[section.key] ?? []),
      ...section.subsections.flatMap((sub) => written[sub.id] ?? []),
    ]);
    return assembleDocument({
      title: row.document_title,
      language: row.language,
      plan,
      written,
      built,
      references: citedReferences(flat, citationState(row).references, row.language),
    });
  }

  /** What every model-calling step needs before it calls. */
  async function prepareCall(ref: WritingRef) {
    return run(ref.workspaceId, async (client) => {
      const row = await load(client, ref);
      if (!LIVE.includes(row.status)) return { stop: 'finished' as const };
      const settings = writingSettingsFromRow(row.settings);
      const definition = await definitionOf(client, row);
      const { connectionId, model } = modelFor(definition, settings);
      if (!connectionId || !model) return { stop: 'blocked' as const, code: 'ai_not_configured' };
      const cost = checkCostLimit(await spent(client, row.id), settings.costLimitUsd);
      if (cost.status === 'exceeded') return { stop: 'cost' as const };
      const scope = toolScope(row, definition);
      const passages = await loadPassages(client, row, settings);
      const loaded = await loadMaterial(client, row, passages);
      if (!loaded) return { stop: 'failed' as const, code: 'writing_material_missing' };
      return {
        stop: null,
        row,
        settings,
        definition,
        connectionId,
        model,
        scope,
        passages,
        loaded,
        tablesAllowed: toolDecision(scope, 'table_chart_spec') === 'allowed',
        verifierAllowed: toolDecision(scope, 'citation_verifier') === 'allowed',
      } as const;
    });
  }

  type Prepared = Exclude<Awaited<ReturnType<typeof prepareCall>>, { stop: string }>;
  const stopped = (
    prepared: Awaited<ReturnType<typeof prepareCall>>,
  ): WritingStep<never> | null => {
    if (prepared.stop === null) return null;
    if (prepared.stop === 'finished') return { status: 'failed', code: 'writing_finished' };
    if (prepared.stop === 'blocked')
      return { status: 'blocked', code: prepared.code, reason: 'configuration' };
    if (prepared.stop === 'cost')
      return { status: 'blocked', code: 'cost_limit_exceeded', reason: 'cost_limit' };
    return { status: 'failed', code: prepared.code };
  };

  async function invoke(
    prepared: Prepared,
    call: string,
    prompt: { instructions: string; message: string },
    schema: { name: string; schema: JsonSchema },
    maxOutputTokens: number,
    retryNo: number,
    key: string,
  ): Promise<unknown> {
    const { response } = await runtime.invoke(
      {
        workspaceId: prepared.row.workspace_id,
        projectId: prepared.row.project_id,
        stageRunId: null,
        attemptId: null,
        writingId: prepared.row.id,
        purpose: `document_writing:${call}`,
        retryNo,
        agentDefinitionVersionId: prepared.definition.id,
        promptSha256: promptSha256(prompt),
      },
      prepared.connectionId,
      {
        model: prepared.model,
        instructions: prompt.instructions,
        messages: [{ role: 'user', content: prompt.message }],
        responseSchema: schema,
        maxOutputTokens,
        idempotencyKey: `${prepared.row.id}:${key}:${retryNo}`,
      },
    );
    if (response.finishReason !== 'stop' || response.json === null) {
      throw new ProviderError('invalid_output', `output_${response.finishReason}`);
    }
    return response.json;
  }

  const tokensFor = (letters: number): number => Math.min(16000, Math.ceil(letters * 1.1) + 1500);

  function failedStep(error: unknown, retryNo: number): WritingStep<never> {
    const providerError =
      error instanceof ProviderError
        ? error
        : new ProviderError('transient', 'writing_step_failed');
    const delay = retryDelaySeconds(retryNo + 1, providerError);
    return delay === null
      ? { status: 'blocked', code: providerError.code, reason: 'provider_failure' }
      : { status: 'retry', code: providerError.code, delaySeconds: delay * delayScale };
  }

  const setPhase = (client: PoolClient, id: string, phase: string) =>
    client.query(
      `update document_writings set phase = $2 where id = $1 and status in ('queued', 'running', 'paused')`,
      [id, phase],
    );

  return {
    async writingStart(ref) {
      return run(ref.workspaceId, async (client) => {
        const row = await load(client, ref, true);
        if (!LIVE.includes(row.status)) return { finished: true };
        if (row.status === 'queued') {
          await client.query(
            `update document_writings set status = 'running', started_at = coalesce(started_at, now()) where id = $1`,
            [ref.writingId],
          );
          await audit(client, ref.workspaceId, {
            action: 'document.writing_started',
            targetType: 'document',
            targetId: ref.documentId,
            projectId: ref.projectId,
            after: { writingId: ref.writingId, level: row.level, template: row.template_version },
          });
        }
        return { finished: false };
      });
    },

    async writingPrepare(ref) {
      return run(
        ref.workspaceId,
        async (client): Promise<WritingStep<{ subsectionIds: readonly string[] }>> => {
          const row = await load(client, ref, true);
          if (!LIVE.includes(row.status)) return { status: 'failed', code: 'writing_finished' };
          if (row.plan) {
            return {
              status: 'ok',
              subsectionIds: row.plan.sections.flatMap((section) =>
                section.subsections.map((sub) => sub.id),
              ),
            };
          }
          const settings = writingSettingsFromRow(row.settings);
          const definition = await definitionOf(client, row);
          const scope = toolScope(row, definition);
          // Everything the writer knows about the project is read through `project_documents_read`.
          if (toolDecision(scope, 'project_documents_read') === 'denied') {
            await recordToolCall(client, scope, {
              tool: 'project_documents_read',
              decision: 'denied',
              input: { documentId: row.document_id },
              errorCode: 'tool_not_allowed',
            });
            return {
              status: 'blocked',
              code: 'tool_not_allowed:project_documents_read',
              reason: 'tool',
            };
          }
          const material = await loadMaterial(client, row, []);
          if (!material) return { status: 'failed', code: 'writing_material_missing' };
          const readAt = Date.now();
          await recordToolCall(client, scope, {
            tool: 'project_documents_read',
            decision: 'allowed',
            input: { documentId: row.document_id, solutionId: row.solution_id },
            outputRef: { type: 'document', id: row.document_id },
            result: {
              solution: true,
              problemDefinition: Boolean(
                (material.problem['objectives'] as unknown[] | undefined)?.length,
              ),
              researchFindings: material.material.research.length,
              stageOutline: material.material.stageOutline.length,
            },
            latencyMs: Date.now() - readAt,
          });

          // Knowledge goes through its own gate; denied or switched off, the writing goes on without.
          const notes: string[] = [];
          if (settings.knowledgeLimit > 0) {
            if (toolDecision(scope, 'knowledge_retrieve') === 'denied') {
              await recordToolCall(client, scope, {
                tool: 'knowledge_retrieve',
                decision: 'denied',
                input: { reason: 'tool_not_allowed' },
                errorCode: 'tool_not_allowed',
              });
              notes.push('knowledge_retrieve_denied');
            } else {
              const queries = buildWritingQueries({
                solution: {
                  title: material.solutionTitle,
                  summary: material.solutionSummary,
                  plan: material.solutionPlan,
                },
                problem: material.problem,
              });
              const exclude = settings.allowRestricted ? [] : ['restricted'];
              for (const query of queries) {
                const started = Date.now();
                const retrieval = await retrieveKnowledge(client, {
                  workspaceId: row.workspace_id,
                  actorId: null,
                  query,
                  projectId: row.project_id,
                  role: 'documenter',
                  limit: settings.knowledgeLimit,
                  excludeConfidentiality: exclude,
                });
                await recordToolCall(client, scope, {
                  tool: 'knowledge_retrieve',
                  decision: 'allowed',
                  input: {
                    query,
                    projectId: row.project_id,
                    role: 'documenter',
                    limit: settings.knowledgeLimit,
                    excludeConfidentiality: exclude,
                  },
                  outputRef: { type: 'retrieval_snapshot', id: retrieval.snapshotId },
                  result: {
                    results: retrieval.results.length,
                    knowledgeIds: [
                      ...new Set(retrieval.results.map((passage) => passage.knowledgeId)),
                    ],
                  },
                  latencyMs: Date.now() - started,
                });
              }
            }
          } else {
            notes.push('knowledge_off');
          }

          const tablesAllowed = toolDecision(scope, 'table_chart_spec') === 'allowed';
          const template =
            Object.values(DOCUMENT_TEMPLATES).find(
              (item) => item.version === row.template_version,
            ) ?? DOCUMENT_TEMPLATES.standard;
          const level = row.level as Level;
          const levelBounds = settingsBounds(row.settings, level) ?? DEFAULT_LEVEL_BOUNDS[level];
          // What the code writes itself (title, headings, the score blocks and an estimate of the
          // references) is taken off the budget before the model's share is divided.
          const skeleton: Block[] = template.sections.flatMap((section) => [
            {
              type: 'heading' as const,
              id: section.key,
              level: 1 as const,
              text: section.label[row.language],
            },
          ]);
          const planned0 = planWriting({
            template,
            language: row.language,
            level,
            bounds: levelBounds,
            fixedLetters: 0,
          });
          const built = builtBlocks(planned0, material.score, row.language, tablesAllowed);
          const fixed =
            countBlocks([...skeleton, ...Object.values(built).flat()], row.language) +
            countBlocks(
              [{ type: 'heading', id: 't', level: 1, text: row.document_title }],
              row.language,
            ) +
            Math.min(6, Math.max(0, settings.knowledgeLimit)) * 70;
          const plan = planWriting({
            template,
            language: row.language,
            level,
            bounds: levelBounds,
            fixedLetters: fixed,
          });
          await client.query(
            `update document_writings set plan = $2::jsonb, phase = 'outlining', agent_definition_version_id = $3,
                  report = null where id = $1`,
            [row.id, JSON.stringify({ ...plan, notes, tablesAllowed }), definition.id],
          );
          return {
            status: 'ok',
            subsectionIds: plan.sections.flatMap((section) =>
              section.subsections.map((sub) => sub.id),
            ),
          };
        },
      );
    },

    async writingOutline(ref) {
      const prepared = await prepareCall(ref);
      const stop = stopped(prepared);
      if (stop) return stop;
      const ready = prepared as Prepared;
      const plan = ready.row.plan;
      if (!plan) return { status: 'failed', code: 'writing_not_prepared' };
      const ids = (value: WritingPlan) =>
        value.sections.flatMap((section) => section.subsections.map((sub) => sub.id));
      const multi = plan.sections.some((section) => section.subsections.length > 1);
      if (plan.outlined === true || !multi) {
        if (plan.outlined !== true) {
          await run(ref.workspaceId, (client) =>
            client.query(
              `update document_writings set plan = plan || '{"outlined": true}'::jsonb, phase = 'writing' where id = $1`,
              [ref.writingId],
            ),
          );
        }
        return { status: 'ok', subsectionIds: ids(plan) };
      }
      try {
        const prompt = outlinePrompt({
          definition: ready.definition,
          material: ready.loaded.material,
          plan,
          tablesAllowed: ready.tablesAllowed,
        });
        const answer = await invoke(
          ready,
          'outline',
          prompt,
          { name: OUTLINE_SCHEMA_NAME, schema: OUTLINE_SCHEMA },
          3000,
          ref.retryNo,
          'outline',
        );
        const outlined = { ...applyOutline(plan, answer), outlined: true };
        await run(ref.workspaceId, (client) =>
          client.query(
            `update document_writings set plan = $2::jsonb, phase = 'writing'
              where id = $1 and status in ('queued', 'running', 'paused')`,
            [ref.writingId, JSON.stringify({ ...(ready.row.plan as object), ...outlined })],
          ),
        );
        return { status: 'ok', subsectionIds: ids(outlined) };
      } catch (error) {
        return failedStep(error, ref.retryNo);
      }
    },

    async writingWrite(ref) {
      const prepared = await prepareCall(ref);
      const stop = stopped(prepared);
      if (stop) return stop;
      const ready = prepared as Prepared;
      const plan = ready.row.plan;
      if (!plan) return { status: 'failed', code: 'writing_not_prepared' };
      const existing = ready.row.parts[ref.subsectionId];
      if (existing) return { status: 'ok', letters: existing.letters };
      const section = plan.sections.find((item) =>
        item.subsections.some((sub) => sub.id === ref.subsectionId),
      );
      const subsection = section?.subsections.find((sub) => sub.id === ref.subsectionId);
      if (!section || !subsection) return { status: 'failed', code: 'subsection_unknown' };

      const registry = new CitationRegistry(
        ready.passages,
        ready.verifierAllowed,
        citationState(ready.row),
      );
      const written = Object.fromEntries(
        Object.entries(ready.row.parts).map(([id, part]) => [id, part.blocks]),
      );
      const fallbackCaption = subsection.heading ?? section.label;
      const attempt = async (feedback: string | undefined, tryNo: number) => {
        const prompt = sectionPrompt({
          definition: ready.definition,
          material: ready.loaded.material,
          plan,
          section,
          subsection,
          call: 'section',
          written,
          tablesAllowed: ready.tablesAllowed,
          feedback,
        });
        const answer = await invoke(
          ready,
          'section',
          prompt,
          { name: SECTION_SCHEMA_NAME, schema: SECTION_SCHEMA },
          tokensFor(subsection.budget.max),
          ref.retryNo,
          `${ref.subsectionId}:${tryNo}`,
        );
        const result = draftToBlocks(answer, {
          idPrefix: subsection.id,
          fallbackCaption,
          tablesAllowed: ready.tablesAllowed,
          resolve: (citation) => registry.resolve(citation),
        });
        return { ...result, letters: countBlocks(result.blocks, ready.row.language) };
      };

      try {
        let best = await attempt(undefined, 1);
        let tries = 1;
        const verdict = subsectionVerdict(best.letters, subsection.budget);
        if (verdict !== 'ok') {
          // One more try with what was wrong; if it fails the first answer stands.
          const feedback =
            verdict === 'short'
              ? `Your answer had ${best.letters} letters; the budget is ${subsection.budget.min} to ${subsection.budget.max} (aim at ${subsection.budget.target}). Write more real content that the material supports.`
              : `Your answer had ${best.letters} letters; the budget is ${subsection.budget.min} to ${subsection.budget.max} (aim at ${subsection.budget.target}). Keep what matters most and remove the rest.`;
          try {
            const second = await attempt(feedback, 2);
            tries = 2;
            if (
              second.blocks.length > 0 &&
              Math.abs(second.letters - subsection.budget.target) <
                Math.abs(best.letters - subsection.budget.target)
            )
              best = second;
          } catch {
            // keep the first answer
          }
        }
        const saved = await run(ref.workspaceId, async (client) => {
          const current = await load(client, ref, true);
          if (!LIVE.includes(current.status)) return false;
          const part: Part = {
            blocks: best.blocks,
            letters: best.letters,
            tries,
            fitRound: 0,
            discarded: best.discarded.length,
          };
          await client.query(
            `update document_writings set parts = parts || $2::jsonb, bibliography = $3::jsonb, phase = 'writing' where id = $1`,
            [
              ref.writingId,
              JSON.stringify({ [ref.subsectionId]: part }),
              JSON.stringify(registry.state()),
            ],
          );
          return true;
        });
        if (!saved) return { status: 'failed', code: 'writing_finished' };
        return { status: 'ok', letters: best.letters };
      } catch (error) {
        return failedStep(error, ref.retryNo);
      }
    },

    async writingFit(ref) {
      const prepared = await prepareCall(ref);
      const stop = stopped(prepared);
      if (stop) return stop;
      const ready = prepared as Prepared;
      const plan = ready.row.plan;
      if (!plan) return { status: 'failed', code: 'writing_not_prepared' };
      const language = ready.row.language;
      const document = wholeDocument(
        ready.row,
        plan,
        ready.row.parts,
        ready.loaded.score,
        ready.tablesAllowed,
      );
      const count = countDocument(document).count;
      await run(ref.workspaceId, (client) => setPhase(client, ref.writingId, 'fitting'));
      if (ref.round > ready.settings.fitRounds || fitStatus(count, plan.bounds) === 'within')
        return { status: 'ok', done: true, count };

      const letters = Object.fromEntries(
        Object.entries(ready.row.parts).map(([id, part]) => [id, part.letters]),
      );
      const adjustments = fitAdjustments({ plan, letters, total: count });
      if (adjustments.length === 0) return { status: 'ok', done: true, count };

      const registry = new CitationRegistry(
        ready.passages,
        ready.verifierAllowed,
        citationState(ready.row),
      );
      const written = Object.fromEntries(
        Object.entries(ready.row.parts).map(([id, part]) => [id, part.blocks]),
      );
      const changed: Record<string, Part> = {};
      try {
        for (const adjustment of adjustments) {
          const part = ready.row.parts[adjustment.subsectionId];
          if (!part || part.fitRound >= ref.round) continue;
          const section = plan.sections.find((item) =>
            item.subsections.some((sub) => sub.id === adjustment.subsectionId),
          )!;
          const subsection = section.subsections.find((sub) => sub.id === adjustment.subsectionId)!;
          const prompt = sectionPrompt({
            definition: ready.definition,
            material: ready.loaded.material,
            plan,
            section,
            subsection,
            call: adjustment.action,
            written,
            tablesAllowed: ready.tablesAllowed,
            existing: part.blocks,
            targetLetters: adjustment.targetLetters,
          });
          const answer = await invoke(
            ready,
            adjustment.action,
            prompt,
            { name: SECTION_SCHEMA_NAME, schema: SECTION_SCHEMA },
            tokensFor(Math.max(adjustment.targetLetters, part.letters)),
            ref.retryNo,
            `${adjustment.subsectionId}:fit${ref.round}`,
          );
          const result = draftToBlocks(answer, {
            idPrefix: `${subsection.id}-f${ref.round}`,
            fallbackCaption: subsection.heading ?? section.label,
            tablesAllowed: ready.tablesAllowed,
            resolve: (citation) => registry.resolve(citation),
          });
          const newLetters = countBlocks(result.blocks, language);
          const better =
            result.blocks.length > 0 &&
            (adjustment.action === 'expand'
              ? newLetters > part.letters
              : newLetters < part.letters);
          changed[adjustment.subsectionId] = better
            ? {
                blocks: result.blocks,
                letters: newLetters,
                tries: part.tries + 1,
                fitRound: ref.round,
                discarded: part.discarded + result.discarded.length,
              }
            : { ...part, fitRound: ref.round };
        }
      } catch (error) {
        // Parts already adjusted in this round are kept; the retry skips them.
        if (Object.keys(changed).length > 0) {
          await run(ref.workspaceId, (client) =>
            client.query(
              `update document_writings set parts = parts || $2::jsonb, bibliography = $3::jsonb where id = $1`,
              [ref.writingId, JSON.stringify(changed), JSON.stringify(registry.state())],
            ),
          );
        }
        return failedStep(error, ref.retryNo);
      }
      const after = await run(ref.workspaceId, async (client) => {
        const current = await load(client, ref, true);
        if (!LIVE.includes(current.status)) return null;
        await client.query(
          `update document_writings set parts = parts || $2::jsonb, bibliography = $3::jsonb where id = $1`,
          [ref.writingId, JSON.stringify(changed), JSON.stringify(registry.state())],
        );
        return { ...current.parts, ...changed };
      });
      if (!after) return { status: 'failed', code: 'writing_finished' };
      const next = countDocument(
        wholeDocument(ready.row, plan, after, ready.loaded.score, ready.tablesAllowed),
      ).count;
      return {
        status: 'ok',
        done: fitStatus(next, plan.bounds) === 'within' || ref.round >= ready.settings.fitRounds,
        count: next,
      };
    },

    async writingFinish(ref) {
      return run(
        ref.workspaceId,
        async (client): Promise<WritingStep<{ versionId: string; withinBounds: boolean }>> => {
          const row = await load(client, ref, true);
          if (!LIVE.includes(row.status)) return { status: 'failed', code: 'writing_finished' };
          const plan = row.plan;
          if (!plan) return { status: 'failed', code: 'writing_not_prepared' };
          const settings = writingSettingsFromRow(row.settings);
          const definition = await definitionOf(client, row);
          const scope = toolScope(row, definition);
          const tablesAllowed = toolDecision(scope, 'table_chart_spec') === 'allowed';
          const loaded = await loadMaterial(client, row, []);
          const state = citationState(row);
          let document: StructuredDocument;
          try {
            document = wholeDocument(row, plan, row.parts, loaded?.score ?? null, tablesAllowed);
          } catch {
            await client.query(
              `update document_writings set status = 'failed', phase = 'done', error_code = 'document_invalid', ended_at = now() where id = $1`,
              [row.id],
            );
            return { status: 'failed', code: 'document_invalid' };
          }

          const document0 = (
            await client.query<{ status: string; current_version_id: string | null }>(
              'select status::text as status, current_version_id from documents where id = $1 for update',
              [row.document_id],
            )
          ).rows[0]!;
          if (['locked', 'superseded'].includes(document0.status)) {
            await client.query(
              `update document_writings set status = 'failed', phase = 'done', error_code = 'document_locked', ended_at = now() where id = $1`,
              [row.id],
            );
            return { status: 'failed', code: 'document_locked' };
          }
          if (document0.current_version_id !== row.base_version_id) {
            await client.query(
              `update document_writings set status = 'failed', phase = 'done', error_code = 'document_changed', ended_at = now() where id = $1`,
              [row.id],
            );
            return { status: 'failed', code: 'document_changed' };
          }

          const level = row.level as Level;
          const compliance = checkCompliance(document, level, {
            ...DEFAULT_LEVEL_BOUNDS,
            [level]: plan.bounds,
          });
          const json = canonicalJson(document);
          const reason = `Written by the documenter (v${definition.sequence}, ${plan.templateVersion}, ${WRITING_VERSION})`;
          const version = (
            await client.query<{ id: string }>(
              `insert into document_versions (workspace_id, document_id, version_no, content, content_sha256, char_count, count_algorithm,
                                            level, bounds, within_bounds, origin, reason, writing_id)
             values ($1, $2, (select coalesce(max(version_no), 0) + 1 from document_versions where document_id = $2), $3::jsonb, $4,
                     $5, $6, $7, $8::jsonb, $9, 'model', $10, $11)
             returning id`,
              [
                row.workspace_id,
                row.document_id,
                JSON.stringify(document),
                sha(json),
                compliance.count,
                compliance.algorithm,
                level,
                JSON.stringify(compliance.bounds),
                compliance.withinBounds,
                reason,
                row.id,
              ],
            )
          ).rows[0]!;
          await client.query(
            `update documents set current_version_id = $2, status = 'draft', approved_version_id = null, approval_kind = null,
                  version = version + 1 where id = $1`,
            [row.document_id, version.id],
          );

          const calls = (
            await client.query<{ calls: number }>(
              'select count(*)::int as calls from model_invocations where writing_id = $1 and status = $2',
              [row.id, 'succeeded'],
            )
          ).rows[0]!.calls;
          const notes = (plan.notes ?? []).slice();
          if (!compliance.withinBounds)
            notes.push(compliance.deviation < 0 ? 'left_short' : 'left_long');
          const fitRounds = Math.max(0, ...Object.values(row.parts).map((part) => part.fitRound));
          const report: WritingReport = {
            version: WRITING_VERSION,
            level,
            bounds: plan.bounds,
            count: compliance.count,
            withinBounds: compliance.withinBounds,
            deviation: compliance.deviation,
            fitRounds,
            subsections: plan.sections.reduce(
              (sum, section) => sum + section.subsections.length,
              0,
            ),
            modelCalls: calls,
            citations: {
              proposed: state.stats.proposed,
              verified: state.stats.verified,
              discarded: state.stats.discarded,
            },
            references: referenceCount(document),
            discardedBlocks: Object.values(row.parts).reduce(
              (sum, part) => sum + part.discarded,
              0,
            ),
            notes,
          };
          await client.query(
            `update document_writings set status = 'succeeded', phase = 'done', result_version_id = $2, report = $3::jsonb,
                  block_code = null, ended_at = now() where id = $1`,
            [row.id, version.id, JSON.stringify(report)],
          );
          await audit(client, row.workspace_id, {
            action: 'document.written',
            targetType: 'document',
            targetId: row.document_id,
            projectId: row.project_id,
            severity: compliance.withinBounds ? 'info' : 'warning',
            after: {
              writingId: row.id,
              versionId: version.id,
              charCount: compliance.count,
              withinBounds: compliance.withinBounds,
              fitRounds,
              references: report.references,
              modelCalls: calls,
              costLimitUsd: settings.costLimitUsd,
            },
          });
          return { status: 'ok', versionId: version.id, withinBounds: compliance.withinBounds };
        },
      );
    },

    writingBlock: (ref) =>
      run(ref.workspaceId, async (client) => {
        const updated = await client.query(
          `update document_writings set status = 'paused', block_code = $2 where id = $1 and status in ('queued', 'running')`,
          [ref.writingId, ref.code],
        );
        if (updated.rowCount) {
          await audit(client, ref.workspaceId, {
            action: 'document.writing_blocked',
            targetType: 'document',
            targetId: ref.documentId,
            projectId: ref.projectId,
            severity: 'warning',
            after: { writingId: ref.writingId, code: ref.code, reason: ref.reason },
          });
        }
      }),

    writingResume: (ref) =>
      run(ref.workspaceId, async (client) => {
        await client.query(
          `update document_writings set status = 'running', block_code = null where id = $1 and status = 'paused'`,
          [ref.writingId],
        );
      }),

    writingCancel: (ref) =>
      run(ref.workspaceId, async (client) => {
        const updated = await client.query(
          `update document_writings set status = 'cancelled', phase = 'done', block_code = null, ended_at = now()
            where id = $1 and status in ('queued', 'running', 'paused')`,
          [ref.writingId],
        );
        if (updated.rowCount) {
          await audit(client, ref.workspaceId, {
            action: 'document.writing_cancelled',
            targetType: 'document',
            targetId: ref.documentId,
            projectId: ref.projectId,
            reason: ref.reason,
            after: { writingId: ref.writingId },
          });
        }
      }),

    writingFail: (ref) =>
      run(ref.workspaceId, async (client) => {
        const updated = await client.query(
          `update document_writings set status = 'failed', phase = 'done', error_code = $2, block_code = null, ended_at = now()
            where id = $1 and status in ('queued', 'running', 'paused')`,
          [ref.writingId, ref.code],
        );
        if (updated.rowCount) {
          await audit(client, ref.workspaceId, {
            action: 'document.writing_failed',
            targetType: 'document',
            targetId: ref.documentId,
            projectId: ref.projectId,
            severity: 'warning',
            after: { writingId: ref.writingId, code: ref.code },
          });
        }
      }),
  };
}

function referenceCount(document: StructuredDocument): number {
  for (const block of document.blocks)
    if (block.type === 'bibliography') return block.entries.length;
  return 0;
}

/** The level bounds of the writing are part of its settings snapshot. */
function settingsBounds(value: unknown, level: Level): { min: number; max: number } | null {
  const raw = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const bounds = raw['levelBounds'];
  if (!Array.isArray(bounds) || bounds.length !== 10) return null;
  const min = Number(bounds[(level - 1) * 2]);
  const max = Number(bounds[(level - 1) * 2 + 1]);
  return Number.isInteger(min) && Number.isInteger(max) && min < max ? { min, max } : null;
}
