import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { StageChatService } from '../src/stage-chat/stage-chat.service.js';
import { adminUrl, createHarness, type Harness } from './support/harness.js';

let h: Harness;
let cookieA: string;
let cookieB: string;
let projectId: string;
let stageRunId: string;
let outputId: string;
let emptyStageId: string;
const OUTPUT = {
  findings: [{ claim: 'Churn doubles after month four', source: 'k1', evidence: [] }],
};
const api = (suffix: string, workspace = h.ids.workspaceA) =>
  `/v1/workspaces/${workspace}${suffix}`;
const chat = (suffix = '', stage = stageRunId) =>
  api(`/projects/${projectId}/stages/${stage}/messages${suffix}`);

interface Message {
  id: string;
  role: 'admin' | 'agent';
  kind: string;
  content: string;
  status: string;
}
interface Conversation {
  items: Message[];
  pendingRevisionIds: string[];
  used: number;
  limit: number;
  outputId: string | null;
}

async function post(url: string, payload: unknown = {}, cookie = cookieA) {
  return h.request('POST', url, { cookie, payload });
}

describe.skipIf(!adminUrl)('Stage conversation with the agent (ADR-0031 P1)', () => {
  beforeAll(async () => {
    h = await createHarness('stagechat');
    cookieA = await h.login(h.emails.a);
    cookieB = await h.login(h.emails.b);
    const connection = await post(api('/provider-connections'), {
      provider: 'fake',
      name: 'Deterministic',
    });
    const connectionId = connection.json<{ connection: { id: string } }>().connection.id;
    await post(api(`/provider-connections/${connectionId}/health-check`));
    for (const [key, value] of [
      ['ai.connection_id', connectionId],
      ['ai.model', 'fake-standard'],
      ['workflow.stage_chat_max_messages', 5],
    ] as const) {
      const response = await h.request('PUT', api('/settings/assignments'), {
        cookie: cookieA,
        payload: { key, scopeType: 'workspace', scopeId: h.ids.workspaceA, value, reason: 'test' },
      });
      expect(response.statusCode, response.body).toBe(200);
    }
    const topic = await post(api('/topics'), { code: 'retail', title: 'Retail' });
    const topicId = topic.json<{ topic: { id: string } }>().topic.id;
    const created = await post(api('/projects'), {
      code: 'chat-1',
      title: 'Churn programme',
      initialProblem: 'Reduce repeat-customer churn in Q3.',
      topics: [{ topicId }],
    });
    projectId = created.json<{ project: { id: string } }>().project.id;

    const run = await h.admin.query<{ id: string }>(
      `insert into workflow_runs (workspace_id,project_id,run_no,temporal_workflow_id)
       values ($1,$2,1,$3) returning id`,
      [h.ids.workspaceA, projectId, `stage-chat-${projectId}`],
    );
    const stages = await h.admin.query<{ id: string; stage: string }>(
      `insert into stage_runs (workspace_id,project_id,run_id,stage,sequence,status)
       values ($1,$2,$3,'research',2,'waiting_for_human'), ($1,$2,$3,'ideation',3,'pending')
       returning id, stage::text as stage`,
      [h.ids.workspaceA, projectId, run.rows[0]!.id],
    );
    stageRunId = stages.rows.find((row) => row.stage === 'research')!.id;
    emptyStageId = stages.rows.find((row) => row.stage === 'ideation')!.id;
    const output = await h.admin.query<{ id: string }>(
      `insert into stage_outputs (workspace_id,stage_run_id,version_no,content,content_sha256,origin)
       values ($1,$2,1,$3::jsonb,$4,'model') returning id`,
      [
        h.ids.workspaceA,
        stageRunId,
        JSON.stringify(OUTPUT),
        createHash('sha256').update(JSON.stringify(OUTPUT)).digest('hex'),
      ],
    );
    outputId = output.rows[0]!.id;
    await h.admin.query('update stage_runs set latest_output_id = $2 where id = $1', [
      stageRunId,
      outputId,
    ]);
    await h.admin.query(
      `insert into gate_decisions (workspace_id,stage_run_id,output_id,mode) values ($1,$2,$3,'manual')`,
      [h.ids.workspaceA, stageRunId, outputId],
    );
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await h?.close();
  });

  it('refuses to talk about a stage that has no output yet', async () => {
    const response = await post(chat('', emptyStageId), { kind: 'ask', content: 'Hello?' });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('STAGE_CHAT_NO_OUTPUT');
  });

  it('answers a question from the stage output without changing it', async () => {
    const invoke = vi.spyOn(h.fake, 'invoke');
    // A newly uploaded attachment takes time to scan; that wait must consume the same
    // request budget as the model so the combined response stays below the proxy timeout.
    const files = vi
      .spyOn(h.app.get<{ readAttachments: () => Promise<[]> }>(StageChatService), 'readAttachments')
      .mockImplementationOnce(async () => {
        await delay(120);
        return [];
      });
    const sent = await post(chat(), { kind: 'ask', content: 'Why do you say churn doubles?' });
    files.mockRestore();
    expect(sent.statusCode, sent.body).toBe(200);
    const { asked, answer } = sent.json<{ asked: Message; answer: Message }>();
    expect(asked).toMatchObject({ role: 'admin', kind: 'ask', status: 'done' });
    expect(answer).toMatchObject({ role: 'agent', kind: 'answer', status: 'done' });
    expect(answer.content).toMatch(/^Fake answer: /);

    const request = invoke.mock.calls[0]![0];
    expect(request.timeoutMs).toBeGreaterThan(0);
    expect(request.timeoutMs).toBeLessThanOrEqual(24_880);
    expect(request.responseSchema).toBeUndefined();
    expect(request.instructions ?? '').toContain('researcher');
    expect(request.instructions ?? '').toContain(
      'Never say or imply that you have changed the output',
    );
    expect(request.messages[0]!.content).toContain('Churn doubles after month four');

    const outputs = await h.admin.query('select 1 from stage_outputs where stage_run_id = $1', [
      stageRunId,
    ]);
    expect(outputs.rowCount).toBe(1);
    const audit = await h.admin.query(
      `select after from audit_events where action = 'workflow.stage_chat_message' and target_id = $1`,
      [stageRunId],
    );
    expect(JSON.stringify(audit.rows)).not.toContain('Why do you say');
  });

  it('keeps a revision request pending until it is sent back, and sends it as a rejection once', async () => {
    const stated = await post(chat(), {
      kind: 'revision_request',
      content: 'Add the sources behind the churn claim.',
    });
    expect(stated.statusCode, stated.body).toBe(200);
    const requestId = stated.json<{ asked: Message }>().asked.id;

    const listed = await h.request('GET', chat(), { cookie: cookieA });
    const conversation = listed.json<Conversation>();
    expect(conversation.outputId).toBe(outputId);
    expect(conversation.pendingRevisionIds).toEqual([requestId]);
    expect(conversation.limit).toBe(5);

    const back = await post(chat('/send-as-rejection'), { messageIds: [requestId] });
    expect(back.statusCode, back.body).toBe(200);
    const review = await h.admin.query<{ action: string; comment: string }>(
      `select action::text as action, comment from stage_reviews where stage_run_id = $1`,
      [stageRunId],
    );
    expect(review.rows).toEqual([
      { action: 'reject', comment: 'Add the sources behind the churn claim.' },
    ]);

    const after = (await h.request('GET', chat(), { cookie: cookieA })).json<Conversation>();
    expect(after.pendingRevisionIds).toEqual([]);
    const again = await post(chat('/send-as-rejection'), { messageIds: [requestId] });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ code: string }>().code).toBe('STAGE_CHAT_ALREADY_SENT');
  });

  it('refuses attachments that are not sources of the project', async () => {
    const unknown = await post(chat(), {
      kind: 'ask',
      content: 'Read this file.',
      attachments: [{ sourceId: '00000000-0000-4000-8000-000000000000' }],
    });
    expect(unknown.statusCode, unknown.body).toBe(404);
    expect(unknown.json<{ code: string }>().code).toBe('STAGE_CHAT_ATTACHMENT_NOT_FOUND');
    const malformed = await post(chat(), {
      kind: 'ask',
      content: 'Read this file.',
      attachments: [{ sourceId: 'not-an-id' }],
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json<{ code: string }>().code).toBe('STAGE_CHAT_INVALID_REQUEST');
  });

  it('stops at the message limit', async () => {
    // Two messages were used above; the limit is five.
    for (let index = 0; index < 3; index += 1) {
      const sent = await post(chat(), { kind: 'ask', content: `Question ${index}` });
      expect(sent.statusCode, sent.body).toBe(200);
    }
    const over = await post(chat(), { kind: 'ask', content: 'One too many' });
    expect(over.statusCode).toBe(409);
    expect(over.json<{ code: string }>().code).toBe('STAGE_CHAT_LIMIT');
  });

  it('never shows the conversation to another workspace', async () => {
    const response = await h.request(
      'GET',
      `/v1/workspaces/${h.ids.workspaceB}/projects/${projectId}/stages/${stageRunId}/messages`,
      { cookie: cookieB },
    );
    expect(response.statusCode).toBe(404);
  });

  it('keeps the messages append-only', async () => {
    await expect(h.admin.query(`update stage_messages set content = 'x'`)).rejects.toThrow(
      /append-only/,
    );
    await expect(h.admin.query(`delete from stage_messages`)).rejects.toThrow(/append-only/);
  });
});
