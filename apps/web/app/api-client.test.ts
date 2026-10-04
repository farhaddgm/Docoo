import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiGet, apiSend, idempotencyKey } from './api-client';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('api client', () => {
  it('retries a read once after a network failure or a bad gateway', async () => {
    vi.useFakeTimers();
    const badGateway = () => new Response('bad gateway', { status: 502 });
    for (const failure of [
      () => Promise.reject(new TypeError('socket hang up')),
      () => Promise.resolve(badGateway()),
    ]) {
      const fetchMock = vi
        .fn()
        .mockImplementationOnce(failure)
        .mockResolvedValueOnce(json({ ok: true }));
      vi.stubGlobal('fetch', fetchMock);
      const read = apiGet<{ ok: boolean }>('/a');
      await vi.runAllTimersAsync();
      expect(await read).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });

  it('gives up after one retry and reports the failure', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response('', { status: 502 })));
    vi.stubGlobal('fetch', fetchMock);
    const read = apiGet('/b').catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await read).toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry an answer from the API, only keeps its problem code and reasons', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ code: 'PROJECT_NOT_READY', problems: ['topics_missing', 7] }, 409));
    vi.stubGlobal('fetch', fetchMock);

    const error = await apiGet('/projects/1').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'PROJECT_NOT_READY',
      problems: ['topics_missing'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends mutations with If-Match and never repeats them on its own', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad gateway', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      apiSend('PATCH', '/topics/1', { title: 'x' }, { version: 3, headers: { 'x-test': '1' } }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/topics/1');
    expect(init.method).toBe('PATCH');
    expect(init.headers).toMatchObject({
      'content-type': 'application/json',
      'if-match': '"3"',
      'x-test': '1',
    });
    expect(init.body).toBe('{"title":"x"}');
  });

  it('returns undefined for an empty body and makes a fresh idempotency key each time', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
    expect(await apiSend('POST', '/workflow/start')).toBeUndefined();
    const keys = new Set([idempotencyKey(), idempotencyKey()]);
    expect(keys.size).toBe(2);
    for (const key of keys) expect(key).toMatch(/^web-[0-9a-f-]{36}$/u);
  });
});
