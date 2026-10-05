import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const FAKE_CONTENTER_TOKEN = 'contenter-test-service-token-0123456789abcdef';

interface FakeBusiness {
  id: string;
  name: string;
  /** Section texts by key; the rest are empty. */
  sections: Record<string, string>;
  facts: { label: string; value: string; verified?: boolean; validUntil?: string | null }[];
  terms: { term: string; kind: 'USE' | 'AVOID'; alternatives: string[] }[];
  notes: string[];
}

/**
 * A stand-in for Contenter's service API (docs/18-docoo-integration.md of Contenter): the same
 * routes, the same bearer token, the same shape of answer. Tests change `businesses` to simulate
 * edits in Contenter and flip `mode` to simulate an outage or a switched-off API.
 */
export class FakeContenter {
  token = FAKE_CONTENTER_TOKEN;
  mode: 'up' | 'down' | 'disabled' = 'up';
  requests: { path: string; authorization: string }[] = [];
  businesses = new Map<string, FakeBusiness>();
  private server: Server | undefined;
  apiUrl = '';

  add(business: FakeBusiness): void {
    this.businesses.set(business.id, business);
  }

  exportOf(id: string): Record<string, unknown> | null {
    const b = this.businesses.get(id);
    if (!b) return null;
    const keys = [
      'OVERVIEW',
      'SERVICES',
      'TARGET_MARKET',
      'PERSONAS',
      'VALUE_PROPOSITION',
      'COMPETITORS',
      'BRAND_VOICE',
      'BRAND_BOOK',
      'KEY_MESSAGES',
      'CONTENT_PILLARS',
      'GUIDELINES',
      'CHANNELS',
      'GOALS',
      'FAQ',
      'CALENDAR',
    ];
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      business: {
        id: b.id,
        name: b.name,
        tagline: 'Test tagline',
        industry: 'Fintech',
        website: 'https://example.com',
        location: 'Tehran',
        language: 'en',
        status: 'ACTIVE',
        origin: 'MANUAL',
        keyword: null,
        buildState: 'NONE',
        researchedAt: null,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-02T00:00:00.000Z',
        sources: [{ url: 'https://example.com/a', title: 'A' }],
        gaps: ['The fee schedule is unverified'],
      },
      sections: keys.map((key) => ({
        key,
        content: b.sections[key] ?? '',
        source: 'ADMIN',
        reviewedAt: b.sections[key] ? '2026-10-02T00:00:00.000Z' : null,
        updatedAt: b.sections[key] ? '2026-10-02T00:00:00.000Z' : null,
      })),
      facts: b.facts.map((fact, index) => ({
        id: `f${index}`,
        label: fact.label,
        value: fact.value,
        category: 'PRICING',
        sourceUrl: '',
        note: '',
        source: 'ADMIN',
        verified: fact.verified ?? true,
        validUntil: fact.validUntil ?? null,
        isActive: true,
        updatedAt: '2026-10-02T00:00:00.000Z',
      })),
      terms: b.terms.map((term, index) => ({
        id: `t${index}`,
        ...term,
        note: '',
        isActive: true,
      })),
      notes: b.notes.map((text, index) => ({
        id: `n${index}`,
        text,
        status: 'APPLIED',
        summary: '',
        changedKeys: [],
        isActive: true,
        createdAt: '2026-10-02T00:00:00.000Z',
      })),
      references: [],
      assets: [],
      audit: null,
      health: { score: 60, filled: Object.keys(b.sections).length, total: 15, checks: [] },
      pendingSuggestions: 0,
      topics: [],
    };
  }

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      const authorization = String(request.headers.authorization ?? '');
      const path = request.url ?? '';
      this.requests.push({ path, authorization });
      const send = (status: number, body: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
      };
      if (this.mode === 'down') return send(503, { message: 'Service Unavailable' });
      if (this.mode === 'disabled') return send(404, { message: 'Not Found', statusCode: 404 });
      if (authorization !== `Bearer ${this.token}`) {
        return send(401, { message: 'Invalid integration token', statusCode: 401 });
      }
      const url = new URL(path, 'http://contenter.test');
      if (url.pathname === '/api/integrations/docoo/ping') {
        return send(200, {
          ok: true,
          service: 'contenter',
          schemaVersion: 1,
          businesses: this.businesses.size,
        });
      }
      if (url.pathname === '/api/integrations/docoo/businesses') {
        const q = (url.searchParams.get('q') ?? '').toLowerCase();
        const items = [...this.businesses.values()]
          .filter((b) => !q || b.name.toLowerCase().includes(q))
          .map((b) => ({
            id: b.id,
            name: b.name,
            tagline: 'Test tagline',
            industry: 'Fintech',
            website: 'https://example.com',
            location: 'Tehran',
            language: 'en',
            status: 'ACTIVE',
            filledSections: Object.keys(b.sections).length,
            totalSections: 15,
            topics: 0,
            updatedAt: '2026-10-02T00:00:00.000Z',
          }));
        return send(200, { items, total: items.length, page: 1, pageSize: 20, totalPages: 1 });
      }
      const match = /^\/api\/integrations\/docoo\/businesses\/([^/]+)\/export$/u.exec(url.pathname);
      if (match) {
        const body = this.exportOf(decodeURIComponent(match[1]!));
        return body
          ? send(200, body)
          : send(404, { message: 'Business not found', statusCode: 404 });
      }
      return send(404, { message: 'Not Found' });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.apiUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/api`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** A business with enough content to see in prompts and on the page. */
export const wePod = (): FakeBusiness => ({
  id: 'biz-wepod',
  name: 'WePod Digital Branch',
  sections: {
    OVERVIEW: 'WePod is the digital branch of a bank. It serves salaried customers.',
    SERVICES: 'Loans and cards. The loan ceiling is listed in the key facts.',
    TARGET_MARKET: 'Salaried employees aged 25 to 45 in large cities.',
    PERSONAS: 'Sara, 30, an accountant who wants a fast loan without visiting a branch.',
    BRAND_VOICE: 'Warm, clear and respectful.',
    GUIDELINES: 'Never promise guaranteed profit. Always show the disclaimer.',
    GOALS: 'Grow digital loan applications by 20 percent this year.',
  },
  facts: [
    { label: 'Loan ceiling', value: '500 million toman' },
    { label: 'Old campaign rate', value: '18 percent', validUntil: '2020-01-01' },
  ],
  terms: [
    { term: 'WePod', kind: 'USE', alternatives: ['We Pod', 'Wepod'] },
    { term: 'WePod Bank', kind: 'AVOID', alternatives: ['WePod Digital Branch'] },
  ],
  notes: ['Always address customers formally.'],
});
