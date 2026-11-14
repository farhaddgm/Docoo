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

/**
 * The relay under load, over real sockets and with no database: many links at once, each sending
 * microphone audio at the speed of speech, and a page that stops reading while the provider keeps
 * talking. What is checked is what must hold in production: every link is served, the event loop
 * keeps turning, memory does not grow with the audio, and a stuck page is cut off and cleaned up
 * instead of being buffered for ever.
 */
const WORKSPACE = '11111111-1111-4111-8111-111111111111';
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
const FRAME = Buffer.alloc(1920, 5); // 40 ms of 24 kHz 16-bit audio

interface Rig {
  port: number;
  tickets: VoiceTickets;
  stats: { providerLinks: number; providerFrames: number; relaysEnded: string[] };
  /** What the provider sends to every link once its first audio arrives. */
  onAudio: { current: ((socket: WebSocket) => void) | null };
  close: () => Promise<void>;
}

async function rig(): Promise<Rig> {
  const tickets = new VoiceTickets();
  const stats = { providerLinks: 0, providerFrames: 0, relaysEnded: [] as string[] };
  const onAudio: Rig['onAudio'] = { current: null };
  const providerHttp = createServer();
  const provider = new WebSocketServer({ server: providerHttp });
  provider.on('connection', (socket) => {
    stats.providerLinks += 1;
    let first = true;
    socket.on('message', (raw) => {
      const event = JSON.parse(Buffer.from(raw as Buffer).toString('utf8')) as { type: string };
      if (event.type === 'session.update') socket.send(JSON.stringify({ type: 'session.updated' }));
      if (event.type === 'input_audio_buffer.append') {
        stats.providerFrames += 1;
        if (first) {
          first = false;
          onAudio.current?.(socket);
        }
      }
    });
  });
  await new Promise<void>((resolve) => providerHttp.listen(0, '127.0.0.1', resolve));
  const providerPort = (providerHttp.address() as AddressInfo).port;
  const server: Server = createServer((_request, response) => response.end('http'));
  const host: RelayHost = {
    model: 'm',
    voice: 'alloy',
    language: 'fa',
    instructions: 'x',
    ask: () => Promise.resolve(answer),
    saveLines: () => Promise.resolve(),
    costOf: () => Promise.resolve(0),
    record: () => Promise.resolve({ ended: false }),
  };
  attachVoiceGateway({
    server,
    allowedOrigin: ORIGIN,
    accept: (upgrade, client) => {
      const entry = tickets.take(upgrade.ticket, upgrade.sessionId);
      if (!entry) return Promise.resolve(false);
      startVoiceRelay({
        host,
        client,
        engine: createOpenAiRealtimeEngine({
          socket: nodeRelaySocketFactory(`ws://127.0.0.1:${providerPort}/realtime?model=m`, {
            Authorization: 'Bearer k',
          }),
          config: { model: 'm', voice: 'alloy', language: 'fa', instructions: 'x' },
        }),
      });
      return Promise.resolve(true);
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    tickets,
    stats,
    onAudio,
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

const rigs: Rig[] = [];
afterEach(async () => {
  for (const r of rigs.splice(0)) await r.close();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (condition: () => boolean, ms = 10_000) => {
  const until = Date.now() + ms;
  while (!condition() && Date.now() < until) await sleep(20);
  expect(condition()).toBe(true);
};

function open(r: Rig, session: string) {
  const ticket = r.tickets.issue({ context, sessionId: session });
  const socket = new WebSocket(
    `ws://127.0.0.1:${r.port}/v1/workspaces/${WORKSPACE}/live-assistant/sessions/${session}/voice?ticket=${ticket}`,
    { origin: ORIGIN },
  );
  const state = {
    ready: false,
    audioBytes: 0,
    closed: null as number | null,
    reasons: [] as string[],
  };
  socket.on('message', (data, isBinary) => {
    if (isBinary) state.audioBytes += (data as Buffer).length;
    else {
      const message = JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as {
        type: string;
        reason?: string;
      };
      if (message.type === 'ready') state.ready = true;
      if (message.type === 'closed' && message.reason) state.reasons.push(message.reason);
    }
  });
  socket.on('close', (code) => {
    state.closed = code;
  });
  return { socket, state };
}

/** How late a 10 ms timer runs while the load is on: a measure of a blocked event loop. */
function watchLoop() {
  let worst = 0;
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    worst = Math.max(worst, now - last - 10);
    last = now;
  }, 10);
  return { stop: () => clearInterval(timer), worst: () => worst };
}

describe('the voice relay under load', () => {
  it('serves 60 links at once, each sending speech-speed audio, without blocking or leaking', async () => {
    const r = await rig();
    rigs.push(r);
    // Every link gets one second of provider audio back after its first frame.
    r.onAudio.current = (socket) => {
      for (let i = 0; i < 25; i += 1) {
        socket.send(
          JSON.stringify({
            type: 'response.output_audio.delta',
            delta: FRAME.toString('base64'),
          }),
        );
      }
    };
    if (global.gc) global.gc();
    const heapBefore = process.memoryUsage().heapUsed;
    const loop = watchLoop();
    const LINKS = 60;
    const FRAMES = 40; // 1.6 s of speech per link
    const links = Array.from({ length: LINKS }, (_, i) =>
      open(r, `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
    );
    await waitFor(() => links.every((link) => link.state.ready), 15_000);
    // Frames go out in real time (one every 40 ms), all links together.
    for (let frame = 0; frame < FRAMES; frame += 1) {
      for (const link of links) link.socket.send(FRAME, { binary: true });
      await sleep(40);
    }
    await waitFor(() => r.stats.providerFrames >= LINKS * FRAMES * 0.95, 15_000);
    await waitFor(() => links.every((link) => link.state.audioBytes >= 25 * 1920 * 0.9), 15_000);
    loop.stop();
    expect(r.stats.providerLinks).toBe(LINKS);
    // The event loop was never held for long (a blocked loop would show as seconds, not tens of ms).
    expect(loop.worst()).toBeLessThan(1000);
    for (const link of links) link.socket.close();
    await waitFor(() => links.every((link) => link.state.closed !== null), 15_000);
    if (global.gc) global.gc();
    await sleep(200);
    // 60 links of audio went through; what stays in memory is nowhere near what went through.
    const grown = process.memoryUsage().heapUsed - heapBefore;
    expect(grown).toBeLessThan(150 * 1024 * 1024);
  }, 60_000);

  it('drops audio for a page that stops reading instead of buffering it, and the link still works afterwards', async () => {
    const r = await rig();
    rigs.push(r);
    // 1200 chunks of 64 KiB (75 MiB): far more than the operating system will hold for a page that
    // is not reading, so the rest has to wait in the server, which may keep only a little of it.
    const CHUNKS = 1200;
    const CHUNK_BYTES = 64 * 1024;
    const chunk = Buffer.alloc(CHUNK_BYTES, 9).toString('base64');
    r.onAudio.current = (socket) => {
      for (let i = 0; i < CHUNKS; i += 1) {
        socket.send(JSON.stringify({ type: 'response.output_audio.delta', delta: chunk }));
      }
    };
    const stuck = open(r, '00000000-0000-4000-8000-0000000000aa');
    await waitFor(() => stuck.state.ready);
    const raw = (stuck.socket as unknown as { _socket: { pause: () => void; resume: () => void } })
      ._socket;
    raw.pause();
    stuck.socket.send(FRAME, { binary: true });
    await waitFor(() => r.stats.providerFrames >= 1, 5_000);
    // Give the provider time to send everything while the page reads nothing.
    await sleep(2_000);
    raw.resume();
    // The page reads again; wait until nothing more arrives.
    let last = -1;
    while (stuck.state.audioBytes !== last) {
      last = stuck.state.audioBytes;
      await sleep(1_000);
    }
    const sent = CHUNKS * CHUNK_BYTES;
    // Some was dropped (the server did not hold 75 MiB for a page that was not reading), the page
    // got what fitted, and the link is still open and still carries audio.
    expect(stuck.state.audioBytes).toBeLessThan(sent);
    expect(stuck.state.audioBytes).toBeGreaterThan(1024 * 1024);
    expect(stuck.state.closed).toBeNull();
    stuck.socket.send(FRAME, { binary: true });
    await waitFor(() => r.stats.providerFrames >= 2, 5_000);
    stuck.socket.close();
    await waitFor(() => stuck.state.closed !== null, 5_000);
  }, 60_000);

  it('keeps 1000 tickets from growing without bound, and a spent ticket never works again', () => {
    const tickets = new VoiceTickets();
    const first = tickets.issue({ context, sessionId: 's' });
    for (let i = 0; i < 1000; i += 1) tickets.issue({ context, sessionId: 's' });
    // The oldest were dropped to make room: memory is bounded, and the old one is gone.
    expect(tickets.take(first, 's')).toBeNull();
    const fresh = tickets.issue({ context, sessionId: 's' });
    expect(tickets.take(fresh, 's')).not.toBeNull();
    expect(tickets.take(fresh, 's')).toBeNull();
  });
});
