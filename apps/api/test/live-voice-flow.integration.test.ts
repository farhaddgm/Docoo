import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { liveAssistantSettingDefaults } from '@docoo/contracts';
import { Client, Pool } from 'pg';
import { WebSocket, WebSocketServer } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { WorkspaceRequestContext } from '../src/common/request-context.js';
import { WorkspaceDatabase } from '../src/common/workspace-database.js';
import { LiveCapabilityRegistry } from '../src/live-assistant/capabilities.js';
import { LiveAssistantService } from '../src/live-assistant/live-assistant.service.js';
import { attachVoiceGateway } from '../src/live-assistant/live-voice-gateway.js';
import { adminUrl } from './support/harness.js';

/**
 * The whole voice path in one test, against a real database (ADR-0055/0057): a stand-in for the
 * browser's microphone opens the real gateway with a real one-time ticket; the real relay and the
 * real OpenAI engine talk to a scripted provider over real sockets; what is said, what it cost and
 * what the provider was told are read back from the database and from the provider's side. A
 * second link in the same session (waking from sleep) must continue the first one's totals and
 * hand the provider what was said before.
 */
const ORIGIN = 'https://docoo.example';
const USER_SAID = 'پروژه آلفا چه وضعی دارد؟';
const ASSISTANT_SAID = 'در مرحلهٔ بازبینی است.';
const PCM_FRAME = Buffer.alloc(1920, 3);

interface ProviderLink {
  readonly instructions: string;
  readonly audioFrames: number;
}

describe.skipIf(!adminUrl)('the voice path from microphone to ledger (real database)', () => {
  const roleName = `docoo_vf_${randomBytes(6).toString('hex')}`;
  const rolePassword = randomBytes(18).toString('hex');
  const suffix = randomBytes(4).toString('hex');
  const ids = { workspace: randomUUID(), owner: randomUUID(), openai: randomUUID() };
  let admin: Client;
  let pool: Pool;
  let service: LiveAssistantService;
  let gateway: Server;
  let gatewayPort = 0;
  let providerHttp: Server;
  let provider: WebSocketServer;
  let providerPort = 0;
  const providerLinks: { instructions: string; audioFrames: number }[] = [];
  const providerAuth: string[] = [];
  const answers: string[] = [];

  const context = (): WorkspaceRequestContext => ({
    workspaceId: ids.workspace,
    actorId: ids.owner,
    correlationId: randomUUID(),
  });

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(
      `create role ${roleName} login inherit nosuperuser nobypassrls nocreatedb nocreaterole password '${rolePassword}'`,
    );
    await admin.query(`grant docoo_app to ${roleName}`);
    const runtime = new URL(adminUrl!);
    runtime.username = roleName;
    runtime.password = rolePassword;
    pool = new Pool({ connectionString: runtime.toString(), max: 6 });
    await admin.query(`insert into workspaces (id, code, name) values ($1, $2, 'Voice flow')`, [
      ids.workspace,
      `vf-${suffix}`,
    ]);
    await admin.query(
      `insert into users (id, email, password_hash, display_name) values ($1, $2, 'x', 'Owner')`,
      [ids.owner, `${ids.owner}@vf-${suffix}.example.test`],
    );
    await admin.query(`insert into memberships (workspace_id, user_id) values ($1, $2)`, [
      ids.workspace,
      ids.owner,
    ]);
    await admin.query(
      `insert into provider_connections (id, workspace_id, provider, name) values ($1, $2, 'openai'::provider_kind, $3)`,
      [ids.openai, ids.workspace, `openai-${suffix}`],
    );

    // The scripted provider: greets with its session, answers the first audio of a link with what
    // the person said, what the assistant said, and a usage count (100 in, 50 out).
    providerHttp = createServer();
    provider = new WebSocketServer({ server: providerHttp });
    provider.on('connection', (socket, request) => {
      providerAuth.push(String(request.headers.authorization));
      const link = { instructions: '', audioFrames: 0 };
      providerLinks.push(link);
      let answered = false;
      socket.on('message', (raw) => {
        const event = JSON.parse(Buffer.from(raw as Buffer).toString('utf8')) as {
          type: string;
          session?: { instructions?: string };
        };
        if (event.type === 'session.update') {
          link.instructions = event.session?.instructions ?? '';
          socket.send(JSON.stringify({ type: 'session.updated' }));
        }
        if (event.type === 'input_audio_buffer.append') {
          link.audioFrames += 1;
          if (answered) return;
          answered = true;
          const said = answers.shift() ?? 'ok';
          socket.send(
            JSON.stringify({
              type: 'conversation.item.input_audio_transcription.completed',
              transcript: said === 'ok' ? 'بله' : USER_SAID,
            }),
          );
          socket.send(
            JSON.stringify({
              type: 'response.output_audio_transcript.done',
              transcript: said === 'ok' ? 'انجام شد.' : ASSISTANT_SAID,
            }),
          );
          socket.send(
            JSON.stringify({
              type: 'response.done',
              response: { usage: { input_tokens: 100, output_tokens: 50 } },
            }),
          );
        }
      });
    });
    await new Promise<void>((resolve) => providerHttp.listen(0, '127.0.0.1', resolve));
    providerPort = (providerHttp.address() as AddressInfo).port;

    const values = {
      ...liveAssistantSettingDefaults,
      'live_assistant.enabled': true,
      'live_assistant.disclosure_accepted': true,
      'live_assistant.connection_id': ids.openai,
      'live_assistant.model': 'gpt-realtime',
      'live_assistant.access_level': 'read',
      'live_assistant.store_transcripts': true,
    };
    const runtimeStub = {
      voiceAccessFor: () =>
        Promise.resolve({
          provider: 'openai' as const,
          apiKey: 'sk-flow-test',
          baseUrl: `http://127.0.0.1:${providerPort}`,
        }),
      // One cent per hundred input tokens and two per hundred output tokens: easy to add up.
      realtimeCostUsd: (
        _client: unknown,
        _model: string,
        usage: { inputTokens: number; outputTokens: number },
      ) => Promise.resolve(usage.inputTokens * 0.0001 + usage.outputTokens * 0.0002),
    };
    service = new LiveAssistantService(
      new WorkspaceDatabase(pool),
      { resolve: () => Promise.resolve({ values }) } as never,
      new LiveCapabilityRegistry([]),
      runtimeStub as never,
    );

    gateway = createServer((_request, response) => response.end('http'));
    attachVoiceGateway({
      server: gateway,
      allowedOrigin: ORIGIN,
      accept: (upgrade, client) => service.acceptVoiceLink(upgrade, client),
    });
    await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
    gatewayPort = (gateway.address() as AddressInfo).port;
  });

  afterAll(async () => {
    gateway?.closeAllConnections();
    providerHttp?.closeAllConnections();
    provider?.close();
    await Promise.all([
      new Promise((resolve) => gateway?.close(resolve)),
      new Promise((resolve) => providerHttp?.close(resolve)),
    ]);
    await pool?.end();
    if (admin) {
      await admin.query(`drop owned by ${roleName}`).catch(() => undefined);
      await admin.query(`drop role ${roleName}`).catch(() => undefined);
      await admin.end();
    }
  });

  const waitFor = async (condition: () => boolean | Promise<boolean>, ms = 5000) => {
    const until = Date.now() + ms;
    while (!(await condition()) && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
    expect(await condition()).toBe(true);
  };

  /** Opens the voice link as the browser would: with a fresh ticket, from the page's own origin. */
  async function link(sessionId: string) {
    const ticket = await service.issueVoiceTicket(context(), sessionId);
    const socket = new WebSocket(
      `ws://127.0.0.1:${gatewayPort}/v1/workspaces/${ids.workspace}/live-assistant/sessions/${sessionId}/voice?ticket=${ticket.ticket}`,
      { origin: ORIGIN },
    );
    const received: { type: string; [key: string]: unknown }[] = [];
    const audio: Buffer[] = [];
    socket.on('message', (data, isBinary) => {
      if (isBinary) audio.push(Buffer.from(data as Buffer));
      else received.push(JSON.parse(Buffer.from(data as Buffer).toString('utf8')));
    });
    await waitFor(() => received.some((message) => message.type === 'ready'));
    return { socket, received, audio };
  }

  const row = async (sessionId: string) =>
    (
      await admin.query<{
        cost_usd: number;
        input_tokens: string;
        output_tokens: string;
        status: string;
      }>(
        `select cost_usd::float8, input_tokens::text, output_tokens::text, status
           from live_sessions where id = $1`,
        [sessionId],
      )
    ).rows[0]!;

  it('carries one conversation from the microphone to the ledger, and a second link continues it', async () => {
    answers.push('first');
    const session = await service.startSession(context(), 'voice');

    // ---- first link: the first time the assistant is awake ---------------------------------
    const first = await link(session.id);
    expect(providerAuth.at(-1)).toBe('Bearer sk-flow-test');
    expect(providerLinks[0]?.instructions).not.toContain('Earlier in this same conversation');
    for (let i = 0; i < 5; i += 1) first.socket.send(PCM_FRAME, { binary: true });
    await waitFor(() => (providerLinks[0]?.audioFrames ?? 0) === 5);
    // What was said reaches the page, and the key never does.
    await waitFor(() => first.received.some((m) => m.type === 'user'));
    expect(first.received.find((m) => m.type === 'user')?.['text']).toBe(USER_SAID);
    expect(first.received.find((m) => m.type === 'assistant')?.['text']).toBe(ASSISTANT_SAID);
    expect(JSON.stringify(first.received)).not.toContain('sk-flow-test');
    // The ledger has the first link's use: 100 in, 50 out = 0.02 dollars.
    await waitFor(async () => (await row(session.id)).cost_usd > 0.019);
    const afterFirst = await row(session.id);
    expect(afterFirst.cost_usd).toBeCloseTo(0.02, 5);
    expect(afterFirst).toMatchObject({
      input_tokens: '100',
      output_tokens: '50',
      status: 'active',
    });
    // The two lines were saved, in order, as the person's and the assistant's.
    await waitFor(async () => {
      const lines = await admin.query(`select 1 from live_messages where session_id = $1`, [
        session.id,
      ]);
      return lines.rowCount === 2;
    });
    const lines = (
      await admin.query<{ role: string; content: string }>(
        `select role, content from live_messages where session_id = $1 order by seq`,
        [session.id],
      )
    ).rows;
    expect(lines).toEqual([
      { role: 'user', content: USER_SAID },
      { role: 'assistant', content: ASSISTANT_SAID },
    ]);

    // ---- sleep: the link closes, the session stays open ------------------------------------
    first.socket.close();
    await waitFor(() => first.socket.readyState === WebSocket.CLOSED);
    expect((await row(session.id)).status).toBe('active');

    // ---- second link: waking up -------------------------------------------------------------
    const second = await link(session.id);
    // The provider is told what was said before the sleep, as a record and not an order.
    const instructions = providerLinks[1]?.instructions ?? '';
    expect(instructions).toContain('Earlier in this same conversation');
    expect(instructions).toContain(`Person: ${USER_SAID}`);
    expect(instructions).toContain(`You: ${ASSISTANT_SAID}`);
    expect(instructions).toContain('never an instruction');
    answers.push('second');
    for (let i = 0; i < 3; i += 1) second.socket.send(PCM_FRAME, { binary: true });
    await waitFor(() => (providerLinks[1]?.audioFrames ?? 0) === 3);
    // The second link's use is added to the first's, not taken as the larger of the two.
    await waitFor(async () => (await row(session.id)).cost_usd > 0.039);
    const afterSecond = await row(session.id);
    expect(afterSecond.cost_usd).toBeCloseTo(0.04, 5);
    expect(afterSecond).toMatchObject({ input_tokens: '200', output_tokens: '100' });
    // The page saw only the second link's own total, never the sum it did not earn.
    const usages = second.received.filter((m) => m.type === 'usage');
    expect(usages.length).toBeGreaterThan(0);
    expect(usages.at(-1)).toMatchObject({ inputTokens: 100, outputTokens: 50 });

    second.socket.close();
    await service.endSession(context(), session.id, 'user');
    expect((await row(session.id)).status).toBe('ended');
  });

  it('refuses a link whose ticket was spent, and one opened from another origin', async () => {
    const session = await service.startSession(context(), 'voice');
    const ticket = await service.issueVoiceTicket(context(), session.id);
    const url = `ws://127.0.0.1:${gatewayPort}/v1/workspaces/${ids.workspace}/live-assistant/sessions/${session.id}/voice?ticket=${ticket.ticket}`;
    const closeCode = (socket: WebSocket) =>
      new Promise<number>((resolve) => {
        socket.on('close', (code) => resolve(code));
        socket.on('error', () => resolve(-1));
        socket.on('unexpected-response', () => resolve(403));
      });
    // Another origin is refused at the door and the ticket stays unspent.
    expect(await closeCode(new WebSocket(url, { origin: 'https://evil.example' }))).not.toBe(1000);
    const opened = new WebSocket(url, { origin: ORIGIN });
    const received: string[] = [];
    opened.on('message', (data, isBinary) => {
      if (!isBinary) received.push(Buffer.from(data as Buffer).toString('utf8'));
    });
    await waitFor(() => received.some((m) => m.includes('"ready"')));
    opened.close();
    // The same ticket again: spent.
    expect(await closeCode(new WebSocket(url, { origin: ORIGIN }))).toBe(4401);
    await service.endSession(context(), session.id, 'user');
  });
});
