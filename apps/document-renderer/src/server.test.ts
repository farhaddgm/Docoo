import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createRendererServer } from './server.js';

const token = 'test-only-renderer-token-with-32-characters';
const servers: Server[] = [];
async function start(render: Parameters<typeof createRendererServer>[1]) {
  const server = createRendererServer(token, render);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  return `http://127.0.0.1:${address.port}/render`;
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});
const options = (body: string, authorized = true) => ({
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(authorized ? { authorization: `Bearer ${token}` } : {}),
  },
  body,
});
const valid = JSON.stringify({
  html: '<h1>Test</h1>',
  meta: { documentId: '00000000-0000-4000-8000-000000000000', version: 1, createdAt: '2026-10-07' },
});

describe('isolated renderer boundary', () => {
  it('rejects unauthenticated and malformed requests before starting Chromium', async () => {
    const render = vi.fn();
    const url = await start(render);
    expect((await fetch(url, options(valid, false))).status).toBe(401);
    expect((await fetch(url, options('{}'))).status).toBe(400);
    expect(render).not.toHaveBeenCalled();
  });
  it('bounds request bodies before starting Chromium', async () => {
    const render = vi.fn();
    const url = await start(render);
    expect((await fetch(url, options('x'.repeat(8 * 1024 * 1024 + 1)))).status).toBe(413);
    expect(render).not.toHaveBeenCalled();
  });
  it('permits one job, rejects concurrent work and releases the slot after failure', async () => {
    let rejectJob!: (error: Error) => void;
    let started!: () => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const render = vi
      .fn()
      .mockImplementationOnce(() => {
        started();
        return new Promise<Uint8Array>((_, reject) => {
          rejectJob = reject;
        });
      })
      .mockResolvedValue(Buffer.from('%PDF-test'));
    const url = await start(render);
    const first = fetch(url, options(valid));
    await began;
    expect((await fetch(url, options(valid))).status).toBe(429);
    rejectJob(new Error('Malformed document'));
    expect((await first).status).toBe(422);
    const next = await fetch(url, options(valid));
    expect(next.status).toBe(200);
    expect(await next.text()).toBe('%PDF-test');
  });
});
