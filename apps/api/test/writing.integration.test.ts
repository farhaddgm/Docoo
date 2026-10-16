import { defaultDefinition } from '@docoo/domain';
import { documentWritingWorkflowId, fakeResponder } from '@docoo/orchestration';
import { ProviderError, type NormalizedModelRequest } from '@docoo/providers';
import { Worker } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { TemporalTestRuntime } from './support/harness.js';
import { adminUrl, createHarness, temporalAddress, type Harness } from './support/harness.js';

interface Block {
  id: string;
  type: string;
  level?: number;
  text?: string;
  runs?: { text: string; citations?: string[] }[];
  entries?: { id: string; text: string }[];
  kind?: string;
  items?: string[];
}
interface Content {
  title: string;
  language: string;
  blocks: Block[];
}
interface Writing {
  id: string;
  status: string;
  phase: string;
  level: number;
  templateVersion: string;
  blockCode: string | null;
  errorCode: string | null;
  resultVersionId: string | null;
  withinBounds: boolean | null;
  flags: string[];
  progress: {
    total: number;
    written: number;
    subsections: { id: string; state: string; letters: number | null; target: number }[];
  };
  report: {
    count: number;
    withinBounds: boolean;
    deviation: number;
    fitRounds: number;
    subsections: number;
    modelCalls: number;
    citations: { proposed: number; verified: number; discarded: { reason: string }[] };
    references: number;
    discardedBlocks: number;
    notes: string[];
  } | null;
  cost: { usd: number | null; modelCalls: number };
}
interface DocumentView {
  id: string;
  status: string;
  version: number;
  level: number;
  currentVersion: {
    id: string;
    versionNo: number;
    charCount: number;
    withinBounds: boolean;
    origin: string;
    reason: string | null;
    content: Content;
  };
}

const CHURN =
  'Repeat customer churn falls when support answers within one hour because customers who wait leave.';

let h: Harness;
let cookie: string;
let temporal: TemporalTestRuntime;
let topicId: string;
let codeCounter = 0;
const captured: NormalizedModelRequest[] = [];
const api = (suffix: string) => `/v1/workspaces/${h.ids.workspaceA}${suffix}`;

async function get<T>(path: string): Promise<T> {
  const response = await h.request('GET', api(path), { cookie });
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

async function knowledge(title: string, content: string): Promise<string> {
  const created = await post<{ knowledge: { id: string } }>('/knowledge', {
    title,
    sourceType: 'admin_provided',
    provenance: {
      declaration: 'Approved by the churn committee',
      sourceCitation: {
        title: 'Synthetic source attribution fixture',
        author: 'Declared fixture author',
        publisher: 'Fixture publisher',
        publishedAt: '2026-10-13',
        url: 'https://example.org/synthetic-source',
      },
    },
    scopes: [{ type: 'workspace', id: h.ids.workspaceA }],
    content,
  });
  const audited = await post<{ review: { decision: string } }>(
    `/knowledge/${created.knowledge.id}/submit-audit`,
    {},
    200,
  );
  expect(audited.review.decision).toBe('approved');
  return created.knowledge.id;
}

/** A project with one selected solution; returns the document of that solution. */
async function documentFor(prefix: string): Promise<{ projectId: string; documentId: string }> {
  codeCounter += 1;
  const project = await post<{ project: { id: string } }>('/projects', {
    code: `${prefix}-${codeCounter}`,
    title: `Project ${prefix}`,
    initialProblem: 'Reduce repeat-customer churn by 20%.',
    topics: [{ topicId }],
  });
  const projectId = project.project.id;
  const generated = await post<{ solutionSet: { items: { id: string }[] } }>(
    `/projects/${projectId}/solutions/generate`,
    { count: 2 },
  );
  await post(`/projects/${projectId}/solution-selections`, {
    solutionIds: [generated.solutionSet.items[0]!.id],
    reason: 'The strongest option',
  });
  const list = await get<{ items: { id: string }[] }>(`/projects/${projectId}/documents`);
  return { projectId, documentId: list.items[0]!.id };
}

async function approvedDefinition(
  projectId: string,
  content: Record<string, unknown>,
  versionNo = 1,
) {
  let stageId: string;
  if (versionNo === 1) {
    const run = await h.admin.query<{ id: string }>(
      `insert into workflow_runs (workspace_id,project_id,run_no,temporal_workflow_id) values ($1,$2,1,$3) returning id`,
      [h.ids.workspaceA, projectId, `writing-conditions-${projectId}`],
    );
    const stage = await h.admin.query<{ id: string }>(
      `insert into stage_runs (workspace_id,project_id,run_id,stage,sequence,status) values ($1,$2,$3,'analysis',1,'completed') returning id`,
      [h.ids.workspaceA, projectId, run.rows[0]!.id],
    );
    stageId = stage.rows[0]!.id;
  } else {
    stageId = (
      await h.admin.query<{ id: string }>(
        `select id from stage_runs where project_id=$1 and stage='analysis'`,
        [projectId],
      )
    ).rows[0]!.id;
  }
  const json = JSON.stringify(content);
  const output = await h.admin.query<{ id: string }>(
    `insert into stage_outputs (workspace_id,stage_run_id,version_no,content,content_sha256,origin) values ($1,$2,$3,$4::jsonb,$5,'model') returning id`,
    [h.ids.workspaceA, stageId, versionNo, json, createHash('sha256').update(json).digest('hex')],
  );
  const id = output.rows[0]!.id;
  await h.admin.query('update projects set approved_problem_version_id=$2 where id=$1', [
    projectId,
    id,
  ]);
  return id;
}

const documentView = async (documentId: string) =>
  (await get<{ document: DocumentView }>(`/documents/${documentId}`)).document;

async function startWriting(documentId: string, payload: unknown = {}, expected = 201) {
  return post<{ writing: Writing }>(`/documents/${documentId}/writings`, payload, expected);
}

const TERMINAL = ['succeeded', 'failed', 'cancelled'];

async function waitForWriting(
  documentId: string,
  writingId: string,
  done: (writing: Writing) => boolean = (writing) => TERMINAL.includes(writing.status),
): Promise<Writing> {
  const deadline = Date.now() + 60_000;
  let last: Writing | null = null;
  while (Date.now() < deadline) {
    last = (await get<{ writing: Writing }>(`/documents/${documentId}/writings/${writingId}`))
      .writing;
    if (done(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const row = (
    await h.admin.query<{ temporal_workflow_id: string }>(
      'select temporal_workflow_id from document_writings where id=$1',
      [writingId],
    )
  ).rows[0];
  const history = row
    ? await temporal.client.workflow.getHandle(row.temporal_workflow_id).fetchHistory()
    : null;
  const tail = history?.events
    ?.slice(-15)
    .map((event) => ({
      id: String(event.eventId),
      type: event.eventType,
      activity: event.activityTaskScheduledEventAttributes?.activityType?.name,
      retryState: event.activityTaskTimedOutEventAttributes?.retryState,
    }));
  throw new Error(
    `Timed out waiting for the writing: ${JSON.stringify({ writing: last, historyTail: tail })}`,
  );
}

async function written(documentId: string, payload: unknown = {}) {
  const started = await startWriting(documentId, payload);
  return waitForWriting(documentId, started.writing.id);
}

const blocksOf = (content: Content) => content.blocks;
const dataOf = (request: NormalizedModelRequest) =>
  JSON.parse(request.messages[0]!.content.slice('<data>'.length, -'</data>'.length)) as Record<
    string,
    unknown
  >;
const sectionCalls = () =>
  captured.filter((request) => request.responseSchema?.name === 'document_section');

async function toolCalls(writingId: string, tool?: string) {
  const rows = await h.admin.query<{
    tool: string;
    decision: string;
    role: string;
    agent_definition_version_id: string;
    output_ref: { type: string; id: string } | null;
    error_code: string | null;
  }>(
    `select tool, decision::text as decision, role::text as role, agent_definition_version_id, output_ref, error_code
       from agent_tool_calls where writing_id = $1 and ($2::text is null or tool = $2) order by created_at, id`,
    [writingId, tool ?? null],
  );
  return rows.rows;
}

/** Gives the documenter a new active version that allows exactly these tools, and pins the project. */
async function documenterTools(projectId: string, tools: string[]): Promise<string> {
  const created = await post<{ definition: { id: string } }>(
    '/agent-roles/documenter/definitions',
    { changes: { tools }, reason: 'Change the allowed tools' },
  );
  await post(
    `/agent-roles/documenter/definitions/${created.definition.id}/activate`,
    { reason: 'Use this version' },
    200,
  );
  await post(`/projects/${projectId}/agents/documenter/pin`, { reason: 'Follow the default' }, 200);
  return created.definition.id;
}

const ALL_TOOLS = defaultDefinition('documenter').tools as string[];

// Writings run real workflows; with the whole suite running in parallel the default 5 s is too short.
describe.skipIf(!adminUrl || !temporalAddress)(
  'the documenter writes a document (DOC-W*, ADR-0019)',
  { timeout: 120_000 },
  () => {
    beforeAll(async () => {
      h = await createHarness('writing', { workflow: true });
      temporal = h.engine as TemporalTestRuntime;
      cookie = await h.login(h.emails.a);
      topicId = (
        await post<{ topic: { id: string } }>('/topics', { code: 'retail', title: 'Retail' })
      ).topic.id;
      const connection = await post<{ connection: { id: string } }>('/provider-connections', {
        provider: 'fake',
        name: 'Deterministic',
      });
      await setting('ai.connection_id', connection.connection.id);
      await setting('ai.model', 'fake-standard');
      await knowledge('Support response and churn', CHURN);
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
      temporal.afterWritingBlocked = null;
    });
    afterAll(async () => {
      await h?.close();
    });

    it('DOC-W1: writes the whole document inside its level, with verified citations and a report', async () => {
      const { documentId } = await documentFor('w1');
      const before = await documentView(documentId);
      const started = await startWriting(documentId, {
        level: 1,
        template: 'standard',
        notes: 'Mention the pilot.',
      });
      expect(started.writing.status).toMatch(/queued|running/u);
      const writing = await waitForWriting(documentId, started.writing.id);
      expect(writing.status, JSON.stringify(writing)).toBe('succeeded');
      expect(writing.templateVersion).toBe('standard-v1');
      expect(writing.progress.written).toBe(writing.progress.total);

      const after = await documentView(documentId);
      expect(after.currentVersion.versionNo).toBe(before.currentVersion.versionNo + 1);
      expect(after.currentVersion.origin).toBe('model');
      expect(after.currentVersion.reason).toContain('Written by the documenter');
      expect(after.currentVersion.withinBounds).toBe(true);
      expect(after.currentVersion.charCount).toBeGreaterThanOrEqual(1000);
      expect(after.currentVersion.charCount).toBeLessThanOrEqual(3000);
      expect(after.status).toBe('draft');
      expect(after.level).toBe(1);

      // The template's sections are the level-1 headings, in order.
      const headings = blocksOf(after.currentVersion.content)
        .filter((block) => block.type === 'heading' && block.level === 1)
        .map((block) => block.id);
      expect(headings).toEqual(['summary', 'assumptions', 'evidence', 'plan', 'risks']);

      // The approved passage was cited with a verified quote and became the only reference.
      const bibliography = blocksOf(after.currentVersion.content).find(
        (block) => block.type === 'bibliography',
      );
      expect(bibliography?.entries).toHaveLength(1);
      expect(bibliography!.entries![0]!.text).toContain('Support response and churn');
      expect(bibliography!.entries![0]!.text).toContain('Synthetic source attribution fixture');
      expect(bibliography!.entries![0]).toMatchObject({
        url: 'https://example.org/synthetic-source',
      });
      for (const format of ['docx', 'pptx']) {
        const exported = await post<{ artifact: { id: string } }>(
          `/documents/${documentId}/exports`,
          { format },
        );
        const downloaded = await h.request(
          'GET',
          api(`/documents/${documentId}/artifacts/${exported.artifact.id}/download`),
          { cookie },
        );
        expect(downloaded.statusCode).toBe(200);
        const xml = Object.entries(unzipSync(downloaded.rawPayload))
          .filter(([name]) => name.endsWith('.xml'))
          .map(([, bytes]) => strFromU8(bytes))
          .join('');
        expect(xml).toContain('https://example.org/synthetic-source');
        expect(xml).toContain('Synthetic source attribution fixture');
      }
      const cited = blocksOf(after.currentVersion.content)
        .flatMap((block) => block.runs ?? [])
        .flatMap((run) => run.citations ?? []);
      expect(cited).toContain(bibliography!.entries![0]!.id);

      expect(writing.report).toMatchObject({
        withinBounds: true,
        deviation: 0,
        references: 1,
        citations: { discarded: [] },
      });
      expect(writing.report!.citations.verified).toBeGreaterThan(0);
      expect(writing.report!.count).toBe(after.currentVersion.charCount);
      expect(writing.report!.modelCalls).toBeGreaterThan(0);
      expect(writing.cost.modelCalls).toBe(writing.report!.modelCalls);

      // The administrator's notes reached the model as data, never as instructions.
      const first = sectionCalls()[0]!;
      expect(dataOf(first)['notesFromTheAdministrator']).toBe('Mention the pilot.');
      expect(first.instructions).not.toContain('Mention the pilot.');
      expect(first.responseSchema?.name).toBe('document_section');

      // The ledger: the documenter read the project through its gate and retrieved knowledge.
      const calls = await toolCalls(writing.id);
      expect(calls.every((call) => call.role === 'documenter' && call.decision === 'allowed')).toBe(
        true,
      );
      expect(calls.map((call) => call.tool)).toContain('project_documents_read');
      expect(calls.filter((call) => call.tool === 'knowledge_retrieve').length).toBeGreaterThan(0);
      expect(calls.find((call) => call.tool === 'knowledge_retrieve')?.output_ref?.type).toBe(
        'retrieval_snapshot',
      );
      expect(new Set(calls.map((call) => call.agent_definition_version_id)).size).toBe(1);

      // Every model call names the writing and the definition version it ran with.
      const invocations = await h.admin.query<{
        purpose: string;
        writing_id: string;
        agent_definition_version_id: string;
        prompt_sha256: string;
      }>(
        'select purpose, writing_id, agent_definition_version_id, prompt_sha256 from model_invocations where writing_id = $1',
        [writing.id],
      );
      expect(invocations.rowCount).toBeGreaterThan(0);
      expect(invocations.rows.every((row) => row.purpose.startsWith('document_writing:'))).toBe(
        true,
      );
      expect(invocations.rows.every((row) => /^[0-9a-f]{64}$/u.test(row.prompt_sha256))).toBe(true);

      // The version points back at the writing; the audit log records the run.
      const version = await h.admin.query<{ writing_id: string }>(
        'select writing_id from document_versions where id = $1',
        [after.currentVersion.id],
      );
      expect(version.rows[0]!.writing_id).toBe(writing.id);
      const audited = await h.admin.query<{ action: string }>(
        `select action from audit_events where target_id = $1 and (action like 'document.writing%' or action = 'document.written')`,
        [documentId],
      );
      expect(audited.rows.map((row) => row.action)).toEqual(
        expect.arrayContaining([
          'document.writing_requested',
          'document.writing_started',
          'document.written',
        ]),
      );
    });

    it('DOC-W12: refuses a length that cannot contain the approved conditions before starting a writing', async () => {
      const { projectId, documentId } = await documentFor('w12');
      const fixture = JSON.parse(
        readFileSync(
          new URL(
            '../../../qa/regressions/short-writing/approved-synthetic-cafe.json',
            import.meta.url,
          ),
          'utf8',
        ),
      ) as { problem: Record<string, unknown> };
      await approvedDefinition(projectId, fixture.problem);
      const before = await documentView(documentId);
      const rejected = await post<{
        code: string;
        conditionsLetters: number;
        suggestedLevel: number;
      }>(`/documents/${documentId}/writings`, { level: 1 }, 422);
      expect(rejected.code).toBe('DOCUMENT_LEVEL_TOO_SHORT');
      expect(rejected.conditionsLetters).toBeGreaterThan(3000);
      expect(rejected.suggestedLevel).toBeGreaterThan(1);
      expect((await get<{ items: Writing[] }>(`/documents/${documentId}/writings`)).items).toEqual(
        [],
      );
      expect(sectionCalls()).toEqual([]);
      expect((await documentView(documentId)).currentVersion.id).toBe(before.currentVersion.id);
    });

    it('DOC-W13: preserves pinned approved conditions even when model prose omits them and the project definition changes', async () => {
      const { projectId, documentId } = await documentFor('w13');
      const constraints = [
        'Synthetic declared endpoint: absolute30%; margin floor58.8%.',
        'SEK12000 total; four combined staff hours weekly.',
        'Voluntary anonymous adults18+; no IDs; groups>=10; delete forms weekly.',
      ];
      const pinnedId = await approvedDefinition(projectId, {
        problemStatement: 'Original synthetic problem',
        constraints,
      });
      await temporal.stopWorker();
      let started: { writing: Writing };
      try {
        started = await startWriting(documentId, { level: 1 });
        await approvedDefinition(
          projectId,
          { problemStatement: 'Later version', constraints: ['Changed endpoint 99%'] },
          2,
        );
      } finally {
        await temporal.startWorker();
      }
      const done = await waitForWriting(documentId, started!.writing.id);
      expect(done.status, JSON.stringify(done)).toBe('succeeded');
      const view = await documentView(documentId);
      const conditions = view.currentVersion.content.blocks.find(
        (block) => block.id === 'approved-decision-condition-list',
      ) as Block & { items: string[] };
      expect(conditions.items).toEqual(constraints);
      expect(view.currentVersion.withinBounds).toBe(true);
      for (const request of sectionCalls()) {
        const problem = dataOf(request)['problem'] as {
          problemStatement: string;
          constraints: string[];
        };
        expect(problem.problemStatement).toBe('Original synthetic problem');
        expect(problem.constraints).toEqual(constraints);
      }
      const settings = (
        await h.admin.query<{ settings: { approvedProblemVersionId: string } }>(
          'select settings from document_writings where id=$1',
          [done.id],
        )
      ).rows[0]!.settings;
      expect(settings.approvedProblemVersionId).toBe(pinnedId);
      for (const format of ['docx', 'pptx']) {
        const exported = await post<{ artifact: { id: string } }>(
          `/documents/${documentId}/exports`,
          { format },
        );
        const downloaded = await h.request(
          'GET',
          api(`/documents/${documentId}/artifacts/${exported.artifact.id}/download`),
          { cookie },
        );
        expect(downloaded.statusCode).toBe(200);
        const xml = Object.entries(unzipSync(downloaded.rawPayload))
          .filter(([name]) => name.endsWith('.xml'))
          .map(([, bytes]) => strFromU8(bytes))
          .join('');
        expect(xml).toContain('absolute30%');
        expect(xml).toContain('four combined staff hours weekly');
      }
    });

    it('DOC-W14: rejects unsafe source attribution before creating knowledge', async () => {
      const rejected = await h.request('POST', api('/knowledge'), {
        cookie,
        payload: {
          title: 'Unsafe attribution fixture',
          sourceType: 'admin_provided',
          scopes: [{ type: 'workspace', id: h.ids.workspaceA }],
          content: CHURN,
          provenance: {
            declaration: 'Synthetic',
            sourceCitation: { title: 'Declared title', url: 'javascript:alert(1)' },
          },
        },
      });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json<{ code: string }>().code).toBe('KNOWLEDGE_INVALID_REQUEST');
    });

    it('DOC-W2: a detailed level-3 document builds its score table and chart itself', async () => {
      const { documentId } = await documentFor('w2');
      const writing = await written(documentId, { level: 3, template: 'detailed' });
      expect(writing.status, JSON.stringify(writing)).toBe('succeeded');
      const content = (await documentView(documentId)).currentVersion.content;
      const scores = blocksOf(content).filter((block) =>
        ['scores-table', 'scores-chart'].includes(block.id),
      );
      expect(scores.map((block) => block.type)).toEqual(['table', 'chart']);
      expect(writing.report!.subsections).toBeGreaterThanOrEqual(7);
      expect(writing.report!.withinBounds).toBe(true);
      const view = await documentView(documentId);
      expect(view.currentVersion.charCount).toBeGreaterThanOrEqual(9000);
      expect(view.currentVersion.charCount).toBeLessThanOrEqual(11000);
      // The model was never asked to write the numbers of the score table.
      expect(
        sectionCalls().every(
          (request) => !JSON.stringify(dataOf(request)).includes('scores-table'),
        ),
      ).toBe(true);
    });

    it('DOC-W2b: a level-5 document is outlined first and long sections are written in several subsections', async () => {
      const { documentId } = await documentFor('w2b');
      const writing = await written(documentId, { level: 5, template: 'standard' });
      expect(writing.status, JSON.stringify(writing)).toBe('succeeded');
      expect(captured.some((request) => request.responseSchema?.name === 'document_outline')).toBe(
        true,
      );
      const view = await documentView(documentId);
      const sub = blocksOf(view.currentVersion.content).filter(
        (block) => block.type === 'heading' && block.level === 2,
      );
      expect(sub.length).toBeGreaterThanOrEqual(4);
      expect(writing.report!.subsections).toBeGreaterThan(5);
      expect(writing.report!.withinBounds, JSON.stringify(writing.report)).toBe(true);
      expect(view.currentVersion.charCount).toBeGreaterThanOrEqual(22000);
      expect(view.currentVersion.charCount).toBeLessThanOrEqual(28000);
    });

    it('DOC-W3: a document that came out short is brought into its bounds by expanding subsections', async () => {
      const { documentId } = await documentFor('w3');
      temporal.fake.responder = (request) => {
        captured.push(request);
        const data = dataOf(request);
        const budget = data['budget'] as { targetLetters?: number } | undefined;
        if (
          request.responseSchema?.name === 'document_section' &&
          data['call'] === 'section' &&
          budget?.targetLetters
        ) {
          // The first answers are far too short.
          const shortened = {
            ...data,
            budget: { ...budget, targetLetters: Math.round(budget.targetLetters * 0.2) },
          };
          return fakeResponder({
            ...request,
            messages: [{ role: 'user', content: `<data>${JSON.stringify(shortened)}</data>` }],
          });
        }
        return fakeResponder(request);
      };
      const writing = await written(documentId, { level: 2, template: 'standard' });
      expect(writing.status, JSON.stringify(writing)).toBe('succeeded');
      expect(writing.report!.fitRounds).toBeGreaterThanOrEqual(1);
      expect(writing.report!.withinBounds).toBe(true);
      expect(captured.some((request) => dataOf(request)['call'] === 'expand')).toBe(true);
      const view = await documentView(documentId);
      expect(view.currentVersion.charCount).toBeGreaterThanOrEqual(5000);
      expect(view.currentVersion.charCount).toBeLessThanOrEqual(7000);
    });

    it('DOC-W4: fitting can be switched off and an unreachable length is reported, never padded', async () => {
      const { projectId, documentId } = await documentFor('w4');
      const response = await h.request('PUT', api('/settings/assignments'), {
        cookie,
        payload: {
          key: 'document.writing.fit_rounds',
          scopeType: 'project',
          scopeId: projectId,
          value: 0,
          reason: 'No fitting for this project',
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      temporal.fake.responder = (request) => {
        captured.push(request);
        const data = dataOf(request);
        const budget = data['budget'] as { targetLetters?: number } | undefined;
        if (request.responseSchema?.name === 'document_section' && budget?.targetLetters) {
          const shortened = { ...data, budget: { ...budget, targetLetters: 100 } };
          return fakeResponder({
            ...request,
            messages: [{ role: 'user', content: `<data>${JSON.stringify(shortened)}</data>` }],
          });
        }
        return fakeResponder(request);
      };
      const writing = await written(documentId, { level: 3, template: 'brief' });
      expect(writing.status).toBe('succeeded');
      expect(writing.report!.fitRounds).toBe(0);
      expect(writing.report!.withinBounds).toBe(false);
      expect(writing.report!.deviation).toBeLessThan(0);
      expect(writing.report!.notes).toContain('left_short');
      expect(
        captured.some((request) =>
          ['expand', 'condense'].includes(String(dataOf(request)['call'])),
        ),
      ).toBe(false);
      const view = await documentView(documentId);
      expect(view.currentVersion.withinBounds).toBe(false);
      // Not compliant: submitting it makes it non_compliant, so it cannot be approved (FR-DOC-004).
      const submitted = await post<{ document: { status: string } }>(
        `/documents/${documentId}/submit`,
        {},
        200,
      );
      expect(submitted.document.status).toBe('non_compliant');
    });

    it('DOC-W5: the tool gate decides what the documenter may do, and every denial is recorded', async () => {
      const { projectId, documentId } = await documentFor('w5');
      await documenterTools(projectId, ['project_documents_read']);
      const writing = await written(documentId, { level: 1, template: 'standard' });
      expect(writing.status, JSON.stringify(writing)).toBe('succeeded');
      const content = (await documentView(documentId)).currentVersion.content;
      // No knowledge, no verifier, no tables: nothing is cited and nothing tabular appears.
      expect(blocksOf(content).some((block) => block.type === 'bibliography')).toBe(false);
      expect(blocksOf(content).some((block) => ['table', 'chart'].includes(block.type))).toBe(
        false,
      );
      expect(writing.report!.notes).toContain('knowledge_retrieve_denied');
      const denied = (await toolCalls(writing.id, 'knowledge_retrieve')).filter(
        (call) => call.decision === 'denied',
      );
      expect(denied).toHaveLength(1);
      expect(denied[0]!.error_code).toBe('tool_not_allowed');
      expect(sectionCalls().every((request) => !('approvedKnowledge' in dataOf(request)))).toBe(
        true,
      );
      expect(sectionCalls()[0]!.instructions).toContain('Tables and charts are not allowed');
    });

    it('DOC-W6: with knowledge but without the verifier no citation counts', async () => {
      const { projectId, documentId } = await documentFor('w6');
      await documenterTools(projectId, [
        'project_documents_read',
        'knowledge_retrieve',
        'table_chart_spec',
      ]);
      const writing = await written(documentId, { level: 1 });
      expect(writing.status, JSON.stringify(writing)).toBe('succeeded');
      const content = (await documentView(documentId)).currentVersion.content;
      expect(blocksOf(content).some((block) => block.type === 'bibliography')).toBe(false);
      expect(writing.report!.citations.verified).toBe(0);
      expect(
        writing.report!.citations.discarded.every((item) => item.reason === 'verifier_not_allowed'),
      ).toBe(true);
      expect(writing.report!.citations.discarded.length).toBeGreaterThan(0);
    });

    it('DOC-W7: without project_documents_read the writing pauses and goes on once the tool is allowed', async () => {
      const { projectId, documentId } = await documentFor('w7');
      await documenterTools(projectId, ['knowledge_retrieve', 'citation_verifier']);
      const started = await startWriting(documentId, { level: 1 });
      const paused = await waitForWriting(
        documentId,
        started.writing.id,
        (writing) => writing.status === 'paused',
      );
      expect(paused.blockCode).toBe('tool_not_allowed:project_documents_read');
      const denied = await toolCalls(paused.id, 'project_documents_read');
      expect(denied.map((call) => call.decision)).toEqual(['denied']);
      expect(sectionCalls()).toHaveLength(0);

      // While it waits, the document cannot be changed behind its back.
      const edit = await h.request('PUT', api(`/documents/${documentId}/content`), {
        cookie,
        headers: { 'if-match': `"${(await documentView(documentId)).version}"` },
        payload: { content: { title: 'x', language: 'en', blocks: [] }, reason: 'try' },
      });
      expect(edit.statusCode).toBe(409);
      expect(edit.json<{ code: string }>().code).toBe('DOCUMENT_WRITING_ACTIVE');
      const second = await h.request('POST', api(`/documents/${documentId}/writings`), {
        cookie,
        payload: {},
      });
      expect(second.statusCode).toBe(409);

      await documenterTools(projectId, ALL_TOOLS);
      await post(`/documents/${documentId}/writings/${paused.id}/resume`, {}, 200);
      const done = await waitForWriting(documentId, paused.id);
      expect(done.status, JSON.stringify(done)).toBe('succeeded');
      expect(done.blockCode).toBeNull();
    });

    it('DOC-W8: a transient provider failure retries; a permanent one pauses and can be resumed or cancelled', async () => {
      const { documentId } = await documentFor('w8');
      let failures = 0;
      temporal.fakeScript = (request) => {
        if (request.responseSchema?.name === 'document_section' && failures < 2) {
          failures += 1;
          throw new ProviderError('transient', 'provider_overloaded');
        }
        return null;
      };
      const retried = await written(documentId, { level: 1 });
      expect(retried.status, JSON.stringify(retried)).toBe('succeeded');
      const failed = await h.admin.query<{ status: string }>(
        `select status from model_invocations where writing_id = $1 and status <> 'succeeded'`,
        [retried.id],
      );
      expect(failed.rowCount).toBe(2);

      const second = await documentFor('w8b');
      temporal.fakeScript = (request) => {
        if (request.responseSchema?.name === 'document_section')
          throw new ProviderError('auth', 'bad_key');
        return null;
      };
      const started = await startWriting(second.documentId, { level: 1 });
      const paused = await waitForWriting(
        second.documentId,
        started.writing.id,
        (writing) => writing.status === 'paused',
      );
      expect(paused.blockCode).toBe('bad_key');
      temporal.fakeScript = () => null;
      await post(`/documents/${second.documentId}/writings/${paused.id}/resume`, {}, 200);
      expect((await waitForWriting(second.documentId, paused.id)).status).toBe('succeeded');

      // Cancel: nothing it wrote becomes a version and the document is free again.
      const third = await documentFor('w8c');
      temporal.fakeScript = (request) => {
        if (request.responseSchema?.name === 'document_section')
          throw new ProviderError('auth', 'bad_key');
        return null;
      };
      const startedThird = await startWriting(third.documentId, { level: 1 });
      const pausedThird = await waitForWriting(
        third.documentId,
        startedThird.writing.id,
        (writing) => writing.status === 'paused',
      );
      const versionsBefore = (
        await get<{ items: unknown[] }>(`/documents/${third.documentId}/versions`)
      ).items.length;
      const cancelled = await post<{ writing: Writing }>(
        `/documents/${third.documentId}/writings/${pausedThird.id}/cancel`,
        { reason: 'Not needed' },
        200,
      );
      const final = await waitForWriting(third.documentId, cancelled.writing.id);
      expect(final.status).toBe('cancelled');
      expect(
        (await get<{ items: unknown[] }>(`/documents/${third.documentId}/versions`)).items,
      ).toHaveLength(versionsBefore);
      temporal.fakeScript = () => null;
      const again = await startWriting(third.documentId, { level: 1 });
      expect((await waitForWriting(third.documentId, again.writing.id)).status).toBe('succeeded');
    });

    it.each(['resume', 'resumeThenCancel'] as const)(
      'DOC-W8R: %s received before writingBlock completes is preserved and the history replays',
      async (command) => {
        const { documentId } = await documentFor('w8-race');
        let release!: () => void;
        const barrier = new Promise<void>((resolve) => {
          release = resolve;
        });
        let held = false;
        temporal.afterWritingBlocked = async (ref) => {
          if (ref.documentId === documentId && !held) {
            held = true;
            await barrier;
          }
        };
        temporal.fakeScript = (request) => {
          if (request.responseSchema?.name === 'document_section')
            throw new ProviderError('auth', 'bad_key');
          return null;
        };
        try {
          const started = await startWriting(documentId, { level: 1 });
          await expect.poll(() => held, { timeout: 15_000 }).toBe(true);
          const paused = await waitForWriting(
            documentId,
            started.writing.id,
            (item) => item.status === 'paused',
          );
          expect(paused.blockCode).toBe('bad_key');
          temporal.fakeScript = () => null;
          await post(`/documents/${documentId}/writings/${paused.id}/resume`, {}, 200);
          const workflowId = documentWritingWorkflowId(paused.id);
          const handle = temporal.client.workflow.getHandle(workflowId);
          // Wait for the workflow to process the signal while the activity is still held.
          await expect
            .poll(
              async () => {
                const events = (await handle.fetchHistory()).events ?? [];
                const signal = events.find(
                  (event) =>
                    event.workflowExecutionSignaledEventAttributes?.signalName === 'resume',
                );
                return (
                  signal !== undefined &&
                  events.some(
                    (event) =>
                      event.workflowTaskCompletedEventAttributes !== undefined &&
                      Number(event.eventId) > Number(signal.eventId),
                  )
                );
              },
              { timeout: 15_000 },
            )
            .toBe(true);
          if (command === 'resumeThenCancel') {
            await post(
              `/documents/${documentId}/writings/${paused.id}/cancel`,
              { reason: 'Cancel while the pause activity is completing' },
              200,
            );
            await expect
              .poll(
                async () => {
                  const events = (await handle.fetchHistory()).events ?? [];
                  const signal = events.find(
                    (event) =>
                      event.workflowExecutionSignaledEventAttributes?.signalName === 'cancel',
                  );
                  return (
                    signal !== undefined &&
                    events.some(
                      (event) =>
                        event.workflowTaskCompletedEventAttributes !== undefined &&
                        Number(event.eventId) > Number(signal.eventId),
                    )
                  );
                },
                { timeout: 15_000 },
              )
              .toBe(true);
          }
          release();
          const done = await waitForWriting(documentId, paused.id);
          expect(done.status, JSON.stringify(done)).toBe(
            command === 'resume' ? 'succeeded' : 'cancelled',
          );
          expect(done.blockCode).toBeNull();
          if (command === 'resumeThenCancel') expect(done.resultVersionId).toBeNull();
          await handle.result();
          await expect(
            Worker.runReplayHistory(
              {
                workflowsPath: fileURLToPath(import.meta.resolve('@docoo/orchestration/workflows')),
              },
              await handle.fetchHistory(),
              workflowId,
            ),
          ).resolves.toBeUndefined();
        } finally {
          release();
          temporal.afterWritingBlocked = null;
        }
      },
    );

    it.each([0, 25])(
      'DOC-W9: controlled worker restart after two persisted parts (drain delay %ims)',
      async (drainDelayMs) => {
        const { documentId } = await documentFor('w9-' + drainDelayMs);
        let calls = 0;
        let parts = 0;
        let release!: () => void;
        let entered!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        const secondStored = new Promise<void>((resolve) => {
          entered = resolve;
        });
        temporal.fake.responder = (request) => {
          captured.push(request);
          if (request.responseSchema?.name === 'document_section') calls += 1;
          return fakeResponder(request);
        };
        temporal.afterWritingPart = async () => {
          if (++parts === 2) {
            entered();
            await held;
          }
        };
        try {
          const started = await startWriting(documentId, { level: 3, template: 'detailed' });
          await secondStored;
          const partial = await waitForWriting(
            documentId,
            started.writing.id,
            (writing) => writing.progress.written === 2,
          );
          expect(partial.status).toBe('running');
          const stopped = temporal.stopWorker();
          // Shutdown starts while the second part is persisted but its activity has not returned.
          await new Promise((resolve) => setTimeout(resolve, drainDelayMs));
          release();
          await stopped;
          temporal.afterWritingPart = null;
          const beforeRestart = (
            await get<{ writing: Writing }>(
              `/documents/${documentId}/writings/${started.writing.id}`,
            )
          ).writing;
          expect(beforeRestart.progress.written).toBe(2);
          await temporal.startWorker();
          const done = await waitForWriting(documentId, started.writing.id);
          expect(done.status, JSON.stringify(done)).toBe('succeeded');
          expect(done.progress.subsections.every((item) => item.state !== 'pending')).toBe(true);
          expect(calls).toBeGreaterThanOrEqual(done.progress.total);
          process.stdout.write(
            JSON.stringify({
              test: 'writer-controlled-restart',
              drainDelayMs,
              persistedBeforeRestart: beforeRestart.progress.written,
              totalAfterRestart: done.progress.total,
              status: done.status,
            }) + '\n',
          );
        } finally {
          release();
          temporal.afterWritingPart = null;
        }
      },
    );

    it('DOC-W10: the dry-run check counts and validates an edit without saving it', async () => {
      const { documentId } = await documentFor('w10');
      const view = await documentView(documentId);
      const checked = await post<{
        check: {
          valid: boolean;
          compliance: { count: number; withinBounds: boolean; level: number };
          outline: { text: string }[];
          references: unknown[];
        };
      }>(`/documents/${documentId}/check`, { content: view.currentVersion.content }, 200);
      expect(checked.check.valid).toBe(true);
      expect(checked.check.compliance.count).toBe(view.currentVersion.charCount);
      expect(checked.check.outline.length).toBeGreaterThan(0);

      const broken = await post<{ check: { valid: boolean; problems: string[] } }>(
        `/documents/${documentId}/check`,
        {
          content: {
            title: 'x',
            language: 'en',
            blocks: [{ type: 'paragraph', id: 'p', runs: [{ text: 'a', citations: ['B9'] }] }],
          },
        },
        200,
      );
      expect(broken.check.valid).toBe(false);
      expect(broken.check.problems.join(' ')).toContain('B9');
      // Nothing was saved.
      expect((await documentView(documentId)).currentVersion.versionNo).toBe(
        view.currentVersion.versionNo,
      );
    });

    it('DOC-W11: a locked document, an unknown template and a missing solution are refused', async () => {
      const { documentId } = await documentFor('w11');
      const bad = await h.request('POST', api(`/documents/${documentId}/writings`), {
        cookie,
        payload: { template: 'fancy' },
      });
      expect(bad.statusCode).toBe(400);
      const view = await documentView(documentId);
      expect(view.currentVersion.versionNo).toBe(1);
      await h.admin.query(
        `update documents set status = 'locked', locked_at = now() where id = $1`,
        [documentId],
      );
      const locked = await h.request('POST', api(`/documents/${documentId}/writings`), {
        cookie,
        payload: {},
      });
      expect(locked.statusCode).toBe(409);
      expect(locked.json<{ code: string }>().code).toBe('DOCUMENT_LOCKED');
    });
  },
);
