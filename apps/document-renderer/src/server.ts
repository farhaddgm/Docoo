import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { renderPdfLocally } from '@docoo/documents';

export function createRendererServer(token: string, render = renderPdfLocally) {
  if (token.length < 32) throw new Error('PDF_RENDERER_TOKEN is required.');
  let busy = false;
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  async function handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('cache-control', 'no-store');
    if (request.method === 'GET' && request.url === '/health') {
      response.end('ok');
      return;
    }
    const supplied = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      response.writeHead(401);
      response.end();
      return;
    }
    if (
      request.method !== 'POST' ||
      request.url !== '/render' ||
      request.headers['content-type'] !== 'application/json'
    ) {
      response.writeHead(400);
      response.end();
      return;
    }
    if (busy) {
      response.writeHead(429);
      response.end();
      return;
    }
    busy = true;
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const part of request) {
        const chunk = Buffer.from(part as Uint8Array);
        size += chunk.length;
        if (size > 8 * 1024 * 1024) {
          response.writeHead(413);
          response.end();
          return;
        }
        chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        html?: unknown;
        meta?: { documentId?: unknown; version?: unknown; createdAt?: unknown };
      };
      if (
        typeof data.html !== 'string' ||
        typeof data.meta?.documentId !== 'string' ||
        !/^[0-9a-f-]{36}$/iu.test(data.meta.documentId) ||
        !Number.isSafeInteger(data.meta.version) ||
        Number(data.meta.version) < 1 ||
        typeof data.meta.createdAt !== 'string'
      ) {
        response.writeHead(400);
        response.end();
        return;
      }
      const pdf = await render(data.html, {
        documentId: data.meta.documentId,
        version: Number(data.meta.version),
        createdAt: data.meta.createdAt,
      });
      if (pdf.length > 20 * 1024 * 1024) throw new Error('PDF too large');
      response.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.length });
      response.end(pdf);
    } catch {
      if (!response.headersSent) response.writeHead(422);
      response.end();
    } finally {
      busy = false;
    }
  }
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  return server;
}
