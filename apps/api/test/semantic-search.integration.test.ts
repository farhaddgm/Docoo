import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEMANTIC_DIMENSIONS, type SemanticSearch } from '@docoo/orchestration';

import { SEMANTIC_SEARCH } from '../src/knowledge/semantic-search.service.js';
import { adminUrl, createHarness, type Harness } from './support/harness.js';

/**
 * Semantic search over knowledge (ADR-0061). The provider is replaced by a fake that gives texts of
 * one meaning the same direction (a Persian "ترک" and an English "leaving" both mean churn), so the
 * test shows where the vectors come from and where they must not: what leaves, what is ranked, and
 * what happens when the provider fails. No network is used.
 */

const CONCEPTS: readonly (readonly string[])[] = [
  ['ریزش', 'ترک', 'رفتن مشتری', 'churn', 'leaving'],
  ['قیمت', 'تعرفه', 'price', 'pricing'],
  ['پشتیبانی', 'support'],
];

function conceptVector(text: string): number[] {
  const lower = text.toLowerCase();
  const vector = new Array<number>(SEMANTIC_DIMENSIONS).fill(0);
  CONCEPTS.forEach((words, index) => {
    if (words.some((word) => lower.includes(word))) vector[index] = 1;
  });
  vector[1000] = 0.05;
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
}

/** What the fake provider was asked, so a test can say what did and did not leave the system. */
const sent: string[] = [];
let failing = false;
const fake: SemanticSearch = {
  model: 'fake-semantic-1',
  embed: (texts) => {
    sent.push(...texts);
    return failing
      ? Promise.reject(new Error('provider down'))
      : Promise.resolve(texts.map(conceptVector));
  },
};

interface Status {
  enabled: boolean;
  reason: string | null;
  model: string | null;
  eligible: number;
  embedded: number;
  keptLocal: number;
}
interface Retrieval {
  embeddingModel: string;
  results: {
    knowledgeId: string;
    semanticRank?: number | null;
    semanticSimilarity?: number | null;
  }[];
}

const bodies = {
  churn:
    'نرخ ریزش مشتریان کسب‌وکارهای کوچک در سال گذشته به هفت درصد رسید و بیشترین ریزش در ماه‌های اول بود.',
  secretChurn: 'گزارش محرمانهٔ ریزش مشتریان بزرگ شامل نام قراردادهای ویژه و تخفیف‌های توافقی است.',
  pricing: 'تعرفه اشتراک سالانه بر اساس تعداد کاربران تعیین می‌شود و ده درصد تخفیف سالانه دارد.',
};

describe.skipIf(!adminUrl)('semantic search is off unless every lock is open (ADR-0061)', () => {
  let h: Harness;
  let cookie: string;
  const api = (suffix: string) => `/v1/workspaces/${h.ids.workspaceA}${suffix}`;

  beforeAll(async () => {
    h = await createHarness('semoff');
    cookie = await h.login(h.emails.a);
  }, 30_000);
  afterAll(async () => {
    await h?.close();
  });

  it('says it is off, why, and does nothing when asked to index', async () => {
    const status = await h.request('GET', api('/knowledge/semantic-index'), { cookie });
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json<Status>()).toMatchObject({
      enabled: false,
      reason: 'not_enabled',
      model: null,
    });
    const run = await h.request('POST', api('/knowledge/semantic-index/run'), {
      cookie,
      payload: {},
    });
    expect(run.statusCode, run.body).toBe(200);
    expect(run.json<{ enabled: boolean }>().enabled).toBe(false);
    const rows = await h.admin.query<{ count: number }>(
      'select count(*)::int as count from knowledge_chunk_embeddings where workspace_id = $1',
      [h.ids.workspaceA],
    );
    expect(rows.rows[0]?.count).toBe(0);
  });
});

describe.skipIf(!adminUrl)('semantic search with a scripted provider (ADR-0061)', () => {
  let h: Harness;
  let cookie: string;
  const ids: Record<string, string> = {};
  const api = (suffix: string) => `/v1/workspaces/${h.ids.workspaceA}${suffix}`;

  async function create(key: string, title: string, content: string, confidentiality: string) {
    const created = await h.request('POST', api('/knowledge'), {
      cookie,
      payload: {
        title,
        content,
        confidentiality,
        language: 'fa',
        sourceType: 'admin_provided',
        provenance: { declaration: 'Written for the test' },
        scopes: [{ type: 'workspace', id: h.ids.workspaceA }],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    ids[key] = created.json<{ knowledge: { id: string } }>().knowledge.id;
    const audited = await h.request('POST', api(`/knowledge/${ids[key]}/submit-audit`), { cookie });
    expect(audited.statusCode, audited.body).toBe(200);
  }

  const retrieve = async (query: string): Promise<Retrieval> => {
    const response = await h.request('POST', api('/knowledge/retrieve'), {
      cookie,
      payload: { query, limit: 10 },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Retrieval>();
  };

  beforeAll(async () => {
    h = await createHarness('semon', {
      overrides: [{ provide: SEMANTIC_SEARCH, useValue: fake }],
    });
    cookie = await h.login(h.emails.a);
    await create('churn', 'Churn report', bodies.churn, 'internal');
    await create('secretChurn', 'Large customer churn', bodies.secretChurn, 'confidential');
    await create('pricing', 'Pricing', bodies.pricing, 'internal');
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  it('before indexing nothing has a vector, and retrieval is what it always was', async () => {
    sent.length = 0;
    const status = (
      await h.request('GET', api('/knowledge/semantic-index'), { cookie })
    ).json<Status>();
    expect(status).toMatchObject({
      enabled: true,
      model: 'fake-semantic-1',
      eligible: 2,
      embedded: 0,
      keptLocal: 1,
    });
    const found = await retrieve('ریزش مشتریان');
    expect(found.embeddingModel).toContain('fake-semantic-1');
    expect(found.results.length).toBeGreaterThan(0);
    // Nothing is ranked semantically yet: no chunk has a vector.
    expect(found.results.every((item) => item.semanticRank === null)).toBe(true);
  });

  it('embeds the internal knowledge only; a confidential document never leaves', async () => {
    sent.length = 0;
    const run = await h.request('POST', api('/knowledge/semantic-index/run'), {
      cookie,
      payload: {},
    });
    expect(run.statusCode, run.body).toBe(200);
    expect(run.json<{ embedded: number; failedBatches: number }>()).toMatchObject({
      embedded: 2,
      failedBatches: 0,
    });
    expect(sent).toHaveLength(2);
    expect(sent.some((text) => text.includes('محرمانه'))).toBe(false);
    expect(sent.some((text) => text.includes('تعرفه'))).toBe(true);

    const status = (
      await h.request('GET', api('/knowledge/semantic-index'), { cookie })
    ).json<Status>();
    expect(status).toMatchObject({ eligible: 2, embedded: 2, keptLocal: 1 });
    // A second run has nothing left to do and sends nothing.
    sent.length = 0;
    const again = await h.request('POST', api('/knowledge/semantic-index/run'), {
      cookie,
      payload: {},
    });
    expect(again.json<{ asked: number }>().asked).toBe(0);
    expect(sent).toEqual([]);

    const audit = await h.admin.query<{ after: Record<string, unknown> }>(
      `select after from audit_events where action = 'knowledge.semantic_index' order by occurred_at limit 1`,
    );
    expect(audit.rows[0]?.after).toMatchObject({ model: 'fake-semantic-1', embedded: 2 });
    // The audit says how many, never which text.
    expect(JSON.stringify(audit.rows)).not.toContain('تعرفه');
  });

  it('finds a document by meaning when the question shares no word with it', async () => {
    sent.length = 0;
    // "ترک" and "رفتن مشتری" do not occur in the churn report; its meaning is what matches.
    const found = await retrieve('چطور جلوی ترک مشتری‌ها را بگیریم');
    const churn = found.results.find((item) => item.knowledgeId === ids['churn']);
    expect(churn?.semanticRank).toBe(1);
    expect(churn?.semanticSimilarity).toBeGreaterThan(0.5);
    // It is found although it shares no word with the question, and above the unrelated document.
    const position = (key: string) =>
      found.results.findIndex((item) => item.knowledgeId === ids[key]);
    expect(position('churn')).toBeGreaterThanOrEqual(0);
    expect(position('churn')).toBeLessThan(2);
    // Only the question went out, once, and a question about pricing finds the pricing document.
    expect(sent).toEqual(['چطور جلوی ترک مشتری‌ها را بگیریم']);
    const price = await retrieve('قیمت برای یک سال');
    const pricing = price.results.find((item) => item.knowledgeId === ids['pricing']);
    expect(pricing?.semanticRank).toBe(1);
    expect(price.results.findIndex((item) => item.knowledgeId === ids['pricing'])).toBeLessThan(3);
  });

  it('the confidential document is still found by its words, but is never ranked semantically', async () => {
    const found = await retrieve('گزارش محرمانه قراردادهای ویژه');
    const secret = found.results.find((item) => item.knowledgeId === ids['secretChurn']);
    expect(secret).toBeDefined();
    expect(secret?.semanticRank).toBeNull();
  });

  it('a question with personal data or a key is not sent to the provider', async () => {
    sent.length = 0;
    for (const question of [
      'ریزش مشتریان برای ali.rezaei@acme-corp.com',
      'ریزش مشتریان تلفن 09123456789',
    ]) {
      const found = await retrieve(question);
      // No semantic ranking took part, so the results carry no semantic fields at all.
      expect(found.results.every((item) => item.semanticRank === undefined)).toBe(true);
    }
    expect(sent).toEqual([]);
  });

  it('when the provider fails, retrieval still answers from the words', async () => {
    failing = true;
    try {
      const found = await retrieve('نرخ ریزش مشتریان');
      expect(found.results[0]?.knowledgeId).toBe(ids['churn']);
      expect(found.results.every((item) => item.semanticRank === undefined)).toBe(true);
      const run = await h.request('POST', api('/knowledge/semantic-index/run'), {
        cookie,
        payload: {},
      });
      expect(run.statusCode, run.body).toBe(200);
    } finally {
      failing = false;
    }
  });

  it('a new internal document is picked up by the next run, and a stale model is not reused', async () => {
    await create('support', 'Support hours', 'ساعت پشتیبانی از نه صبح تا شش عصر است.', 'internal');
    sent.length = 0;
    const run = await h.request('POST', api('/knowledge/semantic-index/run'), {
      cookie,
      payload: {},
    });
    expect(run.json<{ embedded: number }>().embedded).toBe(1);
    expect(sent).toHaveLength(1);
    const rows = await h.admin.query<{ model: string; count: number }>(
      `select model, count(*)::int as count from knowledge_chunk_embeddings where workspace_id = $1 group by model`,
      [h.ids.workspaceA],
    );
    expect(rows.rows).toEqual([{ model: 'fake-semantic-1', count: 3 }]);
  });
});
