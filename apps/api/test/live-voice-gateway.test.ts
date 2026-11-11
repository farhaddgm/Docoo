import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import type { LiveAskAnswer } from '@docoo/contracts';

import { attachVoiceGateway } from '../src/live-assistant/live-voice-gateway.js';
import { startVoiceRelay, type RelayHost } from '../src/live-assistant/live-voice-relay.js';
import { VoiceTickets } from '../src/live-assistant/live-voice-tickets.js';
import { createOpenAiRealtimeEngine } from '../src/live-assistant/openai-realtime-engine.js';
import { nodeRelaySocketFactory } from '../src/live-assistant/realtime-link.js';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const ORIGIN = 'https://docoo.example';
const context = { workspaceId: WORKSPACE, actorId: 'a', correlationId: 'c' };

const answer: LiveAskAnswer = {
  answer: 'ok',
  actions: [],
  screen: [],
  steps: [],
  toolCalls: 0,
  stop: 'answered',
  errorCode: null,
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
};

interface Rig {
  server: Server;
  port: number;
  tickets: VoiceTickets;
  providerSeen: Record<string, unknown>[];
  providerAuth: string[];
  close: () => Promise<void>;
}

/**
 * A real HTTP server with the real gateway, and a real WebSocket server standing in for the
 * provider: the same bytes travel as in production, only the far end is scripted.
 */
async function rig(): Promise<Rig> {
  const tickets = new VoiceTickets();
  const providerSeen: Record<string, unknown>[] = [];
  const providerAuth: string[] = [];
  const providerHttp = createServer();
  const provider = new WebSocketServer({ server: providerHttp });
  provider.on('connection', (socket, request) => {
    providerAuth.push(String(request.headers.authorization));
    socket.on('message', (raw) => {
      const event = JSON.parse(Buffer.from(raw as Buffer).toString('utf8')) as Record<
        string,
        unknown
      >;
      providerSeen.push(event);
      if (event['type'] === 'session.update') {
        socket.send(JSON.stringify({ type: 'session.updated' }));
      }
      if (event['type'] === 'input_audio_buffer.append') {
        socket.send(
          JSON.stringify({
            type: 'response.output_audio.delta',
            delta: Buffer.from('pcm-out').toString('base64'),
          }),
        );
        socket.send(
          JSON.stringify({
            type: 'response.done',
            response: { usage: { input_tokens: 10, output_tokens: 5 } },
          }),
        );
      }
    });
  });
  await new Promise<void>((resolve) => providerHttp.listen(0, '127.0.0.1', resolve));
  const providerPort = (providerHttp.address() as AddressInfo).port;

  const server = createServer((_request, response) => response.end('http'));
  const host: RelayHost = {
    model: 'm',
    voice: 'alloy',
    language: 'fa',
    instructions: 'x',
    ask: () => Promise.resolve(answer),
    saveLines: () => Promise.resolve(),
    costOf: () => Promise.resolve(0.01),
    record: () => Promise.resolve({ ended: false }),
  };
  attachVoiceGateway({
    server,
    allowedOrigin: ORIGIN,
    accept: (upgrade, client) => {
      const entry = tickets.take(upgrade.ticket, upgrade.sessionId);
      if (!entry || entry.context.workspaceId !== upgrade.workspaceId)
        return Promise.resolve(false);
      startVoiceRelay({
        host,
        client,
        engine: createOpenAiRealtimeEngine({
          socket: nodeRelaySocketFactory(`ws://127.0.0.1:${providerPort}/realtime?model=m`, {
            Authorization: 'Bearer sk-test-key',
          }),
          config: {
            model: host.model,
            voice: host.voice,
            language: host.language,
            instructions: host.instructions,
          },
        }),
      });
      return Promise.resolve(true);
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    port: (server.address() as AddressInfo).port,
    tickets,
    providerSeen,
    providerAuth,
    close: async () => {
      server.closeAllConnections();
      provider.close();
      providerHttp.closeAllConnections();
      await Promise.all([
        new Promise((resolve) => server.close(resolve)),
        new Promise((resolve) => providerHttp.close(resolve)),
      ]);
    },
  };
}

function open(r: Rig, ticket: string, origin: string | null = ORIGIN, session = SESSION) {
  const url = `ws://127.0.0.1:${r.port}/v1/workspaces/${WORKSPACE}/live-assistant/sessions/${session}/voice?ticket=${ticket}`;
  return new WebSocket(url, origin ? { origin } : {});
}

function collect(socket: WebSocket) {
  const messages: (string | Buffer)[] = [];
  socket.on('message', (data, isBinary) => {
    messages.push(isBinary ? (data as Buffer) : Buffer.from(data as Buffer).toString('utf8'));
  });
  return messages;
}

const waitFor = async (condition: () => boolean, ms = 2000) => {
  const until = Date.now() + ms;
  while (!condition() && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
  expect(condition()).toBe(true);
};

const rigs: Rig[] = [];
afterEach(async () => {
  for (const r of rigs.splice(0)) await r.close();
});

describe('the voice gateway, over real sockets', () => {
  it('opens with a good ticket, carries audio both ways and counts the use', async () => {
    const r = await rig();
    rigs.push(r);
    const ticket = r.tickets.issue({ context, sessionId: SESSION });
    const socket = open(r, ticket);
    const received = collect(socket);
    await waitFor(() => received.some((m) => m === JSON.stringify({ type: 'ready' })));
    socket.send(Buffer.alloc(480, 7), { binary: true });
    await waitFor(() => received.some((m) => Buffer.isBuffer(m)));
    expect(received.find((m) => Buffer.isBuffer(m))?.toString()).toBe('pcm-out');
    await waitFor(() =>
      received.some(
        (m) => typeof m === 'string' && (JSON.parse(m) as { type: string }).type === 'usage',
      ),
    );
    // The key went to the provider as a header and nowhere near the browser.
    expect(r.providerAuth).toEqual(['Bearer sk-test-key']);
    expect(JSON.stringify(received.filter((m) => typeof m === 'string'))).not.toContain('sk-test');
    socket.close();
  });

  it('spends a ticket once', async () => {
    const r = await rig();
    rigs.push(r);
    const ticket = r.tickets.issue({ context, sessionId: SESSION });
    const first = open(r, ticket);
    const seen = collect(first);
    await waitFor(() => seen.length > 0);
    first.close();
    const second = open(r, ticket);
    const closed = await new Promise<number>((resolve) =>
      second.on('close', (code) => resolve(code)),
    );
    expect(closed).toBe(4401);
  });

  it('refuses a ticket for another session', async () => {
    const r = await rig();
    rigs.push(r);
    const ticket = r.tickets.issue({ context, sessionId: SESSION });
    const other = open(r, ticket, ORIGIN, '33333333-3333-4333-8333-333333333333');
    const code = await new Promise<number>((resolve) => other.on('close', (c) => resolve(c)));
    expect(code).toBe(4401);
  });

  it('refuses another origin and a missing origin before anything opens', async () => {
    const r = await rig();
    rigs.push(r);
    const ticket = r.tickets.issue({ context, sessionId: SESSION });
    for (const origin of ['https://evil.example', null]) {
      const socket = open(r, ticket, origin);
      const failure = await new Promise<string>((resolve) => {
        socket.on('unexpected-response', (_req, res) => resolve(String(res.statusCode)));
        socket.on('error', (error) => resolve(error.message));
      });
      expect(failure).toContain('403');
    }
    // The refused attempts did not spend the ticket.
    const good = open(r, ticket);
    const seen = collect(good);
    await waitFor(() => seen.length > 0);
    good.close();
  });

  it('refuses a made-up ticket', async () => {
    const r = await rig();
    rigs.push(r);
    const socket = open(r, 'x'.repeat(43));
    const code = await new Promise<number>((resolve) => socket.on('close', (c) => resolve(c)));
    expect(code).toBe(4401);
  });

  it('leaves every other upgrade address alone', async () => {
    const r = await rig();
    rigs.push(r);
    const socket = new WebSocket(`ws://127.0.0.1:${r.port}/v1/something-else`, { origin: ORIGIN });
    const outcome = await new Promise<string>((resolve) => {
      socket.on('open', () => resolve('open'));
      socket.on('error', () => resolve('error'));
      socket.on('unexpected-response', () => resolve('error'));
    });
    expect(outcome).toBe('error');
  });

  it('ends the provider link when the browser leaves', async () => {
    const r = await rig();
    rigs.push(r);
    const ticket = r.tickets.issue({ context, sessionId: SESSION });
    const socket = open(r, ticket);
    const seen = collect(socket);
    await waitFor(() => seen.length > 0);
    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(r.providerSeen[0]?.['type']).toBe('session.update');
  });
});

describe('the tickets', () => {
  it('expire, work once and belong to one session', () => {
    let now = 1000;
    const tickets = new VoiceTickets(100, () => now);
    const a = tickets.issue({ context, sessionId: SESSION });
    expect(tickets.take(a, 'other')).toBeNull();
    const b = tickets.issue({ context, sessionId: SESSION });
    now += 101;
    expect(tickets.take(b, SESSION)).toBeNull();
    const c = tickets.issue({ context, sessionId: SESSION });
    expect(tickets.take(c, SESSION)?.sessionId).toBe(SESSION);
    expect(tickets.take(c, SESSION)).toBeNull();
    expect(tickets.take('short', SESSION)).toBeNull();
  });

  it('keeps only a bounded number open', () => {
    const tickets = new VoiceTickets(60_000, () => 1);
    const first = tickets.issue({ context, sessionId: SESSION });
    for (let i = 0; i < 250; i += 1) tickets.issue({ context, sessionId: SESSION });
    expect(tickets.take(first, SESSION)).toBeNull();
  });
});
