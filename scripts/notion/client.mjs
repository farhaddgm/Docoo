// Minimal Notion REST client with throttling and retry for 429/5xx responses.

export const NOTION_VERSION = '2025-09-03';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class NotionError extends Error {
  constructor(status, body, method, path) {
    super(`Notion ${method} ${path} failed with HTTP ${status}: ${body?.message ?? 'unknown'}`);
    this.status = status;
    this.code = body?.code;
  }
}

export function createNotionClient({
  token,
  baseUrl = 'https://api.notion.com/v1',
  minIntervalMs = 350,
  maxRetries = 5,
  requestTimeoutMs = 30000,
  fetchImpl = fetch,
}) {
  if (!token) throw new Error('NOTION_TOKEN is required to publish to Notion.');
  let nextSlot = 0;

  async function request(method, path, body) {
    for (let attempt = 0; ; attempt += 1) {
      const wait = nextSlot - Date.now();
      if (wait > 0) await sleep(wait);
      nextSlot = Date.now() + minIntervalMs;

      let response;
      try {
        response = await fetchImpl(`${baseUrl}${path}`, {
          method,
          signal: AbortSignal.timeout(requestTimeoutMs),
          headers: {
            authorization: `Bearer ${token}`,
            'notion-version': NOTION_VERSION,
            'content-type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (error) {
        // Only idempotent requests are retried after a network error or timeout;
        // a failed write marks the document failed and the next run rewrites it.
        if (!['GET', 'DELETE'].includes(method) || attempt >= maxRetries) throw error;
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload;

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= maxRetries) {
        throw new NotionError(response.status, payload, method, path);
      }
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt,
      );
    }
  }

  return {
    request,
    getDataSource: (id) => request('GET', `/data_sources/${id}`),
    createPage: (body) => request('POST', '/pages', body),
    updatePage: (id, body) => request('PATCH', `/pages/${id}`, body),
    deleteBlock: (id) => request('DELETE', `/blocks/${id}`),
    appendChildren: (id, children) => request('PATCH', `/blocks/${id}/children`, { children }),
    async listChildren(id) {
      const results = [];
      let cursor;
      do {
        const query = new URLSearchParams({ page_size: '100' });
        if (cursor) query.set('start_cursor', cursor);
        const page = await request('GET', `/blocks/${id}/children?${query}`);
        results.push(...page.results);
        cursor = page.has_more ? page.next_cursor : undefined;
      } while (cursor);
      return results;
    },
  };
}
