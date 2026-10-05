import { fakeResponder } from '@docoo/orchestration';
import type { NormalizedModelRequest } from '@docoo/providers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AnalysisDriver } from './support/analysis.js';
import { FakeContenter, wePod } from './support/fake-contenter.js';
import type { TemporalTestRuntime } from './support/harness.js';
import { adminUrl, createHarness, temporalAddress, type Harness } from './support/harness.js';

let h: Harness;
let cookie: string;
let temporal: TemporalTestRuntime;
let analysis: AnalysisDriver;
let topicId: string;
let codeCounter = 0;
const contenter = new FakeContenter();
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

async function project(prefix: string, businessId?: string): Promise<string> {
  codeCounter += 1;
  const created = await post<{ project: { id: string } }>('/projects', {
    code: `${prefix}-${codeCounter}`,
    title: `Project ${prefix}`,
    initialProblem: 'Grow the number of digital loan applications.',
    topics: [{ topicId }],
    ...(businessId ? { businessId } : {}),
  });
  return created.project.id;
}

async function activate(projectId: string) {
  const current = await get<{ project: { version: number } }>(`/projects/${projectId}`);
  await post(`/projects/${projectId}/activate`, { expectedVersion: current.project.version }, 200);
}

interface StageView {
  id: string;
  stage: string;
  status: string;
  pendingGateOutputId: string | null;
}
interface Overview {
  stages: StageView[];
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

async function approve(projectId: string, stage: StageView) {
  const response = await h.request(
    'POST',
    api(`/projects/${projectId}/stages/${stage.id}/outputs/${stage.pendingGateOutputId}/approve`),
    { cookie, payload: {} },
  );
  expect(response.statusCode, response.body).toBe(200);
}

const dataOf = (request: NormalizedModelRequest) =>
  JSON.parse(request.messages[0]!.content.slice('<data>'.length, -'</data>'.length)) as Record<
    string,
    unknown
  >;
const requestsFor = (schema: string) =>
  captured.filter((request) => request.responseSchema?.name === schema);

interface Profile {
  name: string;
  sections: { key: string; confirmed: boolean; text: string }[];
  keyFacts: { label: string }[];
  terminology?: { term: string; rule: string }[];
  adminNotes: string[];
}
const profileOf = (request: NormalizedModelRequest) =>
  dataOf(request)['businessProfile'] as Profile | undefined;

const pinnedTo = async (projectId: string) =>
  (
    await h.admin.query<{ snapshot: string | null; version_no: number | null }>(
      `select r.business_snapshot_id as snapshot, s.version_no
         from workflow_runs r left join business_snapshots s on s.id = r.business_snapshot_id
        where r.project_id = $1 order by r.run_no desc limit 1`,
      [projectId],
    )
  ).rows[0]!;

describe.skipIf(!adminUrl || !temporalAddress)(
  'the agents work from the business of the project (ADR-0021)',
  { timeout: 120_000 },
  () => {
    beforeAll(async () => {
      await contenter.start();
      contenter.add(wePod());
      h = await createHarness('businessai', { workflow: true });
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
      const saved = await h.request('PUT', api('/integrations/contenter'), {
        cookie,
        payload: { apiUrl: contenter.apiUrl, token: contenter.token },
      });
      expect(saved.statusCode, saved.body).toBe(200);
    }, 90_000);

    beforeEach(() => {
      captured.length = 0;
      temporal.fake.responder = (request) => {
        captured.push(request);
        return fakeResponder(request);
      };
      contenter.mode = 'up';
    });
    afterEach(() => {
      temporal.fake.responder = fakeResponder;
    });
    afterAll(async () => {
      await h?.close();
      await contenter.stop();
    });

    it('BIZ-AI-001: the analyst and every stage are given the business, only their own part of it', async () => {
      const linked = await project('ai-linked', 'biz-wepod');
      const plain = await project('ai-plain');
      await activate(linked);
      await analysis.reachDefinition(linked);

      const rounds = requestsFor('analysis_round');
      expect(rounds.length).toBeGreaterThan(0);
      const profile = profileOf(rounds[0]!)!;
      expect(profile.name).toBe('WePod Digital Branch');
      // The analyst reads who the customers are and what the company wants, not how it writes.
      expect(profile.sections.map((section) => section.key)).toEqual([
        'OVERVIEW',
        'SERVICES',
        'TARGET_MARKET',
        'PERSONAS',
        'GUIDELINES',
        'GOALS',
      ]);
      expect(profile.sections.every((section) => section.confirmed)).toBe(true);
      // Only facts that still hold are given, and brand terminology is for the writer alone.
      expect(profile.keyFacts.map((fact) => fact.label)).toEqual(['Loan ceiling']);
      expect(profile.terminology).toBeUndefined();
      expect(profile.adminNotes).toEqual(['Always address customers formally.']);
      expect(rounds[0]!.instructions).toContain('authoritative description of the company');
      expect(rounds[0]!.instructions).toContain('do not ask what it answers');
      // The profile is data, never instructions: it is not in the instructions.
      expect(rounds[0]!.instructions).not.toContain('Sara');
      expect(JSON.stringify(dataOf(rounds[0]!))).toContain('Sara');

      // The analysis stage that writes the definition gets it too.
      const view = await waitFor(linked, waiting('analysis'), 'analysis gate');
      expect(profileOf(requestsFor('analysis_output')[0]!)!.name).toBe('WePod Digital Branch');
      await approve(linked, stageOf(view, 'analysis'));
      await waitFor(linked, waiting('research'), 'research gate');
      const research = profileOf(requestsFor('research_output')[0]!)!;
      expect(research.sections.map((section) => section.key)).toEqual([
        'OVERVIEW',
        'SERVICES',
        'TARGET_MARKET',
        'GUIDELINES',
        'GOALS',
      ]);

      // Every call that carried the business says which version, so it can be audited later.
      const pinned = await pinnedTo(linked);
      expect(pinned.version_no).toBe(1);
      const calls = await h.admin.query<{ purpose: string; business_snapshot_id: string | null }>(
        `select purpose, business_snapshot_id from model_invocations where project_id = $1 and purpose not like 'brain%'`,
        [linked],
      );
      expect(calls.rows.length).toBeGreaterThan(0);
      for (const call of calls.rows)
        expect(call.business_snapshot_id, call.purpose).toBe(pinned.snapshot);

      // A project of no business reads none, and says nothing about one.
      captured.length = 0;
      await activate(plain);
      await analysis.reachDefinition(plain);
      const plainRound = requestsFor('analysis_round')[0]!;
      expect(profileOf(plainRound)).toBeUndefined();
      expect(plainRound.instructions).not.toContain('authoritative description');
      expect((await pinnedTo(plain)).snapshot).toBeNull();
      const none = await h.admin.query<{ count: number }>(
        `select count(*)::int as count from model_invocations where project_id = $1 and business_snapshot_id is not null`,
        [plain],
      );
      expect(none.rows[0]!.count).toBe(0);
    });

    it('BIZ-AI-002: a run keeps reading the version it started with when Contenter changes', async () => {
      await setting('business.sync_on_start', false);
      try {
        const projectId = await project('ai-pinned', 'biz-wepod');
        await activate(projectId);
        await analysis.reachDefinition(projectId);
        const startedWith = (await pinnedTo(projectId)).version_no!;

        const business = contenter.businesses.get('biz-wepod')!;
        const before = business.sections['GOALS'];
        business.sections['GOALS'] = 'Triple the number of digital card applications.';
        try {
          const synced = await post<{ changed: boolean; versionNo: number }>(
            `/projects/${projectId}/business/sync`,
            {},
            200,
          );
          expect(synced).toMatchObject({ changed: true, versionNo: startedWith + 1 });

          // The later stages of the same run still read the old text of the goals.
          const view = await waitFor(projectId, waiting('analysis'), 'analysis gate');
          await approve(projectId, stageOf(view, 'analysis'));
          await waitFor(projectId, waiting('research'), 'research gate');
          const goals = profileOf(requestsFor('research_output')[0]!)!.sections.find(
            (section) => section.key === 'GOALS',
          )!;
          expect(goals.text).toContain('20 percent');
          expect(goals.text).not.toContain('Triple');
          expect((await pinnedTo(projectId)).version_no).toBe(startedWith);
        } finally {
          business.sections['GOALS'] = before!;
        }
      } finally {
        await setting('business.sync_on_start', true);
      }
    });

    it('BIZ-AI-003: a new run starts from the latest version, or from the saved one when Contenter cannot answer', async () => {
      const fresh = await project('ai-fresh', 'biz-wepod');
      const savedVersion = (
        await get<{ snapshot: { versionNo: number } }>(`/projects/${fresh}/business`)
      ).snapshot.versionNo;
      const business = contenter.businesses.get('biz-wepod')!;
      const before = business.sections['SERVICES'];
      business.sections['SERVICES'] = 'Loans, cards and a new savings account.';
      try {
        await activate(fresh);
        // Contenter was asked first, so the run is pinned to the new version.
        const pinned = await pinnedTo(fresh);
        expect(pinned.version_no).toBe(savedVersion + 1);
        const run = await h.admin.query<{ after: Record<string, unknown> }>(
          `select after from audit_events where project_id = $1 and action = 'workflow.run_created'`,
          [fresh],
        );
        expect(run.rows[0]!.after['businessSnapshotId']).toBe(pinned.snapshot);
        expect(run.rows[0]!.after['businessSyncError']).toBeUndefined();

        // Contenter is down and has changed again: the run reads the last saved version and says so.
        const offline = await project('ai-offline', 'biz-wepod');
        business.sections['SERVICES'] = 'Changed again while Contenter is unreachable.';
        contenter.mode = 'down';
        await activate(offline);
        const saved = await pinnedTo(offline);
        expect(saved.version_no).toBe(savedVersion + 1);
        const audit = await h.admin.query<{ after: Record<string, unknown> }>(
          `select after from audit_events where project_id = $1 and action = 'workflow.run_created'`,
          [offline],
        );
        expect(audit.rows[0]!.after['businessSyncError']).toBe('CONTENTER_ERROR');
        const link = await get<{ link: { syncError: string | null } }>(
          `/projects/${offline}/business`,
        );
        expect(link.link.syncError).toBe('CONTENTER_ERROR');
      } finally {
        contenter.mode = 'up';
        business.sections['SERVICES'] = before!;
      }
    });

    it('BIZ-AI-004: solutions, the document and its evaluation are written for the business, and its terminology is checked', async () => {
      const projectId = await project('ai-doc', 'biz-wepod');
      const generated = await post<{ solutionSet: { items: { id: string }[] } }>(
        `/projects/${projectId}/solutions/generate`,
        { count: 2 },
      );
      const ideation = requestsFor('solutions')[0]!;
      expect(profileOf(ideation)!.sections.map((section) => section.key)).toContain('PERSONAS');
      expect(ideation.instructions).toContain('this company can deliver');

      await post(`/projects/${projectId}/solution-selections`, {
        solutionIds: [generated.solutionSet.items[0]!.id],
        reason: 'The strongest option',
      });
      const documents = await get<{ items: { id: string }[] }>(`/projects/${projectId}/documents`);
      const documentId = documents.items[0]!.id;

      const started = await post<{ writing: { id: string } }>(
        `/documents/${documentId}/writings`,
        {},
      );
      const writingId = started.writing.id;
      const deadline = Date.now() + 60_000;
      for (;;) {
        const writing = (
          await get<{ writing: { status: string; report: { termIssues?: unknown[] } | null } }>(
            `/documents/${documentId}/writings/${writingId}`,
          )
        ).writing;
        if (['succeeded', 'failed', 'cancelled'].includes(writing.status)) {
          expect(writing.status).toBe('succeeded');
          // The report says the terminology was checked (and found clean in the offline text).
          expect(writing.report!.termIssues).toEqual([]);
          break;
        }
        expect(Date.now()).toBeLessThan(deadline);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      // The documenter reads the brand voice and the terminology; the snapshot is pinned to the writing.
      const calls = requestsFor('document_section');
      expect(calls.length).toBeGreaterThan(0);
      const writer = profileOf(calls[0]!)!;
      expect(writer.sections.map((section) => section.key)).toEqual([
        'OVERVIEW',
        'SERVICES',
        'TARGET_MARKET',
        'PERSONAS',
        'BRAND_VOICE',
        'GUIDELINES',
      ]);
      expect(writer.terminology).toEqual([
        { term: 'WePod', rule: 'always write exactly', alternatives: ['We Pod', 'Wepod'] },
        { term: 'WePod Bank', rule: 'never write', alternatives: ['WePod Digital Branch'] },
      ]);
      const pinned = await h.admin.query<{ snapshot: string | null }>(
        'select business_snapshot_id as snapshot from document_writings where id = $1',
        [writingId],
      );
      expect(pinned.rows[0]!.snapshot).not.toBeNull();
      const writingCalls = await h.admin.query<{ business_snapshot_id: string | null }>(
        'select business_snapshot_id from model_invocations where writing_id = $1',
        [writingId],
      );
      expect(writingCalls.rows.length).toBeGreaterThan(0);
      for (const call of writingCalls.rows)
        expect(call.business_snapshot_id).toBe(pinned.rows[0]!.snapshot);

      // The terminology check is made by code against the text the administrator is editing.
      const current = await get<{
        document: {
          currentVersion: {
            content: { blocks: { id: string; type: string; runs?: { text: string }[] }[] } & Record<
              string,
              unknown
            >;
          };
        };
      }>(`/documents/${documentId}`);
      const content = structuredClone(current.document.currentVersion.content);
      const paragraph = content.blocks.find((block) => block.type === 'paragraph')!;
      paragraph.runs = [{ text: 'Our We Pod app, from WePod Bank, is loved. WePod is fine.' }];
      const checked = await post<{
        check: {
          valid: boolean;
          termIssues: { kind: string; found: string; count: number; replaceWith: string[] }[];
        };
      }>(`/documents/${documentId}/check`, { content }, 200);
      expect(checked.check.valid).toBe(true);
      expect(
        checked.check.termIssues.map((issue) => [issue.kind, issue.found, issue.count]),
      ).toEqual([
        ['USE', 'We Pod', 1],
        ['AVOID', 'WePod Bank', 1],
      ]);
      expect(checked.check.termIssues[1]!.replaceWith).toEqual(['WePod Digital Branch']);

      // The evaluator checks the document against the company's own rules.
      captured.length = 0;
      await post(`/documents/${documentId}/evaluate`, {}, 201);
      const judge = requestsFor('evaluation')[0]!;
      expect(profileOf(judge)!.sections.map((section) => section.key)).toContain('GUIDELINES');
      expect(judge.instructions).toContain('contradicts businessProfile');
    });
  },
);
