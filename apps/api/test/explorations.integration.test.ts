import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminUrl, createHarness, type Harness } from './support/harness.js';

// The explorations of ADR-0044 are read only since ADR-0045 step F: a new exploration is a project
// of kind `exploration`. What was written before stays readable.
let h: Harness;
let cookie: string;
let cookieB: string;
let explorationId: string;
const api = (suffix = '') => `/v1/workspaces/${h.ids.workspaceA}/explorations${suffix}`;

describe.skipIf(!adminUrl)('earlier explorations are read only (ADR-0045 step F)', () => {
  beforeAll(async () => {
    h = await createHarness('explorations');
    cookie = await h.login(h.emails.a);
    cookieB = await h.login(h.emails.b);
    // Data written while the explorations could still be changed: an event, a conversation, a
    // candidate with a decision.
    explorationId = (
      await h.admin.query<{ id: string }>(
        `insert into explorations (workspace_id, title, event_text, output_language, created_by)
         values ($1, 'Large clients left', 'Three clients cancelled', 'en', $2) returning id`,
        [h.ids.workspaceA, h.ids.userA],
      )
    ).rows[0]!.id;
    await h.admin.query(
      `insert into exploration_messages (workspace_id, exploration_id, seq, role, content, author_id)
       values ($1, $2, 1, 'admin', 'What could be going on?', $3)`,
      [h.ids.workspaceA, explorationId, h.ids.userA],
    );
    const candidateKey = (await h.admin.query<{ key: string }>(`select gen_random_uuid() as key`))
      .rows[0]!.key;
    await h.admin.query(
      `insert into exploration_candidates (workspace_id, exploration_id, candidate_key, version_no, title, problem_draft, source)
       values ($1, $2, $3, 1, 'Pricing', 'Prices are unclear', 'admin')`,
      [h.ids.workspaceA, explorationId, candidateKey],
    );
    await h.admin.query(
      `insert into exploration_candidate_decisions (workspace_id, exploration_id, candidate_key, decision, decided_by)
       values ($1, $2, $3, 'parked', $4)`,
      [h.ids.workspaceA, explorationId, candidateKey, h.ids.userA],
    );
  }, 60_000);

  afterAll(async () => {
    await h?.close();
  });

  it('still lists and shows an earlier exploration with its conversation, candidates and decisions', async () => {
    const list = await h.request('GET', api(), { cookie });
    expect(list.statusCode, list.body).toBe(200);
    const items = list.json<{
      items: { id: string; candidateCount: number; byState: Record<string, number> }[];
    }>().items;
    const found = items.find((item) => item.id === explorationId)!;
    expect(found.candidateCount).toBe(1);
    expect(found.byState['parked']).toBe(1);

    const detail = await h.request('GET', api(`/${explorationId}`), { cookie });
    expect(detail.statusCode, detail.body).toBe(200);
    const body = detail.json<{
      exploration: { title: string };
      messages: { content: string }[];
      candidates: { title: string; state: string }[];
    }>();
    expect(body.exploration.title).toBe('Large clients left');
    expect(body.messages.map((message) => message.content)).toEqual(['What could be going on?']);
    expect(body.candidates).toMatchObject([{ title: 'Pricing', state: 'parked' }]);
  });

  it('cannot be changed any more: every write is gone', async () => {
    const writes: [string, string][] = [
      ['POST', api()],
      ['PATCH', api(`/${explorationId}`)],
      ['POST', api(`/${explorationId}/archive`)],
      ['POST', api(`/${explorationId}/reopen`)],
      ['POST', api(`/${explorationId}/messages`)],
      ['POST', api(`/${explorationId}/propose`)],
      ['POST', api(`/${explorationId}/candidates`)],
    ];
    for (const [method, url] of writes) {
      const response = await h.request(method as 'POST' | 'PATCH', url, {
        cookie,
        payload: { title: 'x', eventText: 'x', content: 'x' },
      });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it('is never shown to another workspace', async () => {
    const other = await h.request('GET', api(`/${explorationId}`), { cookie: cookieB });
    expect([403, 404]).toContain(other.statusCode);
  });
});
