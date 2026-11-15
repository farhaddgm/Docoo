import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import type { LiveVoiceCheckFailure } from '@docoo/contracts';

import { createElevenLabsPipelineEngine } from '../src/live-assistant/elevenlabs-pipeline-engine.js';
import { nodeRelaySocketFactory } from '../src/live-assistant/realtime-link.js';
import type { VoiceEngineEvents } from '../src/live-assistant/voice-engine.js';

/**
 * Why the ElevenLabs pipeline failed, said as a kind. A small fake of the service refuses, errs or
 * drops in the ways the real one does, and each test reads the kind the engine reports.
 */

interface Rig {
  baseUrl: string;
  hearing: ServerSocket[];
  hearingUrls: string[];
  close: () => Promise<void>;
  /** What happens to a hearing socket that asks to open (default: opens and says it started). */
  onHearing: (url: string, request: IncomingMessage, socketRaw: Duplex) => 'open' | 'handled';
  /** What a speaking socket does once it got its text. */
  speak: (socket: ServerSocket) => void;
  http: (request: IncomingMessage, response: ServerResponse) => void;
}

async function fake(): Promise<Rig> {
  const rig: Rig = {
    baseUrl: '',
    hearing: [],
    hearingUrls: [],
    close: () => Promise.resolve(),
    onHearing: () => 'open',
    speak: (socket) => socket.send(JSON.stringify({ error: 'boom' })),
    http: (_request, response) => {
      response.statusCode = 500;
      response.end('');
    },
  };
  const server: Server = createServer((request, response) => rig.http(request, response));
  const hearing = new WebSocketServer({ noServer: true });
  const speaking = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const url = request.url ?? '';
    if (url.startsWith('/v1/speech-to-text/realtime')) {
      rig.hearingUrls.push(url);
      if (rig.onHearing(url, request, socket) === 'handled') return;
      hearing.handleUpgrade(request, socket, head, (ws) => {
        rig.hearing.push(ws);
        ws.send(JSON.stringify({ message_type: 'session_started', session_id: 's' }));
      });
    } else if (url.startsWith('/v1/text-to-dialogue/stream-input')) {
      speaking.handleUpgrade(request, socket, head, (ws) => {
        ws.on('message', (raw) => {
          const message = JSON.parse(Buffer.from(raw as Buffer).toString('utf8')) as Record<
            string,
            unknown
          >;
          if (message['close_socket'] === true) rig.speak(ws);
        });
      });
    } else socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  rig.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  rig.close = () =>
    new Promise<void>((resolve) => {
      for (const client of [...hearing.clients, ...speaking.clients]) client.terminate();
      server.close(() => resolve());
    });
  return rig;
}

const rigs: Rig[] = [];
afterEach(async () => {
  await Promise.all(rigs.splice(0).map((rig) => rig.close()));
});

function refuse(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

async function run(
  setup: (rig: Rig) => void,
  options: { zeroRetention?: boolean } = {},
  act?: (rig: Rig, engine: ReturnType<typeof createElevenLabsPipelineEngine>) => Promise<void>,
): Promise<{ failures: (LiveVoiceCheckFailure | undefined)[]; ready: number }> {
  const rig = await fake();
  rigs.push(rig);
  setup(rig);
  const engine = createElevenLabsPipelineEngine({
    socket: nodeRelaySocketFactory,
    apiKey: 'xi-secret',
    baseUrl: rig.baseUrl,
    zeroRetention: options.zeroRetention ?? true,
    config: { ttsModel: 'eleven_v4_turbo', voice: 'voice-1', language: 'fa' },
  });
  const failures: (LiveVoiceCheckFailure | undefined)[] = [];
  let ready = 0;
  const events: VoiceEngineEvents = {
    ready: () => void (ready += 1),
    speechStarted: () => undefined,
    speechStopped: () => undefined,
    audio: () => undefined,
    userText: () => undefined,
    assistantText: () => undefined,
    toolCall: () => undefined,
    responseDone: () => undefined,
    usage: () => undefined,
    failed: (failure) => void failures.push(failure),
  };
  engine.start(events);
  if (act) {
    const started = Date.now();
    while (ready === 0 && failures.length === 0 && Date.now() - started < 3000) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await act(rig, engine);
  }
  const started = Date.now();
  while (failures.length === 0 && Date.now() - started < 4000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  engine.close();
  return { failures, ready };
}

describe('why the ElevenLabs hearing side failed', () => {
  it('says the plan has no zero retention when the door opens only without it', async () => {
    const result = await run((rig) => {
      rig.onHearing = (url, _request, socket) => {
        if (url.includes('enable_logging=false')) {
          refuse(socket, '403 Forbidden');
          return 'handled';
        }
        return 'open';
      };
    });
    expect(result.failures).toEqual(['retention']);
  });

  it('does not blame zero retention when the door is shut with or without it', async () => {
    const result = await run((rig) => {
      rig.onHearing = (_url, _request, socket) => {
        refuse(socket, '503 Service Unavailable');
        return 'handled';
      };
    });
    expect(result.failures).toEqual(['refused']);
  });

  it('says refused (not retention) when zero retention was not asked', async () => {
    const result = await run(
      (rig) => {
        rig.onHearing = (_url, _request, socket) => {
          refuse(socket, '503 Service Unavailable');
          return 'handled';
        };
      },
      { zeroRetention: false },
    );
    expect(result.failures).toEqual(['refused']);
    // Only the one attempt: there is nothing to probe without zero retention.
  });

  it('names a wrong key when the door is shut and the key check says 401', async () => {
    const result = await run((rig) => {
      rig.onHearing = (_url, _request, socket) => {
        refuse(socket, '401 Unauthorized');
        return 'handled';
      };
      rig.http = (_request, response) => {
        response.statusCode = 401;
        response.end('');
      };
    });
    expect(result.failures).toEqual(['auth']);
  });

  it('names a used-up account when the door is shut and the key check says 429', async () => {
    const result = await run(
      (rig) => {
        rig.onHearing = (_url, _request, socket) => {
          refuse(socket, '503 Service Unavailable');
          return 'handled';
        };
        rig.http = (_request, response) => {
          response.statusCode = 429;
          response.end('');
        };
      },
      { zeroRetention: false },
    );
    expect(result.failures).toEqual(['quota']);
  });

  it.each([
    ['auth_error', 'auth'],
    ['quota_exceeded', 'quota'],
    ['rate_limited', 'quota'],
    ['unaccepted_terms', 'terms'],
    ['session_time_limit_exceeded', 'session_limit'],
    ['invalid_request', 'model'],
    ['transcriber_error', 'unexpected'],
  ] as const)('maps the hearing event %s to %s', async (kind, expected) => {
    const result = await run(
      () => undefined,
      {},
      (rig) => {
        rig.hearing[0]?.send(JSON.stringify({ message_type: kind }));
        return Promise.resolve();
      },
    );
    expect(result.failures).toEqual([expected]);
  });

  it('reads the text of a vague error event', async () => {
    const result = await run(
      () => undefined,
      {},
      (rig) => {
        rig.hearing[0]?.send(
          JSON.stringify({ message_type: 'error', error: 'Zero retention is only for enterprise' }),
        );
        return Promise.resolve();
      },
    );
    expect(result.failures).toEqual(['retention']);
  });

  it('says the link dropped when it is lost after it started', async () => {
    const result = await run(
      () => undefined,
      {},
      (rig) => {
        rig.hearing[0]?.terminate();
        return Promise.resolve();
      },
    );
    expect(result.ready).toBe(1);
    expect(result.failures).toEqual(['dropped']);
  });
});

describe('why the ElevenLabs speaking side failed', () => {
  async function speakWith(
    setup: (rig: Rig) => void,
  ): Promise<(LiveVoiceCheckFailure | undefined)[]> {
    const result = await run(setup, {}, (rig, engine) => {
      engine.tell('x', 'سلام');
      return Promise.resolve();
    });
    return result.failures;
  }

  it('says the credit is used up when the speaking socket says quota and HTTP says nothing', async () => {
    expect(
      await speakWith((rig) => {
        rig.speak = (socket) => socket.send(JSON.stringify({ error: 'quota_exceeded' }));
      }),
    ).toEqual(['quota']);
  });

  it('reads the HTTP answer: 401 is the key', async () => {
    expect(
      await speakWith((rig) => {
        rig.http = (_request, response) => {
          response.statusCode = 401;
          response.end('{"detail":{"status":"invalid_api_key"}}');
        };
      }),
    ).toEqual(['auth']);
  });

  it('reads the HTTP answer: a missing voice', async () => {
    expect(
      await speakWith((rig) => {
        rig.http = (_request, response) => {
          response.statusCode = 404;
          response.end('{"detail":{"status":"voice_not_found"}}');
        };
      }),
    ).toEqual(['voice']);
  });

  it('reads the HTTP answer: no credit left', async () => {
    expect(
      await speakWith((rig) => {
        rig.http = (_request, response) => {
          response.statusCode = 402;
          response.end('');
        };
      }),
    ).toEqual(['quota']);
  });

  it('says unexpected when nothing tells the reason', async () => {
    expect(await speakWith(() => undefined)).toEqual(['unexpected']);
  });
});
