import { createHash } from 'node:crypto';

import { SYSTEM_RUBRIC } from '@docoo/documents';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminUrl, createHarness, type Harness } from './support/harness.js';

let h: Harness;
let cookie: string;
let topicId: string;
let connectionId: string;
const api = (suffix: string) => `/v1/workspaces/${h.ids.workspaceA}${suffix}`;

interface DocumentView {
  id: string;
  projectId: string;
  priority: number;
  level: number;
  status: string;
  version: number;
  currentVersionId: string;
  approvedVersionId: string | null;
  approvalKind: string | null;
  currentVersion: {
    id: string;
    versionNo: number;
    charCount: number;
    withinBounds: boolean;
    origin: string;
    content?: { title: string; language: string; blocks: { id: string; type: string }[] };
  };
}

interface EvaluationView {
  id: string;
  status: string;
  overall: number;
  scores: { criterion: string; score: number; evidence: string }[];
  findings: {
    id: string;
    severity: string;
    criterion: string;
    targetStage: string;
    defaultTargetStage: string;
  }[];
  exception: { reason: string; badge: string } | null;
}

async function setting(key: string, value: unknown, scopeType = 'workspace', scopeId?: string) {
  const response = await h.request('PUT', api('/settings/assignments'), {
    cookie,
    payload: { key, scopeType, scopeId: scopeId ?? h.ids.workspaceA, value, reason: `test ${key}` },
  });
  expect(response.statusCode, response.body).toBe(200);
}

async function project(code: string): Promise<string> {
  const created = await h.request('POST', api('/projects'), {
    cookie,
    payload: {
      code,
      title: `Project ${code}`,
      initialProblem: 'Reduce repeat-customer churn by 20%.',
      topics: [{ topicId }],
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  return created.json<{ project: { id: string } }>().project.id;
}

async function document(id: string): Promise<DocumentView> {
  const response = await h.request('GET', api(`/documents/${id}`), { cookie });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.headers['etag']).toBe(
    `"${response.json<{ document: DocumentView }>().document.version}"`,
  );
  return response.json<{ document: DocumentView }>().document;
}

async function post(url: string, payload: unknown = {}) {
  return h.request('POST', api(url), { cookie, payload });
}

/** Judge answers for the fake provider: every criterion gets `score`, overrides per key. */
function judge(score: number, overrides: Record<string, number> = {}) {
  return {
    scores: SYSTEM_RUBRIC.criteria.map((criterion) => ({
      criterion: criterion.key,
      score: overrides[criterion.key] ?? score,
      evidence: `Evidence for ${criterion.key}`,
    })),
    findings: [],
  };
}

/** Generates three solutions, selects two and returns the documents in priority order. */
async function documentsFor(
  code: string,
): Promise<{ projectId: string; documents: DocumentView[] }> {
  const projectId = await project(code);
  const generated = await post(`/projects/${projectId}/solutions/generate`, { count: 3 });
  expect(generated.statusCode, generated.body).toBe(201);
  const items = generated.json<{ solutionSet: { items: { id: string }[] } }>().solutionSet.items;
  const selected = await post(`/projects/${projectId}/solution-selections`, {
    solutionIds: [items[2]!.id, items[0]!.id],
    reason: 'Two strongest options',
  });
  expect(selected.statusCode, selected.body).toBe(201);
  const list = await h.request('GET', api(`/projects/${projectId}/documents`), { cookie });
  const documents = list.json<{ items: DocumentView[] }>().items;
  return { projectId, documents: await Promise.all(documents.map((item) => document(item.id))) };
}

describe.skipIf(!adminUrl)('solutions, documents and evaluation (SOL-*, DOC-*, EVA-*)', () => {
  beforeAll(async () => {
    h = await createHarness('documents');
    cookie = await h.login(h.emails.a);
    const topic = await post('/topics', { code: 'retail', title: 'Retail' });
    topicId = topic.json<{ topic: { id: string } }>().topic.id;
    const connection = await post('/provider-connections', {
      provider: 'fake',
      name: 'Deterministic',
    });
    expect(connection.statusCode, connection.body).toBe(201);
    connectionId = connection.json<{ connection: { id: string } }>().connection.id;
    await setting('ai.connection_id', connectionId);
    await setting('ai.model', 'fake-standard');
    await setting('document.level', 1);
    // Level 1 accepts short drafts so the fake provider's output is compliant; level 2 does not.
    await setting(
      'document.level_bounds',
      [20, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000],
    );
  }, 60_000);

  afterAll(async () => {
    await h?.close();
  });

  it('SOL-002/003: criteria are versioned, weights must add up to 100 and scores are explained', async () => {
    const projectId = await project('criteria');
    const initial = await h.request('GET', api(`/projects/${projectId}/solution-criteria`), {
      cookie,
    });
    expect(
      initial.json<{ criteria: { versionNo: number; criteria: unknown[] } }>().criteria,
    ).toMatchObject({ versionNo: 0 });
    const criteria = initial.json<{
      criteria: { criteria: { key: string; weight: number; enabled: boolean }[] };
    }>().criteria.criteria;

    const broken = await h.request('PUT', api(`/projects/${projectId}/solution-criteria`), {
      cookie,
      payload: {
        criteria: criteria.map((item, index) => (index === 0 ? { ...item, enabled: false } : item)),
        reason: 'Drop impact',
      },
    });
    expect(broken.statusCode).toBe(400);
    expect(broken.json<{ code: string }>().code).toBe('SOLUTION_CRITERIA_INVALID');

    const reweighted = criteria.map((item) =>
      item.key === 'impact'
        ? { ...item, weight: 40 }
        : item.key === 'time'
          ? { ...item, enabled: false }
          : item,
    );
    const timeWeight = criteria.find((item) => item.key === 'time')!.weight;
    reweighted.find((item) => item.key === 'feasibility')!.weight +=
      timeWeight - (40 - criteria.find((item) => item.key === 'impact')!.weight);
    const saved = await h.request('PUT', api(`/projects/${projectId}/solution-criteria`), {
      cookie,
      payload: { criteria: reweighted, reason: 'Impact matters most' },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json<{ criteria: { versionNo: number } }>().criteria.versionNo).toBe(1);

    const generated = await post(`/projects/${projectId}/solutions/generate`, { count: 2 });
    expect(generated.statusCode, generated.body).toBe(201);
    const set = generated.json<{
      solutionSet: {
        requestedCount: number;
        items: {
          title: string;
          plan: string[];
          risks: string[];
          score: { total: number; criteria: { key: string; explanation: string }[] };
        }[];
      };
    }>().solutionSet;
    expect(set.requestedCount).toBe(2);
    expect(set.items).toHaveLength(2);
    for (const item of set.items) {
      expect(item.plan.length).toBeGreaterThan(0);
      expect(item.risks.length).toBeGreaterThan(0);
      expect(item.score.criteria.map((criterion) => criterion.key)).not.toContain('time');
      expect(
        item.score.criteria.every((criterion) => /× \d+ = /u.test(criterion.explanation)),
      ).toBe(true);
    }
  });

  it('SOL-001: the count is bounded and incomplete model output stores nothing', async () => {
    const projectId = await project('incomplete');
    expect(
      (await post(`/projects/${projectId}/solutions/generate`, { count: 21 })).statusCode,
    ).toBe(400);
    expect((await post(`/projects/${projectId}/solutions/generate`, { count: 1 })).statusCode).toBe(
      400,
    );

    h.fake.responder = (request) =>
      request.responseSchema?.name === 'solutions'
        ? { solutions: [{ title: 'Only a title' }, { title: 'Another' }] }
        : null;
    try {
      const response = await post(`/projects/${projectId}/solutions/generate`, { count: 2 });
      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('SOLUTION_INCOMPLETE');
    } finally {
      h.fake.responder = () => null;
    }
    const stored = await h.admin.query('select 1 from solution_sets where project_id = $1', [
      projectId,
    ]);
    expect(stored.rowCount).toBe(0);
    const select = await post(`/projects/${projectId}/solution-selections`, {
      solutionIds: [crypto.randomUUID()],
    });
    expect(select.json<{ code: string }>().code).toBe('SOLUTION_NONE');
  });

  it('SOL-003/DOC-101: selection keeps priority order and each document gets its own lifecycle', async () => {
    const { projectId, documents } = await documentsFor('selection');
    expect(documents.map((item) => item.priority)).toEqual([1, 2]);
    for (const item of documents) {
      expect(item).toMatchObject({
        status: 'draft',
        level: 1,
        currentVersion: { versionNo: 1, origin: 'model', withinBounds: true },
      });
      expect(item.currentVersion.content!.blocks.map((block) => block.type)).toContain('list');
    }
    const solutions = await h.request('GET', api(`/projects/${projectId}/solutions`), { cookie });
    const priorities = solutions
      .json<{ solutionSet: { items: { selectedPriority: number | null }[] } }>()
      .solutionSet.items.map((item) => item.selectedPriority);
    expect(priorities).toEqual([2, null, 1]);
  });

  it('DOC-102: edits need If-Match, are validated, versioned, diffable and restorable', async () => {
    const { documents } = await documentsFor('versions');
    const target = documents[0]!;
    const content = target.currentVersion.content!;
    const edited = {
      ...content,
      blocks: [
        ...content.blocks,
        { type: 'callout', id: 'decision', tone: 'decision', text: 'Start with loyal customers.' },
      ],
    };

    const missing = await h.request('PUT', api(`/documents/${target.id}/content`), {
      cookie,
      payload: { content: edited, reason: 'Add decision' },
    });
    expect(missing.statusCode).toBe(428);
    const stale = await h.request('PUT', api(`/documents/${target.id}/content`), {
      cookie,
      payload: { content: edited, reason: 'Add decision' },
      headers: { 'if-match': `"${target.version + 5}"` },
    });
    expect(stale.statusCode).toBe(412);
    const invalid = await h.request('PUT', api(`/documents/${target.id}/content`), {
      cookie,
      payload: { content: { ...content, blocks: [{ type: 'video', id: 'v' }] }, reason: 'Broken' },
      headers: { 'if-match': `"${target.version}"` },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json<{ problems: string[] }>().problems.join(' ')).toContain('video');

    const saved = await h.request('PUT', api(`/documents/${target.id}/content`), {
      cookie,
      payload: { content: edited, reason: 'Add decision' },
      headers: { 'if-match': `"${target.version}"` },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const after = saved.json<{ document: DocumentView }>().document;
    expect(saved.headers['etag']).toBe(`"${after.version}"`);
    expect(after.currentVersion).toMatchObject({ versionNo: 2, origin: 'edit' });

    const versions = (
      await h.request('GET', api(`/documents/${target.id}/versions`), { cookie })
    ).json<{ items: { id: string; versionNo: number }[] }>().items;
    expect(versions.map((item) => item.versionNo)).toEqual([2, 1]);
    const diff = await h.request(
      'GET',
      api(`/documents/${target.id}/diff?from=${versions[1]!.id}&to=${versions[0]!.id}`),
      { cookie },
    );
    expect(diff.statusCode, diff.body).toBe(200);
    expect(
      diff.json<{ diff: { from: number; to: number; summary: { added: number } } }>().diff,
    ).toMatchObject({ from: 1, to: 2, summary: { added: 1 } });

    const restored = await post(`/documents/${target.id}/versions/${versions[1]!.id}/restore`, {
      reason: 'Back to the draft',
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json<{ document: DocumentView }>().document.currentVersion).toMatchObject({
      versionNo: 3,
      origin: 'restore',
    });

    // History is append-only even for the database owner.
    await expect(
      h.admin.query('update document_versions set reason = $2 where id = $1', [
        versions[0]!.id,
        'rewrite',
      ]),
    ).rejects.toThrow();
    await expect(
      h.admin.query('delete from document_versions where id = $1', [versions[0]!.id]),
    ).rejects.toThrow();
  });

  it('DOC-101/EVA-001: out-of-bounds documents are non-compliant; approval needs a passed evaluation', async () => {
    const { documents } = await documentsFor('approval');
    const target = documents[0]!;
    const toLevel2 = await h.request('PUT', api(`/documents/${target.id}/content`), {
      cookie,
      payload: { content: target.currentVersion.content, reason: 'Longer level', level: 2 },
      headers: { 'if-match': `"${target.version}"` },
    });
    expect(toLevel2.json<{ document: DocumentView }>().document.currentVersion.withinBounds).toBe(
      false,
    );
    const nonCompliant = await post(`/documents/${target.id}/submit`);
    expect(nonCompliant.json<{ document: DocumentView }>().document.status).toBe('non_compliant');
    expect((await post(`/documents/${target.id}/approve`)).statusCode).toBe(409);

    const current = await document(target.id);
    await h.request('PUT', api(`/documents/${target.id}/content`), {
      cookie,
      payload: { content: target.currentVersion.content, reason: 'Back to level 1', level: 1 },
      headers: { 'if-match': `"${current.version}"` },
    });
    const ready = await post(`/documents/${target.id}/submit`);
    expect(ready.json<{ document: DocumentView }>().document.status).toBe('ready_for_review');
    const notEvaluated = await post(`/documents/${target.id}/approve`);
    expect(notEvaluated.json<{ code: string }>().code).toBe('DOCUMENT_NOT_EVALUATED');

    h.fake.responder = (request) =>
      request.responseSchema?.name === 'evaluation' ? judge(90) : null;
    try {
      const evaluated = await post(`/documents/${target.id}/evaluate`);
      expect(evaluated.statusCode, evaluated.body).toBe(201);
      const evaluation = evaluated.json<{ evaluation: EvaluationView }>().evaluation;
      expect(evaluation.status).toBe('passed');
      expect(evaluation.scores).toHaveLength(SYSTEM_RUBRIC.criteria.length);
      expect(evaluation.scores.every((score) => score.evidence.length > 0)).toBe(true);
    } finally {
      h.fake.responder = () => null;
    }
    const approved = await post(`/documents/${target.id}/approve`, { reason: 'Meets the rubric' });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json<{ document: DocumentView }>().document).toMatchObject({
      status: 'approved',
      approvalKind: 'approved',
    });

    const locked = await post(`/documents/${target.id}/lock`);
    expect(locked.json<{ document: DocumentView }>().document.status).toBe('locked');
    const lockedDocument = await document(target.id);
    const blocked = await h.request('PUT', api(`/documents/${target.id}/content`), {
      cookie,
      payload: { content: target.currentVersion.content, reason: 'Sneaky edit' },
      headers: { 'if-match': `"${lockedDocument.version}"` },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<{ code: string }>().code).toBe('DOCUMENT_LOCKED');
    // The database refuses a direct change to a locked document's approved version too.
    await expect(
      h.admin.query('update documents set approved_version_id = null where id = $1', [target.id]),
    ).rejects.toThrow();

    expect((await post(`/documents/${target.id}/supersede`, {})).statusCode).toBe(400);
    const superseded = await post(`/documents/${target.id}/supersede`, {
      reason: 'New pricing data',
    });
    expect(superseded.statusCode, superseded.body).toBe(200);
    expect(superseded.json<{ document: DocumentView }>().document).toMatchObject({
      status: 'draft',
      approvedVersionId: null,
      currentVersion: { origin: 'supersede' },
    });

    const audit = await h.admin.query<{ action: string }>(
      `select action from audit_events where target_id = $1 order by occurred_at, id`,
      [target.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'document.edit',
        'document.submit',
        'evaluation.run',
        'document.approve',
        'document.lock',
        'document.supersede',
      ]),
    );
  });

  it('EVA-002: failures produce findings with target stages; exceptions stay visible', async () => {
    const { projectId, documents } = await documentsFor('evaluation');
    const target = documents[0]!;
    const rubric = await h.request('GET', api(`/projects/${projectId}/rubric`), { cookie });
    expect(rubric.json<{ rubric: { scope: string } }>().rubric.scope).toBe('system');
    const badRubric = await h.request('PUT', api(`/projects/${projectId}/rubric`), {
      cookie,
      payload: {
        rubric: { ...SYSTEM_RUBRIC, criteria: SYSTEM_RUBRIC.criteria.slice(1) },
        reason: 'Drop one',
      },
    });
    expect(badRubric.statusCode).toBe(400);
    const ownRubric = await h.request('PUT', api(`/projects/${projectId}/rubric`), {
      cookie,
      payload: {
        rubric: { ...SYSTEM_RUBRIC, passThreshold: 85 },
        reason: 'Stricter for this client',
      },
    });
    expect(ownRubric.statusCode, ownRubric.body).toBe(200);
    expect(ownRubric.json<{ rubric: { scope: string; versionNo: number } }>().rubric).toMatchObject(
      { scope: 'project', versionNo: 1 },
    );

    await post(`/documents/${target.id}/submit`);
    h.fake.responder = (request) =>
      request.responseSchema?.name === 'evaluation' ? judge(95, { evidence: 30 }) : null;
    let evaluation: EvaluationView;
    try {
      evaluation = (await post(`/documents/${target.id}/evaluate`)).json<{
        evaluation: EvaluationView;
      }>().evaluation;
    } finally {
      h.fake.responder = () => null;
    }
    expect(evaluation.status).toBe('failed_quality');
    const finding = evaluation.findings.find((item) => item.criterion === 'evidence')!;
    expect(finding).toMatchObject({ targetStage: 'research', defaultTargetStage: 'research' });
    expect((await post(`/documents/${target.id}/approve`)).json<{ code: string }>().code).toBe(
      'DOCUMENT_EVALUATION_FAILED',
    );

    const badStage = await h.request('PATCH', api(`/evaluation-findings/${finding.id}`), {
      cookie,
      payload: { targetStage: 'marketing', reason: 'Wrong stage' },
    });
    expect(badStage.statusCode).toBe(400);
    const retargeted = await h.request('PATCH', api(`/evaluation-findings/${finding.id}`), {
      cookie,
      payload: { targetStage: 'analysis', reason: 'The requirement itself is unclear' },
    });
    expect(retargeted.statusCode, retargeted.body).toBe(200);
    expect(
      retargeted
        .json<{ evaluation: EvaluationView }>()
        .evaluation.findings.find((item) => item.id === finding.id),
    ).toMatchObject({ targetStage: 'analysis', defaultTargetStage: 'research' });

    const accepted = await post(`/evaluations/${evaluation.id}/accept-exception`, {
      reason: 'Client accepts weaker sources for the pilot',
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json<{ evaluation: EvaluationView }>().evaluation.exception).toMatchObject({
      badge: 'accepted_with_exception',
    });
    expect(
      (await post(`/evaluations/${evaluation.id}/accept-exception`, { reason: 'Again please' }))
        .statusCode,
    ).toBe(409);
    const approved = await post(`/documents/${target.id}/approve`);
    expect(approved.json<{ document: DocumentView }>().document).toMatchObject({
      status: 'approved',
      approvalKind: 'accepted_with_exception',
    });
    const stored = await h.request('GET', api(`/evaluations/${evaluation.id}`), { cookie });
    expect(stored.json<{ evaluation: EvaluationView }>().evaluation.status).toBe('failed_quality');
  });

  it('EVA-001: a provider failure is a technical error, not a quality result', async () => {
    const { documents } = await documentsFor('technical');
    h.fake.script = () => 'auth';
    let evaluation: EvaluationView;
    try {
      evaluation = (await post(`/documents/${documents[0]!.id}/evaluate`)).json<{
        evaluation: EvaluationView;
      }>().evaluation;
    } finally {
      h.fake.script = () => null;
    }
    expect(evaluation).toMatchObject({ status: 'technical_error', scores: [], findings: [] });
    const exception = await post(`/evaluations/${evaluation.id}/accept-exception`, {
      reason: 'Skip the judge',
    });
    expect(exception.json<{ code: string }>().code).toBe('EVALUATION_TECHNICAL_ERROR');
  });

  it('DOC-103: exports are signed, downloadable, verifiable and detect tampering', async () => {
    const { documents } = await documentsFor('exports');
    const target = documents[0]!;
    const formats = process.env['RENDER_PDF'] ? ['docx', 'pptx', 'pdf'] : ['docx', 'pptx'];
    for (const format of formats) {
      const exported = await post(`/documents/${target.id}/exports`, { format });
      expect(exported.statusCode, exported.body).toBe(201);
      const artifact = exported.json<{
        artifact: {
          id: string;
          sha256: string;
          documentVersion: number;
          rendererVersion: string;
          signature: string;
        };
      }>().artifact;
      expect(artifact).toMatchObject({
        documentVersion: 1,
        rendererVersion: 'docoo-renderer-1.0.0',
      });
      const download = await h.request(
        'GET',
        api(`/documents/${target.id}/artifacts/${artifact.id}/download`),
        { cookie },
      );
      expect(download.statusCode).toBe(200);
      expect(download.headers['content-disposition']).toContain(`document-v1.${format}`);
      expect(createHash('sha256').update(download.rawPayload).digest('hex')).toBe(artifact.sha256);
      const verify = await h.request(
        'GET',
        api(`/documents/${target.id}/artifacts/${artifact.id}/verify`),
        { cookie },
      );
      expect(verify.json<{ verification: { valid: boolean } }>().verification.valid).toBe(true);
    }
    expect((await post(`/documents/${target.id}/exports`, { format: 'odt' })).statusCode).toBe(400);

    const list = await h.request('GET', api(`/documents/${target.id}/artifacts`), { cookie });
    const artifacts = list.json<{ items: { id: string; format: string }[] }>().items;
    expect(artifacts).toHaveLength(formats.length);
    const docx = artifacts.find((item) => item.format === 'docx')!;
    const key = [...h.objects.objects.keys()].find(
      (item) => item.includes(target.id) && item.endsWith('.docx'),
    )!;
    const original = h.objects.objects.get(key)!;
    const tampered = new Uint8Array(original.bytes);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1]! + 1) % 256;
    h.objects.objects.set(key, { ...original, bytes: tampered });
    const verify = await h.request(
      'GET',
      api(`/documents/${target.id}/artifacts/${docx.id}/verify`),
      { cookie },
    );
    expect(verify.json<{ verification: { valid: boolean } }>().verification.valid).toBe(false);
    const download = await h.request(
      'GET',
      api(`/documents/${target.id}/artifacts/${docx.id}/download`),
      { cookie },
    );
    expect(download.statusCode).toBe(409);
    expect(download.json<{ code: string }>().code).toBe('DOCUMENT_ARTIFACT_TAMPERED');
  });

  it('isolates documents between workspaces', async () => {
    const { documents } = await documentsFor('isolation');
    const other = await h.login(h.emails.b);
    const response = await h.request(
      'GET',
      `/v1/workspaces/${h.ids.workspaceB}/documents/${documents[0]!.id}`,
      { cookie: other },
    );
    expect(response.statusCode).toBe(404);
    const crossed = await h.request(
      'GET',
      `/v1/workspaces/${h.ids.workspaceA}/documents/${documents[0]!.id}`,
      { cookie: other },
    );
    expect(crossed.statusCode).toBe(404);
  });
});
