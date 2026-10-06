import { createServer } from 'node:http';

/**
 * A stand-in for the service API of Contenter (docs/18-docoo-integration.md of Contenter) for the
 * end-to-end tests: the same routes, the same bearer token, the same shape of answer. The tests
 * edit the businesses and switch the service off through the /__control routes, which only exist
 * here. It also serves a tiny model price catalog at /__prices/catalog.json. Started by Playwright
 * (see playwright.config.ts); never part of a deployment.
 */
const PORT = Number(process.env.E2E_CONTENTER_PORT ?? 4010);
const TOKEN = 'e2e-contenter-service-token-0123456789abcdef';

const SECTION_KEYS = [
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

const initial = () => ({
  mode: 'up',
  version: 1,
  businesses: [
    {
      id: 'biz-e2e-1',
      name: 'شعبهٔ دیجیتال وی‌پاد',
      tagline: 'وام سریع بدون مراجعه به شعبه',
      industry: 'بانکداری دیجیتال',
      website: 'https://wepod.example.com',
      location: 'تهران',
      language: 'fa',
      sections: {
        OVERVIEW: 'وی‌پاد شعبهٔ دیجیتال یک بانک است و به کارمندان حقوق‌بگیر خدمت می‌دهد.',
        SERVICES: 'وام و کارت اعتباری. سقف وام در واقعیت‌های کلیدی آمده است.',
        TARGET_MARKET: 'کارمندان حقوق‌بگیر ۲۵ تا ۴۵ سال در شهرهای بزرگ.',
        PERSONAS: 'سارا، ۳۰ ساله، حسابدار که وام سریع می‌خواهد.',
        BRAND_VOICE: 'گرم، روشن و محترمانه.',
        GUIDELINES: 'هرگز سود تضمینی وعده نده. همیشه سلب مسئولیت را نشان بده.',
        GOALS: 'افزایش ۲۰ درصدی درخواست‌های وام دیجیتال در سال جاری.',
      },
      aiSections: ['PERSONAS'],
      facts: [
        { label: 'سقف وام', value: '۵۰۰ میلیون تومان', verified: true },
        { label: 'نرخ کمپین قدیمی', value: '۱۸ درصد', verified: false, validUntil: '2020-01-01' },
      ],
      terms: [
        { term: 'وی‌پاد', kind: 'USE', alternatives: ['وی پاد', 'ویپاد'] },
        { term: 'وی‌پاد بانک', kind: 'AVOID', alternatives: ['شعبهٔ دیجیتال وی‌پاد'] },
      ],
      notes: ['مشتریان را همیشه رسمی خطاب کن.'],
      references: [
        {
          kind: 'URL',
          url: 'https://wepod.example.com/about',
          title: 'دربارهٔ وی‌پاد',
          status: 'READY',
          contentChars: 1200,
          excerpt: 'وی‌پاد از سال ۱۴۰۲ فعال است.',
        },
      ],
      assets: [
        {
          kind: 'BANNER',
          title: 'بنر کمپین بهار',
          description: 'بنر وام بهاره',
          analysisStatus: 'DONE',
          analysis: { mood: 'شاد و روشن', colors: ['آبی', 'سفید'] },
        },
      ],
      audit: {
        score: 72,
        summary: 'پروفایل کامل است ولی بخش رقبا خالی است.',
        strengths: ['لحن برند روشن است'],
        issues: [
          {
            severity: 'MEDIUM',
            status: 'OPEN',
            type: 'MISSING',
            target: 'COMPETITORS',
            title: 'رقبا نوشته نشده‌اند',
            detail: 'ایجنت‌ها نمی‌توانند جایگاه‌یابی را بسنجند.',
            fix: 'سه رقیب اصلی را بنویسید.',
          },
        ],
      },
      topics: [{ id: 't1', title: 'وام دیجیتال', status: 'ACTIVE' }],
    },
    {
      id: 'biz-e2e-2',
      name: 'کافهٔ آزمون',
      tagline: '',
      industry: 'کافه و رستوران',
      website: '',
      location: 'شیراز',
      language: 'fa',
      sections: { OVERVIEW: 'یک کافهٔ کوچک در شیراز.' },
      aiSections: [],
      facts: [],
      terms: [],
      notes: [],
      references: [],
      assets: [],
      audit: null,
      topics: [],
    },
  ],
});

let state = initial();

const iso = '2026-10-02T00:00:00.000Z';

function exportOf(business) {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    business: {
      id: business.id,
      name: business.name,
      tagline: business.tagline,
      industry: business.industry,
      website: business.website,
      location: business.location,
      language: business.language,
      status: 'ACTIVE',
      origin: 'MANUAL',
      keyword: null,
      buildState: 'NONE',
      researchedAt: null,
      createdAt: iso,
      updatedAt: iso,
      sources: business.website ? [{ url: business.website, title: 'وب‌سایت' }] : [],
      gaps: business.audit ? ['جدول کارمزدها تأیید نشده است'] : [],
    },
    sections: SECTION_KEYS.map((key) => {
      const content = business.sections[key] ?? '';
      const ai = business.aiSections.includes(key);
      return {
        key,
        content,
        source: ai ? 'AI' : 'ADMIN',
        reviewedAt: content && !ai ? iso : null,
        updatedAt: content ? iso : null,
      };
    }),
    facts: business.facts.map((fact, index) => ({
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
      updatedAt: iso,
    })),
    terms: business.terms.map((term, index) => ({
      id: `t${index}`,
      term: term.term,
      kind: term.kind,
      alternatives: term.alternatives,
      note: '',
      isActive: true,
    })),
    notes: business.notes.map((text, index) => ({
      id: `n${index}`,
      text,
      status: 'APPLIED',
      summary: '',
      changedKeys: [],
      isActive: true,
      createdAt: iso,
    })),
    references: business.references.map((reference, index) => ({
      id: `r${index}`,
      ...reference,
      isActive: true,
      fetchedAt: iso,
    })),
    assets: business.assets.map((asset, index) => ({
      id: `a${index}`,
      url: '',
      fileName: null,
      excerpt: '',
      isActive: true,
      createdAt: iso,
      ...asset,
    })),
    audit: business.audit ? { ...business.audit, createdAt: iso } : null,
    health: {
      score: 20 + Object.keys(business.sections).length * 6,
      filled: Object.keys(business.sections).length,
      total: SECTION_KEYS.length,
      checks: [
        {
          id: 'EMPTY_SECTIONS',
          level: 'todo',
          count: SECTION_KEYS.length - Object.keys(business.sections).length,
          keys: [],
        },
        { id: 'FACTS', level: business.facts.length ? 'ok' : 'todo', count: business.facts.length },
      ],
    },
    pendingSuggestions: 0,
    topics: business.topics,
  };
}

function listItem(business) {
  return {
    id: business.id,
    name: business.name,
    tagline: business.tagline,
    industry: business.industry,
    website: business.website,
    location: business.location,
    language: business.language,
    status: 'ACTIVE',
    filledSections: Object.keys(business.sections).length,
    totalSections: SECTION_KEYS.length,
    topics: business.topics.length,
    updatedAt: iso,
  };
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

const server = createServer(async (request, response) => {
  const send = (status, body) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  try {
    const url = new URL(request.url ?? '/', 'http://contenter.e2e');

    // A small model price catalog in the shape of LiteLLM's public file, for the "get prices from the
    // public catalog" test (the API reads it through MODEL_PRICE_CATALOG_URL).
    if (url.pathname === '/__prices/catalog.json') {
      return send(200, {
        sample_spec: { litellm_provider: 'one of https://docs.litellm.ai/docs/providers' },
        'gpt-e2e-catalog': {
          litellm_provider: 'openai',
          mode: 'chat',
          input_cost_per_token: 0.0000025,
          output_cost_per_token: 0.00001,
          cache_read_input_token_cost: 0.00000125,
        },
        'gpt-e2e-free': {
          litellm_provider: 'openai',
          mode: 'chat',
          input_cost_per_token: 0,
          output_cost_per_token: 0,
        },
      });
    }

    // ---- control routes for the tests (no token; this server only listens on loopback) ----
    if (url.pathname.startsWith('/__control/')) {
      const body = request.method === 'POST' ? await readBody(request) : {};
      if (url.pathname === '/__control/ready') return send(200, { ok: true });
      if (url.pathname === '/__control/reset') {
        state = initial();
        return send(200, { ok: true });
      }
      if (url.pathname === '/__control/mode') {
        state.mode = body.mode === 'down' ? 'down' : 'up';
        return send(200, { mode: state.mode });
      }
      if (url.pathname === '/__control/section') {
        const business = state.businesses.find((item) => item.id === body.id);
        if (!business) return send(404, { message: 'no such business' });
        business.sections[body.key] = String(body.content ?? '');
        return send(200, { ok: true });
      }
      if (url.pathname === '/__control/rename') {
        const business = state.businesses.find((item) => item.id === body.id);
        if (!business) return send(404, { message: 'no such business' });
        business.name = String(body.name);
        return send(200, { ok: true });
      }
      return send(404, { message: 'unknown control route' });
    }

    if (state.mode === 'down') return send(503, { message: 'Service Unavailable' });
    if (String(request.headers.authorization ?? '') !== `Bearer ${TOKEN}`) {
      return send(401, { message: 'Invalid integration token', statusCode: 401 });
    }
    if (url.pathname === '/api/integrations/docoo/ping') {
      return send(200, {
        ok: true,
        service: 'contenter',
        schemaVersion: 1,
        businesses: state.businesses.length,
      });
    }
    if (url.pathname === '/api/integrations/docoo/businesses') {
      const q = (url.searchParams.get('q') ?? '').trim();
      const items = state.businesses.filter((item) => !q || item.name.includes(q)).map(listItem);
      return send(200, { items, total: items.length, page: 1, pageSize: 50, totalPages: 1 });
    }
    const match = /^\/api\/integrations\/docoo\/businesses\/([^/]+)\/export$/u.exec(url.pathname);
    if (match) {
      const business = state.businesses.find((item) => item.id === decodeURIComponent(match[1]));
      return business
        ? send(200, exportOf(business))
        : send(404, { message: 'Business not found', statusCode: 404 });
    }
    return send(404, { message: 'Not Found' });
  } catch (error) {
    // The reason stays in this process's log; the answer never carries it.
    console.error('Fake Contenter failed:', error);
    return send(500, { message: 'Internal error' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Fake Contenter listening on http://127.0.0.1:${PORT}`);
});
