import type { AgentRole } from './agents.js';

/**
 * The business a project belongs to (ADR-0021). Contenter is where a business is edited; Docoo
 * keeps pinned, read-only snapshots of what Contenter exports and hands the relevant parts to
 * each agent. Everything here is pure: parsing of the export, which sections a role receives,
 * the prompt block with its budget, the terminology check and the difference between snapshots.
 */

/** The export contract this code reads (docs/18-docoo-integration.md of Contenter). */
export const BUSINESS_EXPORT_SCHEMA_VERSION = 1;

// ---- sections ------------------------------------------------------------------------------

export const BUSINESS_SECTION_GROUPS = [
  'IDENTITY',
  'AUDIENCE',
  'BRAND',
  'STRATEGY',
  'RULES',
] as const;
export type BusinessSectionGroup = (typeof BUSINESS_SECTION_GROUPS)[number];

/**
 * The profile sections in Contenter's order (new ones are appended there). `nature` tells a
 * reader how much to trust a section: FACT sections come from sources, STRATEGY sections are
 * analysis, RULES sections bind.
 */
export const BUSINESS_SECTIONS: readonly {
  readonly key: string;
  readonly title: string;
  readonly group: BusinessSectionGroup;
  readonly nature: 'FACT' | 'STRATEGY' | 'RULES';
}[] = [
  { key: 'OVERVIEW', title: 'Overview', group: 'IDENTITY', nature: 'FACT' },
  { key: 'SERVICES', title: 'Products and services', group: 'IDENTITY', nature: 'FACT' },
  { key: 'TARGET_MARKET', title: 'Target market', group: 'AUDIENCE', nature: 'STRATEGY' },
  { key: 'PERSONAS', title: 'Audience personas', group: 'AUDIENCE', nature: 'STRATEGY' },
  { key: 'VALUE_PROPOSITION', title: 'Value proposition', group: 'IDENTITY', nature: 'STRATEGY' },
  { key: 'COMPETITORS', title: 'Competitors and positioning', group: 'IDENTITY', nature: 'FACT' },
  { key: 'BRAND_VOICE', title: 'Brand voice and personality', group: 'BRAND', nature: 'STRATEGY' },
  { key: 'BRAND_BOOK', title: 'Brand book', group: 'BRAND', nature: 'RULES' },
  { key: 'KEY_MESSAGES', title: 'Key messages', group: 'BRAND', nature: 'STRATEGY' },
  { key: 'CONTENT_PILLARS', title: 'Content pillars', group: 'STRATEGY', nature: 'STRATEGY' },
  { key: 'GUIDELINES', title: 'Rules and constraints', group: 'RULES', nature: 'RULES' },
  { key: 'CHANNELS', title: 'Channels and calls to action', group: 'STRATEGY', nature: 'FACT' },
  { key: 'GOALS', title: 'Goals and priorities', group: 'STRATEGY', nature: 'STRATEGY' },
  { key: 'FAQ', title: 'Customer questions and objections', group: 'AUDIENCE', nature: 'FACT' },
  { key: 'CALENDAR', title: 'Occasions and campaigns', group: 'STRATEGY', nature: 'STRATEGY' },
];

const SECTION_ORDER: ReadonlyMap<string, number> = new Map(
  BUSINESS_SECTIONS.map((section, index) => [section.key, index]),
);
const SECTION_TITLE: ReadonlyMap<string, string> = new Map(
  BUSINESS_SECTIONS.map((section) => [section.key, section.title]),
);

// ---- the normalized content ------------------------------------------------------------------

export interface BusinessSection {
  readonly key: string;
  readonly content: string;
  readonly source: 'ADMIN' | 'AI';
  /** null = AI text no person has confirmed yet. */
  readonly reviewedAt: string | null;
  readonly updatedAt: string | null;
}

export interface BusinessFact {
  readonly label: string;
  readonly value: string;
  readonly category: string;
  readonly sourceUrl: string;
  readonly note: string;
  readonly source: 'ADMIN' | 'AI';
  readonly verified: boolean;
  readonly validUntil: string | null;
  readonly isActive: boolean;
}

export interface BusinessTerm {
  readonly term: string;
  readonly kind: 'USE' | 'AVOID';
  readonly alternatives: readonly string[];
  readonly note: string;
  readonly isActive: boolean;
}

export interface BusinessNote {
  readonly text: string;
  readonly status: string;
  readonly summary: string;
  readonly changedKeys: readonly string[];
  readonly isActive: boolean;
  readonly createdAt: string;
}

export interface BusinessReference {
  readonly kind: string;
  readonly url: string;
  readonly title: string;
  readonly status: string;
  readonly isActive: boolean;
  readonly fetchedAt: string | null;
  readonly contentChars: number;
  readonly excerpt: string;
}

export interface BusinessAsset {
  readonly kind: string;
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly fileName: string | null;
  readonly analysisStatus: string;
  readonly analysis: Readonly<Record<string, string | readonly string[]>> | null;
  readonly excerpt: string;
  readonly isActive: boolean;
  readonly createdAt: string;
}

export interface BusinessAuditIssue {
  readonly severity: string;
  readonly status: string;
  readonly type: string;
  readonly target: string;
  readonly title: string;
  readonly detail: string;
  readonly fix: string;
}

export interface BusinessHealthCheck {
  readonly id: string;
  readonly level: 'ok' | 'warn' | 'todo';
  readonly count: number;
  readonly keys: readonly string[];
}

export interface BusinessContent {
  readonly schemaVersion: number;
  readonly business: {
    readonly externalId: string;
    readonly name: string;
    readonly tagline: string;
    readonly industry: string;
    readonly website: string;
    readonly location: string;
    readonly language: string;
    readonly status: string;
    readonly updatedAt: string | null;
    readonly gaps: readonly string[];
    readonly sources: readonly { readonly url: string; readonly title: string }[];
  };
  readonly sections: readonly BusinessSection[];
  readonly facts: readonly BusinessFact[];
  readonly terms: readonly BusinessTerm[];
  readonly notes: readonly BusinessNote[];
  readonly references: readonly BusinessReference[];
  readonly assets: readonly BusinessAsset[];
  readonly audit: {
    readonly score: number | null;
    readonly summary: string;
    readonly strengths: readonly string[];
    readonly issues: readonly BusinessAuditIssue[];
    readonly createdAt: string | null;
  } | null;
  readonly health: {
    readonly score: number;
    readonly filled: number;
    readonly total: number;
    readonly checks: readonly BusinessHealthCheck[];
  } | null;
  readonly pendingSuggestions: number;
  readonly topics: readonly {
    readonly id: string;
    readonly title: string;
    readonly status: string;
  }[];
}

// ---- parsing -----------------------------------------------------------------------------------

export type BusinessExportProblem =
  'not_an_object' | 'unsupported_schema' | 'business_missing' | 'too_large';

export type NormalizedBusiness =
  | { readonly ok: true; readonly content: BusinessContent }
  | { readonly ok: false; readonly problem: BusinessExportProblem };

/** Longest normalized snapshot kept (characters of its JSON). */
export const BUSINESS_CONTENT_MAX_CHARS = 3_000_000;
const SECTION_MAX = 30_000;
const LIMITS = {
  facts: 300,
  terms: 300,
  notes: 50,
  references: 100,
  assets: 200,
  issues: 50,
} as const;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown, max: number, fallback = ''): string =>
  typeof value === 'string' ? value.slice(0, max) : fallback;
const dateOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= 40 ? value : null;
const int = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback;
const list = (value: unknown, max: number): unknown[] =>
  Array.isArray(value) ? value.slice(0, max) : [];
const strings = (value: unknown, max: number, each: number): string[] =>
  list(value, max).flatMap((item) =>
    typeof item === 'string' && item ? [item.slice(0, each)] : [],
  );
const source = (value: unknown): 'ADMIN' | 'AI' => (value === 'AI' ? 'AI' : 'ADMIN');

/** One analysis value, shortened: text or a short list of texts; anything else is dropped. */
function analysisValue(value: unknown): string | string[] | null {
  if (typeof value === 'string') return value.slice(0, 2000);
  if (Array.isArray(value)) {
    const items = strings(value, 20, 500);
    return items.length > 0 ? items : null;
  }
  return null;
}

function analysisOf(value: unknown): Record<string, string | string[]> | null {
  if (!isObject(value)) return null;
  const out: Record<string, string | string[]> = {};
  for (const [key, item] of Object.entries(value).slice(0, 30)) {
    const cleaned = analysisValue(item);
    if (cleaned !== null) out[key.slice(0, 60)] = cleaned;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Reads what Contenter exported and keeps only what Docoo understands, with every length bounded.
 * Unknown fields are dropped (a newer Contenter may add some), a newer breaking schema is
 * refused, and the profile always lists every known section in Contenter's order.
 */
export function normalizeBusinessExport(raw: unknown): NormalizedBusiness {
  if (!isObject(raw)) return { ok: false, problem: 'not_an_object' };
  if (
    typeof raw['schemaVersion'] !== 'number' ||
    raw['schemaVersion'] > BUSINESS_EXPORT_SCHEMA_VERSION
  ) {
    return { ok: false, problem: 'unsupported_schema' };
  }
  const business = raw['business'];
  if (!isObject(business) || typeof business['id'] !== 'string' || !business['id']) {
    return { ok: false, problem: 'business_missing' };
  }

  const seen = new Set<string>();
  const found: BusinessSection[] = [];
  for (const item of list(raw['sections'], 100)) {
    if (!isObject(item) || typeof item['key'] !== 'string' || seen.has(item['key'])) continue;
    seen.add(item['key']);
    found.push({
      key: item['key'].slice(0, 64),
      content: str(item['content'], SECTION_MAX),
      source: source(item['source']),
      reviewedAt: dateOrNull(item['reviewedAt']),
      updatedAt: dateOrNull(item['updatedAt']),
    });
  }
  const byKey = new Map(found.map((section) => [section.key, section]));
  const sections: BusinessSection[] = [
    ...BUSINESS_SECTIONS.map(
      (known) =>
        byKey.get(known.key) ?? {
          key: known.key,
          content: '',
          source: 'ADMIN' as const,
          reviewedAt: null,
          updatedAt: null,
        },
    ),
    ...found.filter((section) => !SECTION_ORDER.has(section.key)),
  ];

  const audit = raw['audit'];
  const health = raw['health'];
  const content: BusinessContent = {
    schemaVersion: raw['schemaVersion'],
    business: {
      externalId: str(business['id'], 100),
      name: str(business['name'], 300),
      tagline: str(business['tagline'], 600),
      industry: str(business['industry'], 300),
      website: str(business['website'], 500),
      location: str(business['location'], 300),
      language: str(business['language'], 10, 'fa'),
      status: str(business['status'], 30),
      updatedAt: dateOrNull(business['updatedAt']),
      gaps: strings(business['gaps'], 100, 1000),
      sources: list(business['sources'], 100).flatMap((item) =>
        isObject(item) && typeof item['url'] === 'string'
          ? [{ url: item['url'].slice(0, 1000), title: str(item['title'], 300) }]
          : [],
      ),
    },
    sections,
    facts: list(raw['facts'], LIMITS.facts).flatMap((item) =>
      isObject(item) && typeof item['label'] === 'string' && typeof item['value'] === 'string'
        ? [
            {
              label: item['label'].slice(0, 300),
              value: item['value'].slice(0, 2000),
              category: str(item['category'], 30, 'OTHER'),
              sourceUrl: str(item['sourceUrl'], 1000),
              note: str(item['note'], 1000),
              source: source(item['source']),
              verified: item['verified'] !== false,
              validUntil: dateOrNull(item['validUntil']),
              isActive: item['isActive'] !== false,
            },
          ]
        : [],
    ),
    terms: list(raw['terms'], LIMITS.terms).flatMap((item) =>
      isObject(item) && typeof item['term'] === 'string' && item['term']
        ? [
            {
              term: item['term'].slice(0, 300),
              kind: item['kind'] === 'AVOID' ? ('AVOID' as const) : ('USE' as const),
              alternatives: strings(item['alternatives'], 30, 300),
              note: str(item['note'], 1000),
              isActive: item['isActive'] !== false,
            },
          ]
        : [],
    ),
    notes: list(raw['notes'], LIMITS.notes).flatMap((item) =>
      isObject(item) && typeof item['text'] === 'string'
        ? [
            {
              text: item['text'].slice(0, 6000),
              status: str(item['status'], 20),
              summary: str(item['summary'], 2000),
              changedKeys: strings(item['changedKeys'], 30, 64),
              isActive: item['isActive'] !== false,
              createdAt: str(item['createdAt'], 40),
            },
          ]
        : [],
    ),
    references: list(raw['references'], LIMITS.references).flatMap((item) =>
      isObject(item)
        ? [
            {
              kind: str(item['kind'], 20),
              url: str(item['url'], 1000),
              title: str(item['title'], 300),
              status: str(item['status'], 20),
              isActive: item['isActive'] !== false,
              fetchedAt: dateOrNull(item['fetchedAt']),
              contentChars: int(item['contentChars']),
              excerpt: str(item['excerpt'], 2000),
            },
          ]
        : [],
    ),
    assets: list(raw['assets'], LIMITS.assets).flatMap((item) =>
      isObject(item)
        ? [
            {
              kind: str(item['kind'], 20),
              title: str(item['title'], 300),
              description: str(item['description'], 2000),
              url: str(item['url'], 1000),
              fileName:
                typeof item['fileName'] === 'string' ? item['fileName'].slice(0, 300) : null,
              analysisStatus: str(item['analysisStatus'], 20),
              analysis: analysisOf(item['analysis']),
              excerpt: str(item['excerpt'], 2000),
              isActive: item['isActive'] !== false,
              createdAt: str(item['createdAt'], 40),
            },
          ]
        : [],
    ),
    audit: isObject(audit)
      ? {
          score: typeof audit['score'] === 'number' ? int(audit['score']) : null,
          summary: str(audit['summary'], 4000),
          strengths: strings(audit['strengths'], 20, 500),
          issues: list(audit['issues'], LIMITS.issues).flatMap((item) =>
            isObject(item)
              ? [
                  {
                    severity: str(item['severity'], 10),
                    status: str(item['status'], 12),
                    type: str(item['type'], 30),
                    target: str(item['target'], 64),
                    title: str(item['title'], 300),
                    detail: str(item['detail'], 2000),
                    fix: str(item['fix'], 1000),
                  },
                ]
              : [],
          ),
          createdAt: dateOrNull(audit['createdAt']),
        }
      : null,
    health: isObject(health)
      ? {
          score: Math.min(100, int(health['score'])),
          filled: int(health['filled']),
          total: int(health['total']),
          checks: list(health['checks'], 30).flatMap((item) =>
            isObject(item) && typeof item['id'] === 'string'
              ? [
                  {
                    id: item['id'].slice(0, 40),
                    level:
                      item['level'] === 'warn' || item['level'] === 'todo'
                        ? item['level']
                        : ('ok' as const),
                    count: int(item['count']),
                    keys: strings(item['keys'], 30, 64),
                  },
                ]
              : [],
          ),
        }
      : null,
    pendingSuggestions: int(raw['pendingSuggestions']),
    topics: list(raw['topics'], 200).flatMap((item) =>
      isObject(item) && typeof item['id'] === 'string'
        ? [
            {
              id: item['id'].slice(0, 100),
              title: str(item['title'], 300),
              status: str(item['status'], 20),
            },
          ]
        : [],
    ),
  };
  if (JSON.stringify(content).length > BUSINESS_CONTENT_MAX_CHARS) {
    return { ok: false, problem: 'too_large' };
  }
  return { ok: true, content };
}

/** JSON with sorted keys: the same content always gives the same text, so it can be hashed. */
export function canonicalBusinessJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalBusinessJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalBusinessJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

// ---- helpers over the content ------------------------------------------------------------------

/** Whether a fact's validity date has passed (compared by calendar day, UTC). */
export function isFactExpired(validUntil: string | null, now: Date): boolean {
  if (!validUntil) return false;
  const time = Date.parse(validUntil);
  if (!Number.isFinite(time)) return false;
  return new Date(time).toISOString().slice(0, 10) < now.toISOString().slice(0, 10);
}

/** A section a person wrote or confirmed; AI text nobody confirmed is a draft. */
export const isSectionConfirmed = (section: BusinessSection): boolean =>
  section.source === 'ADMIN' || section.reviewedAt !== null;

export const filledSections = (content: BusinessContent): readonly BusinessSection[] =>
  content.sections.filter((section) => section.content.trim() !== '');

export interface BusinessChanges {
  readonly sections: readonly string[];
  readonly facts: boolean;
  readonly terms: boolean;
  readonly notes: boolean;
  readonly details: boolean;
}

/** What differs between two snapshots of one business, for the history list. */
export function diffBusinessContent(
  before: BusinessContent | null,
  after: BusinessContent,
): BusinessChanges {
  if (!before) {
    return {
      sections: filledSections(after).map((section) => section.key),
      facts: after.facts.length > 0,
      terms: after.terms.length > 0,
      notes: after.notes.length > 0,
      details: true,
    };
  }
  const old = new Map(before.sections.map((section) => [section.key, section]));
  const changed = after.sections
    .filter((section) => {
      const prior = old.get(section.key);
      return (
        !prior ||
        prior.content !== section.content ||
        prior.source !== section.source ||
        prior.reviewedAt !== section.reviewedAt
      );
    })
    .map((section) => section.key);
  const same = (a: unknown, b: unknown) => canonicalBusinessJson(a) === canonicalBusinessJson(b);
  return {
    sections: changed,
    facts: !same(before.facts, after.facts),
    terms: !same(before.terms, after.terms),
    notes: !same(before.notes, after.notes),
    details: !same(before.business, after.business),
  };
}

// ---- what each agent receives --------------------------------------------------------------------

/**
 * The sections a role gets. Sending the whole profile to every call would multiply the token
 * cost of a long run; each role reads what its work depends on, and the Brain reads none.
 */
export const BUSINESS_ROLE_SECTIONS: Readonly<Record<AgentRole, readonly string[]>> = {
  analyst: [
    'OVERVIEW',
    'SERVICES',
    'TARGET_MARKET',
    'PERSONAS',
    'VALUE_PROPOSITION',
    'COMPETITORS',
    'GUIDELINES',
    'CHANNELS',
    'GOALS',
    'FAQ',
  ],
  researcher: [
    'OVERVIEW',
    'SERVICES',
    'TARGET_MARKET',
    'VALUE_PROPOSITION',
    'COMPETITORS',
    'GUIDELINES',
    'GOALS',
    'FAQ',
  ],
  ideator: [
    'OVERVIEW',
    'SERVICES',
    'TARGET_MARKET',
    'PERSONAS',
    'VALUE_PROPOSITION',
    'COMPETITORS',
    'KEY_MESSAGES',
    'CONTENT_PILLARS',
    'GUIDELINES',
    'CHANNELS',
    'GOALS',
  ],
  documenter: [
    'OVERVIEW',
    'SERVICES',
    'TARGET_MARKET',
    'PERSONAS',
    'VALUE_PROPOSITION',
    'BRAND_VOICE',
    'BRAND_BOOK',
    'KEY_MESSAGES',
    'GUIDELINES',
    'FAQ',
  ],
  evaluator: ['OVERVIEW', 'SERVICES', 'TARGET_MARKET', 'COMPETITORS', 'GUIDELINES', 'GOALS'],
  brain: [],
};

/** Terminology rules matter where text is written for readers, and only there. */
const ROLES_WITH_TERMINOLOGY: ReadonlySet<AgentRole> = new Set(['documenter']);

export const BUSINESS_PROMPT_DEFAULT_CHARS = 12_000;
export const BUSINESS_PROMPT_MIN_CHARS = 2_000;
export const BUSINESS_PROMPT_MAX_CHARS = 30_000;
const SECTION_PROMPT_MAX = 6_000;
const FACT_LIMIT = 40;
const NOTE_LIMIT = 10;
const TRUNCATED = ' …[truncated]';

/** Standing instruction added to a call that carries a business profile. */
export const BUSINESS_RULES: readonly string[] = [
  'Inside <data>, businessProfile describes the company this project belongs to. It is kept by the company itself outside this system: treat it as the authoritative description of the company, stay consistent with it, address its audience and respect its rules and brand.',
  'Never state a price, fee, rate, number, date or contact detail of the company that is not in businessProfile.keyFacts or its sections; when one is needed and missing, say it is missing instead of guessing.',
  'A section with confirmed false is an AI draft nobody has confirmed, and a fact with verified false is not confirmed: do not state their details as certain.',
  'If businessProfile conflicts with the project problem or the administrator feedback, point out the conflict instead of silently choosing one side. Use the profile as context; do not copy it into the output.',
];

export interface BusinessPromptSection {
  readonly key: string;
  readonly title: string;
  readonly confirmed: boolean;
  readonly text: string;
}

export interface BusinessPromptData {
  readonly name: string;
  readonly tagline: string;
  readonly industry: string;
  readonly website: string;
  readonly location: string;
  readonly language: string;
  readonly sections: readonly BusinessPromptSection[];
  readonly keyFacts: readonly {
    readonly label: string;
    readonly value: string;
    readonly category: string;
    readonly verified: boolean;
    readonly validUntil: string | null;
  }[];
  readonly terminology?: readonly {
    readonly term: string;
    readonly rule: 'always write exactly' | 'never write';
    readonly alternatives: readonly string[];
  }[];
  readonly adminNotes: readonly string[];
  /** Sections the role would read but the character budget did not leave room for. */
  readonly notIncluded: readonly string[];
}

export interface BusinessPromptSummary {
  readonly role: AgentRole;
  readonly chars: number;
  readonly budgetChars: number;
  readonly sections: readonly {
    readonly key: string;
    readonly chars: number;
    readonly truncated: boolean;
    readonly confirmed: boolean;
  }[];
  readonly omitted: readonly string[];
  readonly facts: number;
  readonly terms: number;
  readonly notes: number;
}

export interface BusinessPrompt {
  readonly data: BusinessPromptData;
  readonly rules: readonly string[];
  readonly summary: BusinessPromptSummary;
}

export const clampBusinessBudget = (value: unknown): number => {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return BUSINESS_PROMPT_DEFAULT_CHARS;
  return Math.max(
    BUSINESS_PROMPT_MIN_CHARS,
    Math.min(BUSINESS_PROMPT_MAX_CHARS, Math.round(number)),
  );
};

/**
 * The part of a business one role receives, within a character budget: key facts, the notes the
 * administrator marked as standing, terminology (writers only), then the role's sections in
 * Contenter's order, each cut to a fixed length. Returns null when there is nothing for the
 * role. Pure: the same content, role and budget always give the same block.
 */
export function businessPrompt(
  content: BusinessContent,
  options: { role: AgentRole; budgetChars?: number; now?: Date },
): BusinessPrompt | null {
  const { role } = options;
  const wanted = BUSINESS_ROLE_SECTIONS[role];
  if (wanted.length === 0) return null;
  const budget = clampBusinessBudget(options.budgetChars ?? BUSINESS_PROMPT_DEFAULT_CHARS);
  const now = options.now ?? new Date();

  const keyFacts: BusinessPromptData['keyFacts'][number][] = [];
  let used = 0;
  const factBudget = Math.floor(budget * 0.25);
  for (const fact of content.facts) {
    if (!fact.isActive || isFactExpired(fact.validUntil, now) || keyFacts.length >= FACT_LIMIT)
      continue;
    const size = fact.label.length + fact.value.length + 40;
    if (used + size > factBudget) break;
    used += size;
    keyFacts.push({
      label: fact.label,
      value: fact.value,
      category: fact.category,
      verified: fact.verified,
      validUntil: fact.validUntil,
    });
  }

  const terminology: NonNullable<BusinessPromptData['terminology']>[number][] = [];
  if (ROLES_WITH_TERMINOLOGY.has(role)) {
    const termBudget = Math.floor(budget * 0.15);
    let termUsed = 0;
    for (const term of content.terms) {
      if (!term.isActive) continue;
      const size = term.term.length + term.alternatives.join('').length + 40;
      if (termUsed + size > termBudget) break;
      termUsed += size;
      used += size;
      terminology.push({
        term: term.term,
        rule: term.kind === 'AVOID' ? 'never write' : 'always write exactly',
        alternatives: term.alternatives,
      });
    }
  }

  const adminNotes: string[] = [];
  const noteBudget = Math.floor(budget * 0.1);
  let noteUsed = 0;
  for (const note of content.notes) {
    if (!note.isActive || note.status !== 'APPLIED' || adminNotes.length >= NOTE_LIMIT) continue;
    const text = note.text.trim().slice(0, 1500);
    if (noteUsed + text.length > noteBudget) break;
    noteUsed += text.length;
    used += text.length;
    adminNotes.push(text);
  }

  const sections: BusinessPromptSection[] = [];
  const summarySections: BusinessPromptSummary['sections'][number][] = [];
  const omitted: string[] = [];
  for (const section of content.sections) {
    if (!wanted.includes(section.key)) continue;
    const text = section.content.trim();
    if (!text) continue;
    const room = budget - used;
    if (room < 200) {
      omitted.push(section.key);
      continue;
    }
    const cap = Math.min(SECTION_PROMPT_MAX, room);
    const truncated = text.length > cap;
    const shown = truncated ? text.slice(0, Math.max(0, cap - TRUNCATED.length)) + TRUNCATED : text;
    used += shown.length;
    const confirmed = isSectionConfirmed(section);
    sections.push({
      key: section.key,
      title: SECTION_TITLE.get(section.key) ?? section.key,
      confirmed,
      text: shown,
    });
    summarySections.push({ key: section.key, chars: shown.length, truncated, confirmed });
  }

  if (sections.length === 0 && keyFacts.length === 0 && terminology.length === 0) return null;

  const { business } = content;
  const data: BusinessPromptData = {
    name: business.name,
    tagline: business.tagline,
    industry: business.industry,
    website: business.website,
    location: business.location,
    language: business.language,
    sections,
    keyFacts,
    ...(terminology.length > 0 ? { terminology } : {}),
    adminNotes,
    notIncluded: omitted,
  };
  return {
    data,
    rules: BUSINESS_RULES,
    summary: {
      role,
      chars: JSON.stringify(data).length,
      budgetChars: budget,
      sections: summarySections,
      omitted,
      facts: keyFacts.length,
      terms: terminology.length,
      notes: adminNotes.length,
    },
  };
}

// ---- terminology ---------------------------------------------------------------------------------

/**
 * Canonical form for term matching: Arabic yeh and kaf become Persian, no diacritics or tatweel,
 * zero-width joiners and no-break spaces become spaces, spaces collapse, lower case.
 */
export function normalizeTermText(input: string): string {
  return input
    .normalize('NFC')
    .replace(/[\u064a\u0649]/g, '\u06cc')
    .replace(/\u0643/g, '\u06a9')
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/\u200d|[\u200c\u00a0\u200e\u200f]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function countPhrase(normalizedText: string, needle: string): number {
  const phrase = normalizeTermText(needle);
  if (!phrase) return 0;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(phrase)}(?![\\p{L}\\p{N}])`, 'gu');
  return normalizedText.match(pattern)?.length ?? 0;
}

export interface TermIssue {
  readonly kind: 'USE' | 'AVOID';
  /** The rule's term: the right form for USE, the banned word for AVOID. */
  readonly term: string;
  /** What the text contains. */
  readonly found: string;
  readonly count: number;
  /** What to write instead. */
  readonly replaceWith: readonly string[];
  readonly note: string;
}

/**
 * The brand terminology check, by code and never by the model: AVOID terms that appear and wrong
 * variants of USE terms. Case, Arabic and Persian letter variants, diacritics and the
 * half-space all match as the same text.
 */
export function checkTerms(text: string, terms: readonly BusinessTerm[]): TermIssue[] {
  const haystack = normalizeTermText(text);
  if (!haystack) return [];
  const issues: TermIssue[] = [];
  for (const term of terms) {
    if (!term.isActive) continue;
    if (term.kind === 'AVOID') {
      const count = countPhrase(haystack, term.term);
      if (count > 0) {
        issues.push({
          kind: 'AVOID',
          term: term.term,
          found: term.term,
          count,
          replaceWith: term.alternatives,
          note: term.note,
        });
      }
      continue;
    }
    const correct = normalizeTermText(term.term);
    for (const variant of term.alternatives) {
      if (normalizeTermText(variant) === correct) continue;
      const count = countPhrase(haystack, variant);
      if (count > 0) {
        issues.push({
          kind: 'USE',
          term: term.term,
          found: variant,
          count,
          replaceWith: [term.term],
          note: term.note,
        });
      }
    }
  }
  return issues;
}
