import { defaultDefinition } from '@docoo/domain';
import { fakeResponder } from '@docoo/orchestration';
import type { NormalizedModelRequest } from '@docoo/providers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AnalysisDriver } from './support/analysis.js';
import type { TemporalTestRuntime } from './support/harness.js';
import { adminUrl, createHarness, temporalAddress, type Harness } from './support/harness.js';

interface StageView {
  id: string;
  stage: string;
  status: string;
  pendingGateOutputId: string | null;
}
interface Overview {
  stages: StageView[];
}
interface Evidence {
  ref: string;
  knowledgeId: string | null;
  versionNo: number | null;
  title: string | null;
  quote: string;
  verified: boolean;
  problem: string | null;
}
interface ResearchContent {
  findings: {
    claim: string;
    source: string;
    support: 'knowledge' | 'unverified';
    evidence: Evidence[];
  }[];
  gaps: string[];
  conflicts: { description: string; refs: string[] }[];
  knowledge: {
    queries: string[];
    snapshots: { id: string; query: string; results: number }[];
    offered: { ref: string; knowledgeId: string; title: string; cited: boolean }[];
    excludedRestricted: boolean;
    retrieveTool: string;
    verifierTool: string;
  };
  verification: {
    findings: number;
    supported: number;
    unverified: number;
    citations: number;
    verified: number;
    rejected: number;
  };
}
interface Evaluation {
  role: string;
  status: string;
  reason: string | null;
  score: number | null;
  charterVersionId: string | null;
  charterSequence: number | null;
  samples: { ref: string; outputId: string; rejected: boolean }[];
  findings: {
    kind: string;
    severity: string;
    detail: string;
    clauses: { ref: string; text: string }[];
    evidence: { type: string; id: string; ref: string }[];
  }[];
  discarded: number;
  invocationId: string | null;
  errorCode: string | null;
}
interface BrainReport {
  id: string;
  deviations: unknown[];
  summary: {
    modelEvaluation?: {
      requested: boolean;
      judgeVersionId: string;
      completed: number;
      skipped: number;
      failed: number;
      discardedFindings: number;
    };
  };
  evaluations: Evaluation[];
}

const CHURN =
  'Repeat customer churn falls when support answers within one hour because customers who wait leave.';
const RESTRICTED =
  'Repeat customer churn among key accounts rises when the pricing contract is renegotiated because discounts disappear.';
const ELSEWHERE =
  'Repeat customer churn in the warehouse programme drops when delivery windows shrink because parcels arrive earlier.';

let h: Harness;
let cookie: string;
let temporal: TemporalTestRuntime;
let analysis: AnalysisDriver;
let topicId: string;
let churnId: string;
let restrictedId: string;
let elsewhereId: string;
let codeCounter = 0;
const captured: NormalizedModelRequest[] = [];
const api = (suffix: string) => `/v1/workspaces/${h.ids.workspaceA}${suffix}`;

async function get<T>(path: string, who = cookie): Promise<T> {
  const response = await h.request('GET', api(path), { cookie: who });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<T>();
}

async function post<T>(path: string, payload: unknown = {}, expected = 201): Promise<T> {
  const response = await h.request('POST', api(path), { cookie, payload });
  expect(response.statusCode, response.body).toBe(expected);
  return response.json<T>();
}

async function setting(key: string, value: unknown) {
  const response = await h.request('PUT', api('/settings/assignments'), {
    cookie,
    payload: {
      key,
      scopeType: 'workspace',
      scopeId: h.ids.workspaceA,
      value,
      reason: `test ${key}`,
    },
  });
  expect(response.statusCode, response.body).toBe(200);
}

async function knowledge(
  title: string,
  content: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const created = await post<{ knowledge: { id: string } }>('/knowledge', {
    title,
    sourceType: 'admin_provided',
    provenance: { declaration: 'Approved by the churn committee' },
    scopes: [{ type: 'workspace', id: h.ids.workspaceA }],
    content,
    ...extra,
  });
  const id = created.knowledge.id;
  const audited = await post<{ review: { decision: string } }>(
    `/knowledge/${id}/submit-audit`,
    {},
    200,
  );
  expect(audited.review.decision).toBe('approved');
  return id;
}

async function project(prefix: string): Promise<string> {
  codeCounter += 1;
  const created = await post<{ project: { id: string } }>('/projects', {
    code: `${prefix}-${codeCounter}`,
    title: `Project ${prefix}`,
    initialProblem: 'Reduce repeat-customer churn by 20%.',
    topics: [{ topicId }],
  });
  return created.project.id;
}

async function activateProject(projectId: string) {
  const current = await get<{ project: { version: number } }>(`/projects/${projectId}`);
  await post(`/projects/${projectId}/activate`, { expectedVersion: current.project.version }, 200);
}

const overview = async (projectId: string) =>
  (await get<{ workflow: Overview }>(`/projects/${projectId}/workflow`)).workflow;
const stageOf = (view: Overview, stage: string) =>
  view.stages.find((item) => item.stage === stage)!;
const waiting = (stage: string) => (view: Overview) =>
  stageOf(view, stage).status === 'waiting_for_human' &&
  Boolean(stageOf(view, stage).pendingGateOutputId);

async function waitFor(projectId: string, predicate: (view: Overview) => boolean, label: string) {
  const deadline = Date.now() + 45_000;
  let last: Overview | null = null;
  while (Date.now() < deadline) {
    last = await overview(projectId);
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(last)}`);
}

async function decide(
  projectId: string,
  stage: StageView,
  action: 'approve' | 'reject',
  comment?: string,
) {
  const response = await h.request(
    'POST',
    api(`/projects/${projectId}/stages/${stage.id}/outputs/${stage.pendingGateOutputId}/${action}`),
    { cookie, payload: comment ? { comment } : {} },
  );
  expect(response.statusCode, response.body).toBe(200);
}

/** Runs a project through the analysis and waits at the research gate. */
async function reachResearch(prefix: string): Promise<string> {
  const projectId = await project(prefix);
  await activateProject(projectId);
  await analysis.reachDefinition(projectId);
  const view = await waitFor(projectId, waiting('analysis'), 'analysis gate');
  await decide(projectId, stageOf(view, 'analysis'), 'approve');
  await waitFor(projectId, waiting('research'), 'research gate');
  return projectId;
}

async function researchOutput(projectId: string): Promise<ResearchContent> {
  const row = await h.admin.query<{ content: ResearchContent }>(
    `select o.content from stage_outputs o join stage_runs s on s.id = o.stage_run_id
      where s.project_id = $1 and s.stage = 'research' order by o.created_at desc, o.id desc limit 1`,
    [projectId],
  );
  return row.rows[0]!.content;
}

async function toolCalls(projectId: string, tool?: string) {
  const rows = await h.admin.query<{
    id: string;
    tool: string;
    decision: string;
    role: string;
    attempt_id: string;
    agent_definition_version_id: string;
    input_sha256: string;
    output_ref: { type: string; id: string } | null;
    result: Record<string, unknown>;
    error_code: string | null;
  }>(
    `select id, tool, decision::text as decision, role::text as role, attempt_id, agent_definition_version_id,
            input_sha256, output_ref, result, error_code
       from agent_tool_calls where project_id = $1 and ($2::text is null or tool = $2) order by created_at, id`,
    [projectId, tool ?? null],
  );
  return rows.rows;
}

const researchRequests = () =>
  captured.filter((request) => request.responseSchema?.name === 'research_output');
const dataOf = (request: NormalizedModelRequest) =>
  JSON.parse(request.messages[0]!.content.slice('<data>'.length, -'</data>'.length)) as Record<
    string,
    unknown
  >;

async function researcherVersion(tools: string[]): Promise<string> {
  const created = await h.request('POST', api('/agent-roles/researcher/definitions'), {
    cookie,
    payload: { changes: { tools }, reason: 'Change the allowed tools' },
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json<{ definition: { id: string } }>().definition.id;
  const activated = await h.request(
    'POST',
    api(`/agent-roles/researcher/definitions/${id}/activate`),
    {
      cookie,
      payload: { reason: 'Use this version' },
    },
  );
  expect(activated.statusCode, activated.body).toBe(200);
  return id;
}

async function activateResearcher(id: string) {
  const activated = await h.request(
    'POST',
    api(`/agent-roles/researcher/definitions/${id}/activate`),
    {
      cookie,
      payload: { reason: 'Back to the earlier version' },
    },
  );
  expect(activated.statusCode, activated.body).toBe(200);
}

describe.skipIf(!adminUrl || !temporalAddress)(
  'research with approved knowledge and role evaluation (RSC-*, EVL-*)',
  () => {
    beforeAll(async () => {
      h = await createHarness('research', { workflow: true });
      temporal = h.engine as TemporalTestRuntime;
      cookie = await h.login(h.emails.a);
      analysis = new AnalysisDriver(h, cookie, h.ids.workspaceA);
      topicId = (
        await post<{ topic: { id: string } }>('/topics', { code: 'retail', title: 'Retail' })
      ).topic.id;
      const connection = await post<{ connection: { id: string } }>('/provider-connections', {
        provider: 'fake',
        name: 'Deterministic',
      });
      await setting('ai.connection_id', connection.connection.id);
      await setting('ai.model', 'fake-standard');

      const other = await project('other');
      churnId = await knowledge('Support response and churn', CHURN);
      restrictedId = await knowledge('Key account churn', RESTRICTED, {
        confidentiality: 'restricted',
      });
      elsewhereId = await knowledge('Warehouse programme churn', ELSEWHERE, {
        scopes: [{ type: 'project', id: other }],
      });
    }, 90_000);

    beforeEach(() => {
      captured.length = 0;
      temporal.fake.responder = (request) => {
        captured.push(request);
        return fakeResponder(request);
      };
    });
    afterEach(() => {
      temporal.fake.responder = fakeResponder;
      temporal.fakeScript = () => null;
    });
    afterAll(async () => {
      await h?.close();
    });

    it('RSC-001: the research stage retrieves approved knowledge through the tool gate and cites it with verified quotes', async () => {
      const projectId = await reachResearch('rsc');

      // The model got the approved, in-scope, non-restricted passage and the citation rules.
      const [request] = researchRequests();
      expect(request).toBeDefined();
      const data = dataOf(request!);
      const offered = data['approvedKnowledge'] as { ref: string; title: string; text: string }[];
      expect(offered.map((item) => item.ref)).toEqual(['K1']);
      expect(offered[0]).toMatchObject({ title: 'Support response and churn', text: CHURN });
      const message = request!.messages[0]!.content;
      expect(message).not.toContain('key accounts');
      expect(message).not.toContain('warehouse');
      expect(request!.instructions).toContain('approvedKnowledge holds approved passages');
      expect(request!.instructions).toContain('Never invent a ref or a quote');
      // Instructions never carry project or knowledge content.
      expect(request!.instructions).not.toContain('answers within one hour');

      // The stored output marks each finding by how it is supported.
      const content = await researchOutput(projectId);
      expect(content.findings.map((finding) => finding.support)).toEqual([
        'knowledge',
        'unverified',
      ]);
      expect(content.findings[0]!.evidence).toEqual([
        expect.objectContaining({
          ref: 'K1',
          knowledgeId: churnId,
          versionNo: 1,
          title: 'Support response and churn',
          verified: true,
          problem: null,
        }),
      ]);
      expect(CHURN).toContain(content.findings[0]!.evidence[0]!.quote);
      expect(content.findings[1]!.evidence).toEqual([]);
      expect(content.verification).toMatchObject({
        findings: 2,
        supported: 1,
        unverified: 1,
        citations: 1,
        verified: 1,
        rejected: 0,
      });
      expect(content.knowledge).toMatchObject({
        excludedRestricted: true,
        retrieveTool: 'allowed',
        verifierTool: 'allowed',
        offered: [{ ref: 'K1', knowledgeId: churnId, cited: true }],
      });
      expect(content.knowledge.queries.length).toBeGreaterThan(0);
      expect(content.knowledge.queries.length).toBeLessThanOrEqual(5);
      expect(content.knowledge.snapshots).toHaveLength(content.knowledge.queries.length);

      // Every retrieval and the verification are in the tool ledger, with digests and references only.
      const calls = await toolCalls(projectId);
      const retrievals = calls.filter((call) => call.tool === 'knowledge_retrieve');
      expect(retrievals).toHaveLength(content.knowledge.queries.length);
      const pinned = await h.admin.query<{ definition_version_id: string }>(
        `select definition_version_id from project_agent_profiles where project_id = $1 and role = 'researcher'`,
        [projectId],
      );
      for (const call of retrievals) {
        expect(call).toMatchObject({ decision: 'allowed', role: 'researcher', error_code: null });
        expect(call.agent_definition_version_id).toBe(pinned.rows[0]!.definition_version_id);
        expect(call.input_sha256).toMatch(/^[0-9a-f]{64}$/u);
        expect(call.output_ref).toMatchObject({ type: 'retrieval_snapshot' });
      }
      expect(JSON.stringify(retrievals)).not.toContain('answers within one hour');
      const verifier = calls.filter((call) => call.tool === 'citation_verifier');
      expect(verifier).toHaveLength(1);
      expect(verifier[0]).toMatchObject({ decision: 'allowed', role: 'researcher' });
      expect(verifier[0]!.result).toMatchObject({
        verified: 1,
        rejected: 0,
        cited: [{ ref: 'K1', knowledgeId: churnId }],
      });

      // The snapshots are the pinned, replayable record of what the agent was shown.
      const hit = retrievals.find((call) =>
        (call.result['knowledgeIds'] as string[]).includes(churnId),
      )!;
      expect(hit.result['results']).toBeGreaterThan(0);
      const snapshot = await get<{
        snapshot: { results: { knowledgeId: string }[]; role: string };
      }>(`/retrieval-snapshots/${hit.output_ref!.id}`);
      expect(snapshot.snapshot.role).toBe('researcher');
      expect(snapshot.snapshot.results.map((item) => item.knowledgeId)).toContain(churnId);

      // "Used in": the knowledge shows where it was retrieved and that this project cited it.
      const uses = await get<{
        items: {
          projectId: string;
          stage: string;
          role: string;
          cited: boolean;
          versionNos: number[];
          attemptNo: number;
        }[];
        totals: { retrievals: number; cited: number };
      }>(`/knowledge/${churnId}/uses`);
      expect(uses.items.length).toBeGreaterThan(0);
      expect(uses.items[0]).toMatchObject({
        projectId,
        stage: 'research',
        role: 'researcher',
        cited: true,
        versionNos: [1],
        attemptNo: 1,
      });
      expect(uses.totals.cited).toBe(uses.totals.retrievals);
      for (const id of [restrictedId, elsewhereId]) {
        expect((await get<{ items: unknown[] }>(`/knowledge/${id}/uses`)).items).toEqual([]);
      }
      const unknown = await h.request(
        'GET',
        api('/knowledge/00000000-0000-4000-8000-000000000000/uses'),
        { cookie },
      );
      expect(unknown.statusCode).toBe(404);
      const foreign = await h.login(h.emails.b);
      expect(
        (await h.request('GET', api(`/knowledge/${churnId}/uses`), { cookie: foreign })).statusCode,
      ).toBeGreaterThanOrEqual(403);

      // Later stages see the claims with their support, not the quotes and ids.
      const view = await overview(projectId);
      await decide(projectId, stageOf(view, 'research'), 'approve');
      await waitFor(projectId, waiting('ideation'), 'ideation gate');
      const ideation = captured.find((item) => item.responseSchema?.name === 'ideation_output')!;
      const previous = dataOf(ideation)['previousStages'] as {
        stage: string;
        content: Record<string, unknown>;
      }[];
      const research = previous.find((item) => item.stage === 'research')!.content;
      expect(research['findings']).toEqual([
        expect.objectContaining({
          support: 'knowledge',
          approvedKnowledge: ['Support response and churn (v1)'],
        }),
        expect.objectContaining({ support: 'unverified' }),
      ]);
      expect(JSON.stringify(research)).not.toContain('quote');
      expect(JSON.stringify(research)).not.toContain(churnId);
    }, 120_000);

    it('RSC-002: a role without knowledge_retrieve gets a denied call in the ledger and no knowledge', async () => {
      const base = defaultDefinition('researcher').tools;
      const original = (await get<{ definition: { id: string } }>('/agent-roles/researcher'))
        .definition.id;
      await researcherVersion(base.filter((tool) => tool !== 'knowledge_retrieve'));
      try {
        const projectId = await reachResearch('deny');
        const [request] = researchRequests();
        expect(dataOf(request!)).not.toHaveProperty('approvedKnowledge');
        expect(request!.instructions).toContain('No approved knowledge is available');
        const content = await researchOutput(projectId);
        expect(content.knowledge).toMatchObject({
          retrieveTool: 'denied',
          verifierTool: 'allowed',
          offered: [],
          queries: [],
        });
        expect(content.findings.every((finding) => finding.support === 'unverified')).toBe(true);
        const calls = await toolCalls(projectId, 'knowledge_retrieve');
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
          decision: 'denied',
          error_code: 'tool_not_allowed',
          output_ref: null,
        });
        const snapshots = await h.admin.query(
          'select 1 from retrieval_snapshots where project_id = $1',
          [projectId],
        );
        expect(snapshots.rowCount).toBe(0);
        expect(
          (await get<{ items: unknown[] }>(`/knowledge/${churnId}/uses`)).items.every(
            (item) => (item as { projectId: string }).projectId !== projectId,
          ),
        ).toBe(true);
      } finally {
        await activateResearcher(original);
      }
    }, 120_000);

    it('RSC-003: without citation_verifier nothing counts as verified, and the denial is recorded', async () => {
      const base = defaultDefinition('researcher').tools;
      const original = (await get<{ definition: { id: string } }>('/agent-roles/researcher'))
        .definition.id;
      await researcherVersion(base.filter((tool) => tool !== 'citation_verifier'));
      try {
        const projectId = await reachResearch('noverify');
        const content = await researchOutput(projectId);
        expect(content.knowledge).toMatchObject({
          retrieveTool: 'allowed',
          verifierTool: 'denied',
        });
        expect(content.knowledge.offered.length).toBeGreaterThan(0);
        expect(content.findings.every((finding) => finding.support === 'unverified')).toBe(true);
        expect(content.findings[0]!.evidence[0]).toMatchObject({
          verified: false,
          problem: 'verifier_not_allowed',
        });
        expect(content.verification).toMatchObject({ supported: 0, verified: 0, rejected: 1 });
        const verifier = await toolCalls(projectId, 'citation_verifier');
        expect(verifier).toHaveLength(1);
        expect(verifier[0]).toMatchObject({ decision: 'denied', error_code: 'tool_not_allowed' });
      } finally {
        await activateResearcher(original);
      }
    }, 120_000);

    it('RSC-004: settings decide how much knowledge the stage gets, and restricted knowledge needs an explicit opt-in', async () => {
      await setting('research.allow_restricted_knowledge', true);
      try {
        const projectId = await reachResearch('restricted');
        const [request] = researchRequests();
        const offered = dataOf(request!)['approvedKnowledge'] as { title: string }[];
        expect(offered.map((item) => item.title).sort()).toEqual([
          'Key account churn',
          'Support response and churn',
        ]);
        const content = await researchOutput(projectId);
        expect(content.knowledge.excludedRestricted).toBe(false);
        expect(
          (await get<{ items: unknown[] }>(`/knowledge/${restrictedId}/uses`)).items.length,
        ).toBeGreaterThan(0);
      } finally {
        await setting('research.allow_restricted_knowledge', false);
      }

      await setting('research.knowledge_limit', 0);
      try {
        captured.length = 0;
        const projectId = await reachResearch('off');
        expect(dataOf(researchRequests()[0]!)).not.toHaveProperty('approvedKnowledge');
        expect(await toolCalls(projectId, 'knowledge_retrieve')).toEqual([]);
        const content = await researchOutput(projectId);
        expect(content.knowledge).toMatchObject({
          retrieveTool: 'allowed',
          queries: [],
          offered: [],
        });
      } finally {
        await setting('research.knowledge_limit', 12);
      }

      await setting('research.max_queries', 1);
      try {
        const projectId = await reachResearch('one-query');
        expect((await researchOutput(projectId)).knowledge.queries).toHaveLength(1);
        expect(await toolCalls(projectId, 'knowledge_retrieve')).toHaveLength(1);
      } finally {
        await setting('research.max_queries', 5);
      }
      const invalid = await h.request('PUT', api('/settings/assignments'), {
        cookie,
        payload: {
          key: 'research.knowledge_limit',
          scopeType: 'workspace',
          scopeId: h.ids.workspaceA,
          value: 31,
          reason: 'too many',
        },
      });
      expect(invalid.statusCode).toBe(400);
    }, 180_000);

    it('RSC-008: research.max_sources caps the distinct knowledge items the stage may use', async () => {
      await setting('research.allow_restricted_knowledge', true);
      await setting('research.max_sources', 1);
      try {
        const projectId = await reachResearch('one-source');
        const offered = (await researchOutput(projectId)).knowledge.offered;
        // Two sources match; only the best one is used, and the output says which.
        expect(new Set(offered.map((item) => item.knowledgeId)).size).toBe(1);
        const [request] = researchRequests();
        expect((dataOf(request!)['approvedKnowledge'] as unknown[]).length).toBe(1);
      } finally {
        await setting('research.max_sources', 30);
        await setting('research.allow_restricted_knowledge', false);
      }
      const invalid = await h.request('PUT', api('/settings/assignments'), {
        cookie,
        payload: {
          key: 'research.max_sources',
          scopeType: 'workspace',
          scopeId: h.ids.workspaceA,
          value: 0,
          reason: 'none at all',
        },
      });
      expect(invalid.statusCode).toBe(400);
    }, 120_000);

    it('RSC-009: knowledge.min_audit_score keeps weakly audited knowledge out of retrieval and research', async () => {
      const ask = async () =>
        (
          await post<{ results: { knowledgeId: string }[] }>(
            '/knowledge/retrieve',
            { query: CHURN, limit: 10 },
            200,
          )
        ).results.map((item) => item.knowledgeId);
      expect(await ask()).toContain(churnId);
      await setting('knowledge.min_audit_score', 1);
      try {
        // No audit reaches a perfect score, so nothing approved by the Brain passes the floor.
        expect(await ask()).not.toContain(churnId);
        captured.length = 0;
        const projectId = await reachResearch('floor');
        expect(dataOf(researchRequests()[0]!)).not.toHaveProperty('approvedKnowledge');
        expect((await researchOutput(projectId)).knowledge.offered).toEqual([]);
      } finally {
        await setting('knowledge.min_audit_score', 0.7);
      }
      expect(await ask()).toContain(churnId);
    }, 120_000);

    it('RSC-005: a quote the model made up is kept, shown as failed, and never counts as support', async () => {
      temporal.fake.responder = (request) => {
        captured.push(request);
        if (request.responseSchema?.name !== 'research_output') return fakeResponder(request);
        return {
          findings: [
            {
              claim: 'Churn halves when support is staffed overnight.',
              source: 'Support response and churn',
              evidence: [
                { ref: 'K1', quote: 'churn halves when support is staffed overnight' },
                { ref: 'K7', quote: 'customers who wait leave' },
              ],
            },
            {
              claim: 'Support speed matters.',
              source: 'Support response and churn',
              evidence: [{ ref: 'k1', quote: 'support answers within one hour' }],
            },
          ],
          gaps: [],
          conflicts: [],
        };
      };
      const projectId = await reachResearch('fabricated');
      const content = await researchOutput(projectId);
      expect(content.findings.map((finding) => finding.support)).toEqual([
        'unverified',
        'knowledge',
      ]);
      expect(
        content.findings[0]!.evidence.map((item) => [item.ref, item.verified, item.problem]),
      ).toEqual([
        ['K1', false, 'quote_not_found'],
        ['K7', false, 'unknown_ref'],
      ]);
      expect(content.verification).toMatchObject({ citations: 3, verified: 1, rejected: 2 });
      const verifier = await toolCalls(projectId, 'citation_verifier');
      expect(verifier[0]!.result).toMatchObject({ verified: 1, rejected: 2 });
    }, 120_000);

    it('RSC-006: a provider retry of the same attempt reuses the first retrieval and prompt', async () => {
      let failed = false;
      temporal.fakeScript = (request) => {
        if (request.responseSchema?.name === 'research_output' && !failed) {
          failed = true;
          return 'transient';
        }
        return null;
      };
      const projectId = await reachResearch('retry');
      expect(failed).toBe(true);
      // The failed first call never produced an answer; the retry is the one request seen.
      expect(researchRequests()).toHaveLength(1);
      const invocations = await h.admin.query<{
        retry_no: number;
        status: string;
        prompt_sha256: string;
      }>(
        `select retry_no, status::text as status, prompt_sha256 from model_invocations
          where project_id = $1 and purpose = 'stage:research' order by retry_no`,
        [projectId],
      );
      expect(invocations.rows.map((row) => [row.retry_no, row.status])).toEqual([
        [0, 'transient_failed'],
        [1, 'succeeded'],
      ]);
      expect(invocations.rows[0]!.prompt_sha256).toBe(invocations.rows[1]!.prompt_sha256);
      // One set of retrievals, not two.
      const content = await researchOutput(projectId);
      expect(await toolCalls(projectId, 'knowledge_retrieve')).toHaveLength(
        content.knowledge.queries.length,
      );
      expect(await toolCalls(projectId, 'citation_verifier')).toHaveLength(1);
    }, 120_000);

    it('RSC-007: a rejected output is redone with a new retrieval of its own, and the ledger stays append-only', async () => {
      const projectId = await reachResearch('redo');
      const before = (await toolCalls(projectId, 'knowledge_retrieve')).length;
      const view = await overview(projectId);
      await decide(projectId, stageOf(view, 'research'), 'reject', 'Add the pricing angle.');
      await waitFor(
        projectId,
        (next) =>
          waiting('research')(next) &&
          stageOf(next, 'research').pendingGateOutputId !==
            stageOf(view, 'research').pendingGateOutputId,
        'second research output',
      );
      const attempts = await h.admin.query<{ attempt_no: number; calls: number }>(
        `select a.attempt_no, count(c.id)::int as calls from stage_attempts a
           join stage_runs s on s.id = a.stage_run_id
           left join agent_tool_calls c on c.attempt_id = a.id and c.tool = 'knowledge_retrieve'
          where s.project_id = $1 and s.stage = 'research' group by a.attempt_no order by a.attempt_no`,
        [projectId],
      );
      expect(attempts.rows).toHaveLength(2);
      expect(attempts.rows[0]!.calls).toBe(before);
      expect(attempts.rows[1]!.calls).toBe(before);
      const any = (await toolCalls(projectId))[0]!;
      await expect(
        h.admin.query('update agent_tool_calls set tool = $2 where id = $1', [
          any.id,
          'calculator',
        ]),
      ).rejects.toThrow();
      await expect(
        h.admin.query('delete from agent_tool_calls where id = $1', [any.id]),
      ).rejects.toThrow();
    }, 120_000);

    describe('Brain role evaluation (ADR-0011, ADR-0017)', () => {
      const post_ = (payload: Record<string, unknown>) =>
        post<{ report: BrainReport }>('/brain-reports', payload).then((body) => body.report);
      const judgeRequests = () =>
        captured.filter((request) => request.responseSchema?.name === 'brain_role_evaluation');
      const roleOfRequest = (request: NormalizedModelRequest) =>
        (dataOf(request)['role'] as string) ?? '';

      async function fingerprint(): Promise<string> {
        const result = await h.admin.query<{ fingerprint: string }>(
          `select md5(string_agg(row, '|' order by row)) as fingerprint from (
             select 'p:' || id || ':' || status || ':' || version as row from projects where workspace_id = $1
             union all select 'o:' || id from stage_outputs where workspace_id = $1
             union all select 'r:' || id || ':' || status from stage_runs where workspace_id = $1
             union all select 'a:' || id || ':' || sequence from agent_definition_versions where workspace_id = $1
             union all select 'v:' || project_id || ':' || definition_version_id from project_agent_profiles where workspace_id = $1
             union all select 's:' || id from config_assignments where workspace_id = $1
             union all select 'k:' || id || ':' || status from knowledge_versions where workspace_id = $1
             union all select 't:' || id from agent_tool_calls where workspace_id = $1
           ) rows`,
          [h.ids.workspaceA],
        );
        return result.rows[0]!.fingerprint;
      }

      it('EVL-001: without the option the report has no model evaluation and costs no model call', async () => {
        const before = await h.admin.query<{ count: number }>(
          `select count(*)::int as count from model_invocations where workspace_id = $1 and purpose like 'brain:%'`,
          [h.ids.workspaceA],
        );
        const report = await post_({});
        expect(report.evaluations).toEqual([]);
        expect(report.summary.modelEvaluation).toBeUndefined();
        const after = await h.admin.query<{ count: number }>(
          `select count(*)::int as count from model_invocations where workspace_id = $1 and purpose like 'brain:%'`,
          [h.ids.workspaceA],
        );
        expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
        const list = await get<{ items: { id: string; modelEvaluation: unknown }[] }>(
          '/brain-reports',
        );
        expect(list.items.find((item) => item.id === report.id)!.modelEvaluation).toBeNull();
      });

      it('EVL-002: the Brain judges each role against the charter it ran with, with evidence, and changes nothing', async () => {
        const stateBefore = await fingerprint();
        const report = await post_({ modelEvaluation: true });
        expect(report.evaluations.map((item) => item.role)).toEqual([
          'analyst',
          'researcher',
          'ideator',
          'documenter',
          'evaluator',
        ]);
        const byRole = Object.fromEntries(report.evaluations.map((item) => [item.role, item]));
        // The projects reached the research and ideation gates only.
        expect(byRole['analyst']).toMatchObject({ status: 'completed', reason: null, score: 4 });
        expect(byRole['researcher']).toMatchObject({ status: 'completed', reason: null, score: 4 });
        expect(byRole['ideator']).toMatchObject({ status: 'completed' });
        for (const role of ['documenter', 'evaluator'] as const) {
          expect(byRole[role]).toMatchObject({
            status: 'skipped',
            reason: 'no_samples',
            score: null,
            findings: [],
            invocationId: null,
          });
        }
        expect(report.summary.modelEvaluation).toMatchObject({
          requested: true,
          completed: 3,
          skipped: 2,
          failed: 0,
        });

        // Every finding points at charter items and at real stage outputs of this workspace.
        const researcher = byRole['researcher']!;
        expect(researcher.samples.length).toBeGreaterThan(0);
        const known = await h.admin.query<{ id: string }>(
          `select o.id from stage_outputs o where o.workspace_id = $1`,
          [h.ids.workspaceA],
        );
        const outputIds = new Set(known.rows.map((row) => row.id));
        const charter = await h.admin.query<{
          principles: string[];
          duties: string[];
          sequence: number;
        }>('select principles, duties, sequence from agent_definition_versions where id = $1', [
          researcher.charterVersionId,
        ]);
        expect(researcher.charterSequence).toBe(charter.rows[0]!.sequence);
        expect(researcher.findings.map((finding) => finding.kind)).toEqual([
          'strength',
          'deviation',
        ]);
        for (const evaluation of report.evaluations.filter((item) => item.status === 'completed')) {
          for (const finding of evaluation.findings) {
            expect(finding.clauses.length).toBeGreaterThan(0);
            expect(finding.evidence.length).toBeGreaterThan(0);
            for (const item of finding.evidence) {
              expect(item.type).toBe('stage_output');
              expect(outputIds.has(item.id), item.id).toBe(true);
            }
          }
        }
        const clause = researcher.findings[0]!.clauses[0]!;
        expect(clause.ref).toBe('P1');
        expect(clause.text).toBe(charter.rows[0]!.principles[0]);

        // The judge is the Brain, with its own definition and the code-owned evaluation rules.
        const requests = judgeRequests();
        expect(requests.map(roleOfRequest).sort()).toEqual(['analyst', 'ideator', 'researcher']);
        const researcherRequest = requests.find((item) => roleOfRequest(item) === 'researcher')!;
        expect(researcherRequest.instructions).toContain('Your role: brain.');
        expect(researcherRequest.instructions).toContain('a finding without both is discarded');
        expect(researcherRequest.instructions).toContain(defaultDefinition('brain').promptTemplate);
        const prompt = dataOf(researcherRequest);
        expect(JSON.stringify(prompt['charter'])).toContain(charter.rows[0]!.duties[0]);
        expect(JSON.stringify(prompt)).not.toContain(researcher.samples[0]!.outputId);
        const invocation = await h.admin.query<{
          purpose: string;
          agent_definition_version_id: string;
          prompt_sha256: string;
          project_id: string | null;
        }>(
          'select purpose, agent_definition_version_id, prompt_sha256, project_id from model_invocations where id = $1',
          [researcher.invocationId],
        );
        expect(invocation.rows[0]).toMatchObject({
          purpose: 'brain:evaluate:researcher',
          project_id: null,
        });
        expect(invocation.rows[0]!.agent_definition_version_id).toBe(
          report.summary.modelEvaluation!.judgeVersionId,
        );
        expect(invocation.rows[0]!.prompt_sha256).toMatch(/^[0-9a-f]{64}$/u);
        const judge = await h.admin.query<{ role: string }>(
          'select role::text as role from agent_definition_versions where id = $1',
          [report.summary.modelEvaluation!.judgeVersionId],
        );
        expect(judge.rows[0]!.role).toBe('brain');

        // Reading and judging change no project, run, output, definition, setting or knowledge.
        expect(await fingerprint()).toBe(stateBefore);
        const stored = await get<{ report: BrainReport }>(`/brain-reports/${report.id}`);
        expect(stored.report.evaluations).toEqual(report.evaluations);
        await expect(
          h.admin.query(`update brain_reports set evaluations = '[]' where id = $1`, [report.id]),
        ).rejects.toThrow();
        const listed = await get<{
          items: { id: string; modelEvaluation: { completed: number } }[];
        }>('/brain-reports');
        expect(listed.items.find((item) => item.id === report.id)!.modelEvaluation).toMatchObject({
          completed: 3,
        });
      });

      it('EVL-003: a project report judges only that project, and a rejected sample is marked with its review', async () => {
        const projectId = await reachResearch('judged');
        const view = await overview(projectId);
        await decide(projectId, stageOf(view, 'research'), 'reject', 'The findings need sources.');
        await waitFor(
          projectId,
          (next) =>
            waiting('research')(next) &&
            stageOf(next, 'research').pendingGateOutputId !==
              stageOf(view, 'research').pendingGateOutputId,
          'second research output',
        );
        captured.length = 0;
        const report = await post_({ projectId, modelEvaluation: true });
        const researcher = report.evaluations.find((item) => item.role === 'researcher')!;
        expect(researcher.status).toBe('completed');
        expect(researcher.samples.some((sample) => sample.rejected)).toBe(true);
        const projectOutputs = await h.admin.query<{ id: string }>(
          `select o.id from stage_outputs o join stage_runs s on s.id = o.stage_run_id where s.project_id = $1`,
          [projectId],
        );
        const own = new Set(projectOutputs.rows.map((row) => row.id));
        for (const sample of report.evaluations.flatMap((item) => item.samples)) {
          expect(own.has(sample.outputId)).toBe(true);
        }
        const request = judgeRequests().find((item) => roleOfRequest(item) === 'researcher')!;
        const samples = dataOf(request)['samples'] as {
          reviews: { action: string; comment: string }[];
        }[];
        expect(samples.flatMap((sample) => sample.reviews)).toContainEqual({
          action: 'reject',
          comment: 'The findings need sources.',
        });
        expect(
          (
            await h.admin.query<{ project_id: string }>(
              'select project_id from model_invocations where id = $1',
              [researcher.invocationId],
            )
          ).rows[0]!.project_id,
        ).toBe(projectId);
        const missing = await h.request('POST', api('/brain-reports'), {
          cookie,
          payload: { projectId: '00000000-0000-4000-8000-000000000000', modelEvaluation: true },
        });
        expect(missing.statusCode).toBe(404);
      }, 120_000);

      it('EVL-004: findings without valid evidence are discarded, never repaired', async () => {
        temporal.fake.responder = (request) => {
          captured.push(request);
          if (request.responseSchema?.name !== 'brain_role_evaluation')
            return fakeResponder(request);
          return {
            score: 2,
            summary: 'Mostly off charter.',
            findings: [
              {
                kind: 'deviation',
                severity: 'high',
                detail: 'Cites a sample that does not exist.',
                recommendation: 'x',
                clauseRefs: ['P1'],
                sampleRefs: ['S99'],
              },
              {
                kind: 'deviation',
                severity: 'high',
                detail: 'Cites a clause that does not exist.',
                recommendation: 'x',
                clauseRefs: ['P99'],
                sampleRefs: ['S1'],
              },
              {
                kind: 'deviation',
                severity: 'medium',
                detail: 'No evidence at all.',
                recommendation: 'x',
                clauseRefs: [],
                sampleRefs: [],
              },
              {
                kind: 'deviation',
                severity: 'high',
                detail: 'The first sample breaks the first principle.',
                recommendation: 'Tighten the prompt.',
                clauseRefs: ['p1', 'P99'],
                sampleRefs: ['S1', 'S99'],
              },
            ],
          };
        };
        const report = await post_({ modelEvaluation: true });
        const researcher = report.evaluations.find((item) => item.role === 'researcher')!;
        expect(researcher).toMatchObject({ status: 'completed', score: 2, discarded: 3 });
        expect(researcher.findings).toHaveLength(1);
        expect(researcher.findings[0]!.clauses.map((item) => item.ref)).toEqual(['P1']);
        expect(researcher.findings[0]!.evidence.map((item) => item.ref)).toEqual(['S1']);
        expect(report.summary.modelEvaluation!.discardedFindings).toBe(
          report.evaluations.reduce((sum, item) => sum + item.discarded, 0),
        );
      });

      it('EVL-005: an unusable answer or a provider failure fails that role only, and the report is still stored', async () => {
        temporal.fake.responder = (request) => {
          captured.push(request);
          if (request.responseSchema?.name !== 'brain_role_evaluation')
            return fakeResponder(request);
          return roleOfRequest(request) === 'analyst'
            ? { score: 9, summary: 'Out of range.', findings: [] }
            : fakeResponder(request);
        };
        const invalid = await post_({ modelEvaluation: true });
        expect(invalid.evaluations.find((item) => item.role === 'analyst')).toMatchObject({
          status: 'failed',
          reason: 'invalid_output',
          score: null,
          findings: [],
        });
        expect(invalid.evaluations.find((item) => item.role === 'researcher')!.status).toBe(
          'completed',
        );
        expect(invalid.summary.modelEvaluation).toMatchObject({ completed: 2, failed: 1 });
        expect(invalid.deviations).toBeDefined();

        temporal.fakeScript = (request) =>
          request.responseSchema?.name === 'brain_role_evaluation' ? 'permanent' : null;
        const failed = await post_({ modelEvaluation: true });
        for (const role of ['analyst', 'researcher', 'ideator']) {
          expect(failed.evaluations.find((item) => item.role === role)).toMatchObject({
            status: 'failed',
            reason: 'provider_failure',
            score: null,
          });
          expect(failed.evaluations.find((item) => item.role === role)!.errorCode).toBeTruthy();
        }
        expect(failed.summary.modelEvaluation).toMatchObject({
          completed: 0,
          skipped: 2,
          failed: 3,
        });
        const failedCalls = await h.admin.query<{ count: number }>(
          `select count(*)::int as count from model_invocations
            where workspace_id = $1 and purpose like 'brain:evaluate:%' and status = 'permanent_failed'`,
          [h.ids.workspaceA],
        );
        expect(failedCalls.rows[0]!.count).toBeGreaterThanOrEqual(3);
      });

      it('EVL-006: without a configured model every role with samples is skipped, with the reason', async () => {
        const connection = (await get<{ items: { id: string }[] }>('/provider-connections'))
          .items[0]!.id;
        await setting('ai.connection_id', '');
        try {
          captured.length = 0;
          const report = await post_({ modelEvaluation: true });
          expect(
            captured.filter((request) => request.responseSchema?.name === 'brain_role_evaluation'),
          ).toEqual([]);
          const statuses = report.evaluations.map((item) => [item.role, item.status, item.reason]);
          expect(statuses).toEqual([
            ['analyst', 'skipped', 'ai_not_configured'],
            ['researcher', 'skipped', 'ai_not_configured'],
            ['ideator', 'skipped', 'ai_not_configured'],
            ['documenter', 'skipped', 'no_samples'],
            ['evaluator', 'skipped', 'no_samples'],
          ]);
          expect(report.summary.modelEvaluation).toMatchObject({
            completed: 0,
            skipped: 5,
            failed: 0,
          });
        } finally {
          await setting('ai.connection_id', connection);
        }
      });

      it('EVL-007: outputs of another charter version are not judged against this one', async () => {
        const original = (
          await get<{ definition: { id: string; sequence: number } }>('/agent-roles/researcher')
        ).definition;
        const next = await researcherVersion(
          defaultDefinition('researcher').tools.filter((tool) => tool !== 'web_read'),
        );
        try {
          const projectId = await reachResearch('v3');
          const report = await post_({ modelEvaluation: true });
          const researcher = report.evaluations.find((item) => item.role === 'researcher')!;
          // The newest outputs ran with the new version; older ones ran with another and are left out.
          expect(researcher.charterVersionId).toBe(next);
          expect(researcher.charterSequence).toBeGreaterThan(original.sequence);
          const used = await h.admin.query<{ version_id: string }>(
            `select a.agent_definition_version_id as version_id from stage_outputs o
               join stage_attempts a on a.id = o.attempt_id where o.id = any($1::uuid[])`,
            [researcher.samples.map((sample) => sample.outputId)],
          );
          expect(new Set(used.rows.map((row) => row.version_id))).toEqual(new Set([next]));
          expect(researcher.samples.length).toBeGreaterThan(0);
          expect(projectId).toBeTruthy();
        } finally {
          await activateResearcher(original.id);
        }
      }, 120_000);
    });
  },
);
