import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';

import { LIVE_VOICE_MAX_FRAME_BYTES } from '@docoo/contracts';

import type { ClientLink } from './live-voice-relay.js';

/** The address the page opens: `/v1/workspaces/{workspace}/live-assistant/sessions/{session}/voice`. */
const VOICE_PATH =
  /^\/v1\/workspaces\/([0-9a-f-]{36})\/live-assistant\/sessions\/([0-9a-f-]{36})\/voice$/iu;

export interface VoiceUpgrade {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly ticket: string;
}

/** What the server does with an accepted upgrade; resolves false to refuse it. */
export type VoiceAccept = (upgrade: VoiceUpgrade, client: ClientLink) => Promise<boolean>;

function wrap(socket: WebSocket): ClientLink {
  return {
    send: (data) => socket.send(data),
    close: (code) => socket.close(code ?? 1000),
    onMessage: (listener) =>
      socket.on('message', (data, isBinary) => {
        const buffer = Buffer.isBuffer(data)
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.from(data);
        listener(buffer, isBinary);
      }),
    onClose: (listener) => socket.on('close', listener),
  };
}

function refuse(socket: Duplex, status: number): void {
  socket.write(`HTTP/1.1 ${status} Refused\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/**
 * Lets the HTTP server upgrade the one voice address to a WebSocket. Nothing about the person is
 * read from the request: the one-time ticket in the query string, the page's own origin and the
 * session in the path are all that is checked here, and the ticket is spent by `accept`.
 */
export function attachVoiceGateway(options: {
  server: Server;
  allowedOrigin: string;
  accept: VoiceAccept;
}): { close: () => void } {
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: LIVE_VOICE_MAX_FRAME_BYTES,
    perMessageDeflate: false,
  });
  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const match = VOICE_PATH.exec(url.pathname);
    socket.on('error', () => undefined);
    // This server upgrades one address only; any other upgrade is closed, never left hanging.
    if (!match) {
      refuse(socket, 404);
      return;
    }
    if (request.headers.origin !== options.allowedOrigin) {
      refuse(socket, 403);
      return;
    }
    const ticket = url.searchParams.get('ticket') ?? '';
    const upgrade: VoiceUpgrade = {
      workspaceId: (match[1] ?? '').toLowerCase(),
      sessionId: (match[2] ?? '').toLowerCase(),
      ticket,
    };
    sockets.handleUpgrade(request, socket, head, (client) => {
      const link = wrap(client);
      options
        .accept(upgrade, link)
        .then((accepted) => {
          if (!accepted) client.close(4401);
        })
        .catch(() => client.close(1011));
    });
  };
  options.server.on('upgrade', onUpgrade);
  return {
    close: () => {
      options.server.off('upgrade', onUpgrade);
      sockets.close();
    },
  };
}
