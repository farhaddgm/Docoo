import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { meetingProblemPattern } from '@docoo/contracts';
import {
  ProblemPatternsService,
  patternHash,
} from '../src/problem-patterns/problem-patterns.service.js';
import type { PatternAiProvider } from '../src/problem-patterns/pattern-ai.provider.js';

const url = process.env['DATABASE_TEST_ADMIN_URL'];
const suite = url ? describe : describe.skip;
const workspaceId = randomUUID();
const actorId = randomUUID();
const context = { workspaceId, actorId, correlationId: randomUUID() };
const preview = {
  questions: ['What outcome?'],
  researchDecision: 'No external research needed.',
  sampleOutput: 'Goal and opening line.',
  limitations: ['Simulated preview only.'],
};

suite('problem patterns on isolated PostgreSQL', () => {
  let admin: Pool;
  let runtime: Pool;
  let service: ProblemPatternsService;
  const complete = vi.fn(() =>
    Promise.resolve({
      answer: 'Proposed guidance',
      definition: null,
      preview,
      metadata: { provider: 'openai', modelId: 'fake-test-model' },
    }),
  );
  const ai = { metadata: vi.fn(() => ({})), complete } as unknown as PatternAiProvider;
  beforeAll(async () => {
    if (!url || new URL(url).pathname !== '/docoo_ci')
      throw new Error('Use isolated /docoo_ci database only.');
    admin = new Pool({ connectionString: url });
    runtime = new Pool({ connectionString: url, options: '-c role=docoo_app', max: 8 });
    await admin.query('insert into workspaces(id,code,name) values($1,$2,$3)', [
      workspaceId,
      `patterns-${workspaceId}`,
      'Patterns test',
    ]);
    await admin.query(
      'insert into users(id,email,password_hash,display_name) values($1,$2,$3,$4)',
      [actorId, `${actorId}@example.test`, 'test-only', 'Pattern admin'],
    );
    await admin.query(
      "insert into memberships(workspace_id,user_id,role) values($1,$2,'super_admin')",
      [workspaceId, actorId],
    );
    service = new ProblemPatternsService(runtime, ai);
  });
  afterAll(async () => {
    await runtime?.end();
    await admin?.end();
  });
  const create = async () =>
    service.create(context, {
      definition: { ...meetingProblemPattern, key: `test-${randomUUID()}` },
      idempotencyKey: randomUUID(),
    });
  const run = async (id: string, revision = 1) =>
    service.run(
      context,
      id,
      'test',
      {
        expectedRevision: revision,
        content: 'Prepare for a salary conversation',
        providerConsent: true,
        idempotencyKey: randomUUID(),
      },
      new AbortController().signal,
    );

  it('uses canonical hashes independent of JSONB key order', () => {
    expect(patternHash({ a: 1, b: [2, 3] })).toBe(patternHash({ b: [2, 3], a: 1 }));
  });
  it('creates idempotently and rejects conflicting reuse', async () => {
    const input = {
      definition: { ...meetingProblemPattern, key: `test-${randomUUID()}` },
      idempotencyKey: randomUUID(),
    };
    const first = await service.create(context, input);
    expect((await service.create(context, input)).id).toBe(first.id);
    await expect(
      service.create(context, {
        ...input,
        definition: { ...input.definition, title: 'different' },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('returns a conflict for concurrent creation using the same catalog key', async () => {
    const definition = { ...meetingProblemPattern, key: `test-${randomUUID()}` };
    const result = await Promise.allSettled(
      [1, 2].map(() => service.create(context, { definition, idempotencyKey: randomUUID() })),
    );
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const rejected = result.find((item) => item.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({ status: 409 });
  });
  it('renames the editable key, rejects duplicates and preserves published definitions', async () => {
    const original = await create();
    const testRun = await run(original.id);
    await service.publish(context, original.id, {
      expectedRevision: 1,
      testRunId: testRun.id,
      idempotencyKey: randomUUID(),
    });
    const other = await create();
    await expect(
      service.update(context, original.id, {
        expectedRevision: 1,
        definition: { ...original.definition, key: other.definition.key },
      }),
    ).rejects.toMatchObject({ status: 409 });
    const key = `renamed-${randomUUID()}`;
    const renamed = await service.update(context, original.id, {
      expectedRevision: 1,
      definition: { ...original.definition, key },
    });
    expect(renamed.id).toBe(original.id);
    expect(renamed.definition.key).toBe(key);
    expect(renamed.revision).toBe(2);
    const detail = await service.get(context, original.id);
    const version = await service.getVersion(
      context,
      original.id,
      String(detail.versions[0]!['id']),
    );
    expect((version['definition'] as { key: string }).key).toBe(original.definition.key);
    await expect(
      service.publish(context, original.id, {
        expectedRevision: 2,
        testRunId: testRun.id,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('serializes concurrent edits and rejects stale revisions', async () => {
    const row = await create();
    const updates = await Promise.allSettled(
      ['One', 'Two'].map((title) =>
        service.update(context, row.id, {
          expectedRevision: 1,
          definition: { ...row.definition, title },
        }),
      ),
    );
    expect(updates.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(updates.filter((item) => item.status === 'rejected')).toHaveLength(1);
    expect((await service.get(context, row.id)).pattern.revision).toBe(2);
  });
  it('publishes only a tested revision, replays publication and keeps old versions immutable', async () => {
    const row = await create();
    await expect(
      service.publish(context, row.id, {
        expectedRevision: 1,
        testRunId: randomUUID(),
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    const test = await run(row.id);
    const input = { expectedRevision: 1, testRunId: test.id, idempotencyKey: randomUUID() };
    const first = await service.publish(context, row.id, input);
    expect((await service.publish(context, row.id, input))['id']).toBe(first['id']);
    expect((await service.listPublished(context)).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ versionId: first['id'], patternId: row.id, version: 1 }),
      ]),
    );
    const editorId = randomUUID();
    await admin.query(
      'insert into users(id,email,password_hash,display_name) values($1,$2,$3,$4)',
      [editorId, `${editorId}@example.test`, 'test-only', 'Pattern project creator'],
    );
    await admin.query("insert into memberships(workspace_id,user_id,role) values($1,$2,'editor')", [
      workspaceId,
      editorId,
    ]);
    expect((await service.listPublished({ ...context, actorId: editorId })).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ versionId: first['id'], patternId: row.id, version: 1 }),
      ]),
    );
    await service.update(context, row.id, {
      expectedRevision: 1,
      definition: { ...row.definition, title: 'Edited' },
    });
    await expect(
      service.publish(context, row.id, {
        expectedRevision: 2,
        testRunId: test.id,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await admin.query('select definition from problem_pattern_versions where id=$1', [
          first['id'],
        ])
      ).rows[0].definition.title,
    ).toBe(row.definition.title);
    await expect(
      admin.query("update problem_pattern_versions set definition='{}'::jsonb where id=$1", [
        first['id'],
      ]),
    ).rejects.toThrow('immutable');
    const secondTest = await run(row.id, 2);
    const second = await service.publish(context, row.id, {
      expectedRevision: 2,
      testRunId: secondTest.id,
      idempotencyKey: randomUUID(),
    });
    expect(second['version']).toBe(2);
  });
  it('deduplicates AI requests and preserves drafts on provider failure', async () => {
    const row = await create();
    const input = {
      expectedRevision: 1,
      content: 'Improve this pattern',
      providerConsent: true,
      idempotencyKey: randomUUID(),
    };
    const before = complete.mock.calls.length;
    const first = await service.run(context, row.id, 'chat', input, new AbortController().signal);
    const second = await service.run(context, row.id, 'chat', input, new AbortController().signal);
    expect(second.id).toBe(first.id);
    expect(complete.mock.calls.length - before).toBe(1);
    complete.mockRejectedValueOnce(new Error('secret provider error'));
    await expect(run(row.id)).rejects.toMatchObject({ status: 503 });
    const state = await service.get(context, row.id);
    expect(state.pattern.revision).toBe(1);
    expect(state.pattern.definition).toEqual(row.definition);
    expect(state.runs.some((item) => item.status === 'failed')).toBe(true);
    expect(JSON.stringify(state)).not.toContain('secret provider error');
  });
  it('records cancellation as failure without changing the draft or rerunning the same request', async () => {
    const row = await create();
    const input = {
      expectedRevision: 1,
      content: 'Cancel this request',
      providerConsent: true,
      idempotencyKey: randomUUID(),
    };
    const abort = new AbortController();
    abort.abort();
    await expect(service.run(context, row.id, 'chat', input, abort.signal)).rejects.toMatchObject({
      status: 503,
    });
    const before = complete.mock.calls.length;
    const replay = await service.run(context, row.id, 'chat', input, new AbortController().signal);
    expect(replay.status).toBe('failed');
    expect(complete.mock.calls.length).toBe(before);
    expect((await service.get(context, row.id)).pattern.revision).toBe(1);
  });
  it('rejects missing consent and archiving blocks new work', async () => {
    const row = await create();
    await expect(
      service.run(
        context,
        row.id,
        'chat',
        { expectedRevision: 1, content: 'Hello', idempotencyKey: randomUUID() },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 422 });
    await service.archive(context, row.id, { expectedRevision: 1 });
    await expect(run(row.id)).rejects.toMatchObject({ status: 409 });
  });
  it('enforces workspace and administrator isolation through RLS', async () => {
    const row = await create();
    const otherWorkspace = randomUUID();
    await expect(
      service.get({ ...context, workspaceId: otherWorkspace }, row.id),
    ).rejects.toMatchObject({ status: 404 });
    const editorId = randomUUID();
    await admin.query(
      'insert into users(id,email,password_hash,display_name) values($1,$2,$3,$4)',
      [editorId, `${editorId}@example.test`, 'test-only', 'Editor'],
    );
    await admin.query("insert into memberships(workspace_id,user_id,role) values($1,$2,'editor')", [
      workspaceId,
      editorId,
    ]);
    await expect(service.get({ ...context, actorId: editorId }, row.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      service.create(
        { ...context, actorId: editorId },
        {
          definition: { ...meetingProblemPattern, key: `test-${randomUUID()}` },
          idempotencyKey: randomUUID(),
        },
      ),
    ).rejects.toThrow('row-level security');
    const events = await admin.query(
      'select action,"after" from audit_events where workspace_id=$1 and target_type=\'problem_pattern\'',
      [workspaceId],
    );
    expect(events.rows.some((item) => item.action === 'problem_pattern.version_published')).toBe(
      true,
    );
    expect(JSON.stringify(events.rows)).not.toContain('salary conversation');
  });
});
