import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { TopicsService } from '../src/topics/topics.service.js';
import { adminUrl, createHarness, type Harness } from './support/harness.js';

let h: Harness;
let cookieA: string;
let cookieB: string;
let projectId: string;
let conversationId: string;
let answerId: string;
const PROJECT_TITLE = 'Confidential churn programme';
const PROBLEM = 'Reduce repeat-customer churn by exactly 17.5 percent in Q3.';
const api = (suffix: string, workspace = h.ids.workspaceA) =>
  `/v1/workspaces/${workspace}${suffix}`;
const smart = (suffix: string, workspace = h.ids.workspaceA) => api(`/smart${suffix}`, workspace);

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'done' | 'failed';
}
interface Step {
  key: string;
  status: 'done' | 'ready' | 'blocked';
  blockedBy: 'project' | 'step' | null;
  counter: { current: number; total: number } | null;
}
interface Progress {
  projectId: string | null;
  doneCount: number;
  total: number;
  nextStep: string | null;
  steps: Step[];
}
interface SmartError {
  id: string;
  source: string;
  category: string;
  status: string;
  message: string;
  occurrences: number;
  method: string | null;
  route: string | null;
  stack?: string | null;
  context?: unknown;
}

async function get(url: string, cookie = cookieA) {
  return h.request('GET', url, { cookie });
}
async function post(url: string, payload: unknown = {}, cookie = cookieA) {
  return h.request('POST', url, { cookie, payload });
}
async function patch(url: string, payload: unknown, cookie = cookieA) {
  return h.request('PATCH', url, { cookie, payload });
}
async function progress(query = ''): Promise<Progress> {
  const response = await get(smart(`/walker/progress${query}`));
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ progress: Progress }>().progress;
}
const step = (value: Progress, key: string) => value.steps.find((item) => item.key === key)!;

async function setting(key: string, value: unknown) {
  const response = await h.request('PUT', api('/settings/assignments'), {
    cookie: cookieA,
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

async function auditActions(): Promise<string[]> {
  const rows = await h.admin.query<{ action: string }>(
    `select action from audit_events where workspace_id = $1 and action like 'smart.%' order by occurred_at, id`,
    [h.ids.workspaceA],
  );
  return rows.rows.map((row) => row.action);
}

async function waitFor<T>(read: () => Promise<T | null>): Promise<T> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const value = await read();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Condition was not met in time.');
}

describe.skipIf(!adminUrl)('Smart: errors, chat, walker and ledger (SMT-001..004)', () => {
  beforeAll(async () => {
    h = await createHarness('smart');
    cookieA = await h.login(h.emails.a);
    cookieB = await h.login(h.emails.b);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await h?.close();
  });

  it('walker starts at the first unmet step in an empty workspace', async () => {
    const empty = await progress();
    expect(empty).toMatchObject({ projectId: null, doneCount: 0, nextStep: 'connect_provider' });
    expect(empty.total).toBe(12);
    expect(step(empty, 'configure_ai')).toMatchObject({ status: 'blocked', blockedBy: 'step' });
    expect(step(empty, 'activate_project')).toMatchObject({
      status: 'blocked',
      blockedBy: 'project',
    });
  });

  it('walker advances from stored facts and rejects a project that does not exist', async () => {
    const connection = await post(api('/provider-connections'), {
      provider: 'fake',
      name: 'Deterministic',
    });
    const connectionId = connection.json<{ connection: { id: string } }>().connection.id;
    await post(api(`/provider-connections/${connectionId}/health-check`));
    await setting('ai.connection_id', connectionId);
    await setting('ai.model', 'fake-standard');
    const topic = await post(api('/topics'), { code: 'retail', title: 'Retail' });
    const topicId = topic.json<{ topic: { id: string } }>().topic.id;
    const created = await post(api('/projects'), {
      code: 'smart-1',
      title: PROJECT_TITLE,
      initialProblem: PROBLEM,
      topics: [{ topicId }],
    });
    const project = created.json<{ project: { id: string; version: number } }>().project;
    projectId = project.id;

    const workspaceLevel = await progress();
    expect(step(workspaceLevel, 'connect_provider')).toMatchObject({
      status: 'done',
      counter: { current: 1, total: 1 },
    });
    expect(step(workspaceLevel, 'configure_ai').status).toBe('done');
    expect(step(workspaceLevel, 'create_topic').status).toBe('done');
    expect(step(workspaceLevel, 'create_project').status).toBe('done');
    expect(step(workspaceLevel, 'add_sources').status).toBe('ready');

    const draft = await progress(`?projectId=${projectId}`);
    expect(draft.projectId).toBe(projectId);
    expect(step(draft, 'activate_project').status).toBe('ready');
    expect(step(draft, 'complete_stages').status).toBe('blocked');

    const activated = await post(api(`/projects/${projectId}/activate`), {
      expectedVersion: project.version,
    });
    expect(activated.statusCode, activated.body).toBe(200);
    const active = await progress(`?projectId=${projectId}`);
    expect(step(active, 'activate_project').status).toBe('done');
    expect(step(active, 'complete_stages').status).toBe('ready');

    const missing = await get(
      smart('/walker/progress?projectId=0a1b2c3d-1111-4222-8333-444455556666'),
    );
    expect(missing.statusCode).toBe(404);
    expect(missing.json<{ code: string }>().code).toBe('SMART_PROJECT_NOT_FOUND');
    expect((await get(smart('/walker/progress?projectId=nope'))).statusCode).toBe(400);
  });

  it('chat answers once, read-only, with a snapshot that holds no project content', async () => {
    const invoke = vi.spyOn(h.fake, 'invoke');
    const started = await post(smart('/conversations'), {
      kind: 'walker',
      route: `/fa/projects/${projectId}`,
      projectId,
    });
    expect(started.statusCode, started.body).toBe(201);
    conversationId = started.json<{ conversation: { id: string } }>().conversation.id;

    const sent = await post(smart(`/conversations/${conversationId}/messages`), {
      content: 'مرحلهٔ بعدی چیست؟',
      route: `/fa/projects/${projectId}`,
      locale: 'fa',
      projectId,
      walkerStep: 'activate_project',
    });
    expect(sent.statusCode, sent.body).toBe(201);
    const { userMessage, assistantMessage } = sent.json<{
      userMessage: Message;
      assistantMessage: Message;
    }>();
    expect(userMessage).toMatchObject({
      role: 'user',
      content: 'مرحلهٔ بعدی چیست؟',
      status: 'done',
    });
    expect(assistantMessage).toMatchObject({ role: 'assistant', status: 'done' });
    expect(assistantMessage.content).toMatch(/^Fake answer: /);
    answerId = assistantMessage.id;

    expect(invoke).toHaveBeenCalledTimes(1);
    const request = invoke.mock.calls[0]![0];
    expect(request.model).toBe('fake-standard');
    expect(request.responseSchema).toBeUndefined();
    expect(request.messages).toEqual([{ role: 'user', content: 'مرحلهٔ بعدی چیست؟' }]);
    const instructions = request.instructions ?? '';
    expect(instructions).toContain('<context>');
    expect(instructions).toContain('"nextStep":"add_sources"');
    expect(instructions).toContain('"walkerStep":"activate_project"');
    expect(instructions).toContain(projectId);
    // Project titles and problem statements are confidential content and never leave the system.
    expect(instructions).not.toContain(PROJECT_TITLE);
    expect(instructions).not.toContain('17.5');

    const invocation = await h.admin.query<{ purpose: string; project_id: string; status: string }>(
      `select purpose, project_id, status from model_invocations where workspace_id = $1 and purpose like 'smart_%'`,
      [h.ids.workspaceA],
    );
    expect(invocation.rows).toEqual([
      { purpose: 'smart_chat', project_id: projectId, status: 'succeeded' },
    ]);

    // The second turn carries the first exchange so the model keeps the thread.
    await post(smart(`/conversations/${conversationId}/messages`), {
      content: 'و بعد از آن؟',
      route: `/fa/projects/${projectId}`,
      locale: 'fa',
      projectId,
    });
    const second = invoke.mock.calls[1]![0];
    expect(second.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);

    const thread = await get(smart(`/conversations/${conversationId}`));
    const body = thread.json<{
      conversation: { title: string; kind: string; projectId: string };
      messages: Message[];
    }>();
    expect(body.messages).toHaveLength(4);
    expect(body.conversation).toMatchObject({
      kind: 'walker',
      title: 'مرحلهٔ بعدی چیست؟',
      projectId,
    });
    expect(
      (await get(smart('/conversations')))
        .json<{ items: { id: string }[] }>()
        .items.map((item) => item.id),
    ).toContain(conversationId);
  });

  it('report mode uses its own purpose and instructions', async () => {
    const invoke = vi.spyOn(h.fake, 'invoke');
    invoke.mockClear();
    const sent = await post(smart(`/conversations/${conversationId}/messages`), {
      content: 'Write the report',
      mode: 'report',
      route: '/en/audit',
      locale: 'en',
    });
    expect(sent.statusCode, sent.body).toBe(201);
    expect(invoke.mock.calls[0]![0].instructions).toContain('complete bug report');
    const purposes = await h.admin.query<{ purpose: string }>(
      `select purpose from model_invocations where workspace_id = $1 order by created_at desc limit 1`,
      [h.ids.workspaceA],
    );
    expect(purposes.rows[0]!.purpose).toBe('smart_report');
  });

  it('keeps a provider failure as a failed answer instead of failing the request', async () => {
    h.fake.script = () => 'permanent';
    try {
      const sent = await post(smart(`/conversations/${conversationId}/messages`), {
        content: 'try again',
        route: '/fa',
        locale: 'fa',
      });
      expect(sent.statusCode, sent.body).toBe(201);
      const { assistantMessage } = sent.json<{ assistantMessage: Message }>();
      expect(assistantMessage).toMatchObject({ status: 'failed', content: 'fake_permanent' });
      const saved = await post(smart('/issues'), { messageId: assistantMessage.id });
      expect(saved.statusCode).toBe(409);
      expect(saved.json<{ code: string }>().code).toBe('SMART_MESSAGE_NOT_SAVABLE');
    } finally {
      h.fake.script = () => null;
    }
  });

  it('refuses to chat when no model is configured and stores nothing', async () => {
    const started = await post(
      smart('/conversations', h.ids.workspaceB),
      { kind: 'walker', route: '/fa' },
      cookieB,
    );
    const id = started.json<{ conversation: { id: string } }>().conversation.id;
    const sent = await post(
      smart(`/conversations/${id}/messages`, h.ids.workspaceB),
      { content: 'hello', route: '/fa', locale: 'en' },
      cookieB,
    );
    expect(sent.statusCode).toBe(409);
    expect(sent.json<{ code: string }>().code).toBe('AI_NOT_CONFIGURED');
    const thread = await get(smart(`/conversations/${id}`, h.ids.workspaceB), cookieB);
    expect(thread.json<{ messages: unknown[] }>().messages).toHaveLength(0);
  });

  it('isolates chats by workspace and by admin (RLS)', async () => {
    expect((await get(smart(`/conversations/${conversationId}`), cookieB)).statusCode).toBe(404);
    expect(
      (await get(smart(`/conversations/${conversationId}`, h.ids.workspaceB), cookieB)).statusCode,
    ).toBe(404);

    // A second admin of the same workspace: only the chat owner may read or extend a conversation.
    const secondAdmin = '00000000-0000-4000-8000-0000000000aa';
    const counts = async (actor: string) => {
      const client = await h.admin.query('select 1'); // keep the admin connection alive
      void client;
      await h.admin.query('begin');
      try {
        await h.admin.query('set local role docoo_app');
        await h.admin.query(
          `select set_config('app.workspace_id', $1, true), set_config('app.actor_id', $2, true)`,
          [h.ids.workspaceA, actor],
        );
        const rows = await h.admin.query<{ conversations: number; messages: number }>(
          `select (select count(*)::int from smart_conversations) as conversations,
                  (select count(*)::int from smart_messages) as messages`,
        );
        let inserted = true;
        await h.admin.query('savepoint try_insert');
        try {
          await h.admin.query(
            `insert into smart_messages (workspace_id, conversation_id, role, content)
             values ($1, $2, 'user', 'sneaky')`,
            [h.ids.workspaceA, conversationId],
          );
        } catch {
          inserted = false;
          await h.admin.query('rollback to savepoint try_insert');
        }
        return { ...rows.rows[0]!, inserted };
      } finally {
        await h.admin.query('rollback');
      }
    };
    expect(await counts(h.ids.userA)).toMatchObject({ conversations: 1, inserted: true });
    expect(await counts(secondAdmin)).toEqual({ conversations: 0, messages: 0, inserted: false });
  });

  it('groups browser errors by fingerprint and masks credentials', async () => {
    const report = {
      kind: 'render',
      message: 'Cannot read properties of undefined (reading "id") for admin@example.com',
      detail: 'TypeError: x\n at render (Bearer abcdefghijklmnop12345)',
      page: `/fa/projects/${projectId}/documents`,
      projectId,
    };
    const first = await post(smart('/errors'), report);
    expect(first.statusCode, first.body).toBe(201);
    const errorId = first.json<{ error: { id: string; category: string } }>().error;
    expect(errorId.category).toBe('ui');
    const again = await post(smart('/errors'), {
      ...report,
      page: '/fa/projects/aaaaaaaa-1111-4222-8333-444455556666/documents',
      projectId: undefined,
    });
    expect(again.json<{ error: { id: string } }>().error.id).toBe(errorId.id);

    const detail = (await get(smart(`/errors/${errorId.id}`))).json<{ error: SmartError }>().error;
    expect(detail).toMatchObject({
      source: 'client',
      category: 'ui',
      status: 'new',
      occurrences: 2,
    });
    expect(detail.message).toContain('[email]');
    expect(detail.message).not.toContain('admin@example.com');
    expect(detail.stack).toContain('[REDACTED]');
    expect(detail.stack).not.toContain('abcdefghijklmnop12345');

    const invalid = await post(smart('/errors'), { kind: 'nope', message: 'x' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json<{ code: string }>().code).toBe('SMART_INVALID_REQUEST');
    expect((await post(smart('/errors'), { ...report, extra: true })).statusCode).toBe(400);
  });

  it('triages errors: fixed re-opens on recurrence, ignored stays ignored', async () => {
    const list = (await get(smart('/errors?source=client&category=ui'))).json<{
      items: SmartError[];
      nextCursor: string | null;
    }>();
    expect(list.items).toHaveLength(1);
    const id = list.items[0]!.id;
    const body = {
      kind: 'render',
      message: 'Cannot read properties of undefined (reading "id") for admin@example.com',
      page: '/fa/projects/bbbbbbbb-1111-4222-8333-444455556666/documents',
    };

    const fixed = await patch(smart(`/errors/${id}`), { status: 'fixed' });
    expect(fixed.json<{ error: SmartError }>().error.status).toBe('fixed');
    await post(smart('/errors'), body);
    expect((await get(smart(`/errors/${id}`))).json<{ error: SmartError }>().error.status).toBe(
      'new',
    );

    await patch(smart(`/errors/${id}`), { status: 'ignored' });
    await post(smart('/errors'), body);
    expect((await get(smart(`/errors/${id}`))).json<{ error: SmartError }>().error).toMatchObject({
      status: 'ignored',
      occurrences: 4,
    });

    expect((await patch(smart(`/errors/${id}`), { status: 'bogus' })).statusCode).toBe(400);
    expect(
      (await get(smart('/errors?status=ignored&search=reading'))).json<{ items: unknown[] }>()
        .items,
    ).toHaveLength(1);
    expect(
      (await get(smart('/errors?status=fixed'))).json<{ items: unknown[] }>().items,
    ).toHaveLength(0);
    expect((await get(smart('/errors?cursor=garbage'))).statusCode).toBe(400);
    expect((await get(smart('/errors/0a1b2c3d-1111-4222-8333-444455556666'))).statusCode).toBe(404);
  });

  it('purges closed errors older than the retention setting and never an open one', async () => {
    const insert = (fingerprint: string, status: string, days: number) =>
      h.admin.query(
        `insert into app_errors (workspace_id, source, category, fingerprint, message, status, last_seen_at)
         values ($1, 'client', 'ui', $2, 'retention probe', $3::app_error_status, now() - make_interval(days => $4))
         returning id`,
        [h.ids.workspaceA, fingerprint, status, days],
      );
    const old = [
      (await insert('ret-fixed-old', 'fixed', 120)).rows[0].id as string,
      (await insert('ret-ignored-old', 'ignored', 200)).rows[0].id as string,
    ];
    const open = (await insert('ret-new-old', 'new', 400)).rows[0].id as string;
    const recent = (await insert('ret-fixed-recent', 'fixed', 3)).rows[0].id as string;
    const purge = (dryRun: boolean) =>
      post(api('/retention/purge'), {
        reason: 'Retention probe',
        dryRun,
      });
    const remaining = async () =>
      (
        await h.admin.query(`select id from app_errors where id = any($1::uuid[])`, [
          [...old, open, recent],
        ])
      ).rows
        .map((row) => row.id as string)
        .sort();

    const dry = await purge(true);
    expect(dry.statusCode, dry.body).toBe(200);
    expect(dry.json<{ appErrors: number }>().appErrors).toBe(2);
    expect(await remaining()).toHaveLength(4);
    const real = await purge(false);
    expect(real.statusCode, real.body).toBe(200);
    expect(real.json<{ appErrors: number }>().appErrors).toBe(2);
    expect(await remaining()).toEqual([open, recent].sort());
    const audit = await h.admin.query(
      `select 1 from audit_events where workspace_id = $1 and action = 'retention.purge'`,
      [h.ids.workspaceA],
    );
    expect(audit.rowCount).toBeGreaterThan(0);

    // The database itself refuses any other way to delete an error entry.
    await expect(h.admin.query('delete from app_errors where id = $1', [open])).rejects.toThrow(
      /retention purge/u,
    );
  });

  it('records server 5xx after replying, never 4xx, and never request content', async () => {
    const before = (await get(smart('/errors?source=server'))).json<{ items: unknown[] }>().items
      .length;
    await get(api('/projects/0a1b2c3d-1111-4222-8333-444455556666')); // 404 is not recorded

    const topics = h.app.get(TopicsService, { strict: false });
    vi.spyOn(topics, 'list').mockRejectedValueOnce(new Error('boom: connection terminated'));
    const failed = await get(api('/topics?status=all'));
    expect(failed.statusCode).toBe(500);
    // Nest's default answer is unchanged.
    expect(failed.json()).toEqual({ statusCode: 500, message: 'Internal server error' });

    const recorded = await waitFor(async () => {
      const found = (await get(smart('/errors?source=server'))).json<{ items: SmartError[] }>()
        .items;
      return found.length > before ? found[0]! : null;
    });
    expect(recorded).toMatchObject({
      source: 'server',
      category: 'database',
      status: 'new',
      method: 'GET',
      route: '/v1/workspaces/:workspaceId/topics',
    });
    const detail = (await get(smart(`/errors/${recorded.id}`))).json<{ error: SmartError }>().error;
    expect(detail.message).toContain('boom');
    expect(detail.stack).toContain('Error: boom');
    expect(detail.context).toEqual({ exception: 'Error', queryKeys: ['status'] });
    expect(
      (await get(smart('/errors?source=server'))).json<{ items: unknown[] }>().items,
    ).toHaveLength(before + 1);
  });

  it('feeds new errors to other sessions and counts open items', async () => {
    const feed = (await get(smart('/errors/feed?since=2020-01-01T00:00:00Z'))).json<{
      items: SmartError[];
      now: string;
    }>();
    expect(feed.items.length).toBeGreaterThan(0);
    expect(feed.items.every((item) => ['new', 'seen'].includes(item.status))).toBe(true);
    const none = (await get(smart(`/errors/feed?since=${encodeURIComponent(feed.now)}`))).json<{
      items: unknown[];
    }>();
    expect(none.items).toHaveLength(0);
    expect((await get(smart('/errors/feed?since=yesterday'))).statusCode).toBe(400);

    const summary = (await get(smart('/summary'))).json<{
      openErrors: number;
      openIssues: number;
    }>();
    expect(summary.openErrors).toBeGreaterThanOrEqual(1);
    expect(summary.openIssues).toBe(0);
    // Another workspace never sees these errors.
    const other = (await get(smart('/errors', h.ids.workspaceB), cookieB)).json<{
      items: unknown[];
    }>();
    expect(other.items).toHaveLength(0);
  });

  it('saves a Smart answer verbatim exactly once and manages the ledger', async () => {
    const thread = (await get(smart(`/conversations/${conversationId}`))).json<{
      messages: Message[];
    }>();
    const answer = thread.messages.find((message) => message.id === answerId)!;

    const saved = await post(smart('/issues'), { messageId: answerId });
    expect(saved.statusCode, saved.body).toBe(201);
    const { issue, created } = saved.json<{
      issue: {
        id: string;
        body: string;
        status: string;
        title: string;
        sourceMessageId: string;
        context: Record<string, unknown>;
      };
      created: boolean;
    }>();
    expect(created).toBe(true);
    expect(issue.body).toBe(answer.content);
    expect(issue).toMatchObject({ status: 'open', sourceMessageId: answerId });
    expect(issue.context).toMatchObject({
      projectId,
      walkerStep: 'activate_project',
      conversationKind: 'walker',
    });

    const again = (await post(smart('/issues'), { messageId: answerId })).json<{
      issue: { id: string };
      created: boolean;
    }>();
    expect(again).toMatchObject({ created: false, issue: { id: issue.id } });
    expect((await get(smart('/issues'))).json<{ items: unknown[] }>().items).toHaveLength(1);

    const userMessage = thread.messages.find((message) => message.role === 'user')!;
    expect((await post(smart('/issues'), { messageId: userMessage.id })).statusCode).toBe(409);
    expect(
      (await post(smart('/issues'), { messageId: '0a1b2c3d-1111-4222-8333-444455556666' }))
        .statusCode,
    ).toBe(404);

    const marked = await get(smart(`/conversations/${conversationId}`));
    expect(
      marked
        .json<{ messages: { id: string; savedIssueId?: string | null }[] }>()
        .messages.find((message) => message.id === answerId)?.savedIssueId,
    ).toBe(issue.id);

    const updated = await patch(smart(`/issues/${issue.id}`), {
      status: 'in_progress',
      note: 'Investigating the stage gate.',
    });
    expect(updated.json<{ issue: { status: string; note: string } }>().issue).toMatchObject({
      status: 'in_progress',
      note: 'Investigating the stage gate.',
    });
    expect((await patch(smart(`/issues/${issue.id}`), {})).statusCode).toBe(400);
    expect((await patch(smart(`/issues/${issue.id}`), { status: 'done' })).statusCode).toBe(400);
    expect(
      (await get(smart('/issues?status=in_progress&search=fake'))).json<{ items: unknown[] }>()
        .items,
    ).toHaveLength(1);
    expect(
      (await get(smart('/issues?status=fixed'))).json<{ items: unknown[] }>().items,
    ).toHaveLength(0);
    expect((await get(smart('/summary'))).json<{ openIssues: number }>().openIssues).toBe(1);
    // Another workspace cannot see or change it.
    expect((await get(smart(`/issues/${issue.id}`, h.ids.workspaceB), cookieB)).statusCode).toBe(
      404,
    );
    expect(
      (await patch(smart(`/issues/${issue.id}`, h.ids.workspaceB), { status: 'fixed' }, cookieB))
        .statusCode,
    ).toBe(404);

    // Deleting the conversation keeps the ledger entry but clears its message link.
    const removed = await h.request('DELETE', smart(`/conversations/${conversationId}`), {
      cookie: cookieA,
    });
    expect(removed.statusCode).toBe(200);
    expect((await get(smart(`/conversations/${conversationId}`))).statusCode).toBe(404);
    const kept = (await get(smart(`/issues/${issue.id}`))).json<{
      issue: { sourceMessageId: string | null; body: string };
    }>().issue;
    expect(kept).toMatchObject({ sourceMessageId: null, body: answer.content });

    const deleted = await h.request('DELETE', smart(`/issues/${issue.id}`), { cookie: cookieA });
    expect(deleted.statusCode).toBe(200);
    expect((await get(smart(`/issues/${issue.id}`))).statusCode).toBe(404);
  });

  it('audits Smart mutations without storing content', async () => {
    const actions = await auditActions();
    for (const action of [
      'smart.error_status_changed',
      'smart.issue_saved',
      'smart.issue_updated',
      'smart.issue_deleted',
      'smart.conversation_deleted',
    ]) {
      expect(actions, action).toContain(action);
    }
    const rows = await h.admin.query<{ after: unknown; before: unknown }>(
      `select before, after from audit_events where workspace_id = $1 and action like 'smart.%'`,
      [h.ids.workspaceA],
    );
    const serialized = JSON.stringify(rows.rows);
    expect(serialized).not.toContain('Fake answer');
    expect(serialized).not.toContain('Investigating the stage gate');
  });
});
