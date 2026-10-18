/**
 * The plan of expected deliverables of a project (ADR-0031). Before ideation the administrator
 * says which outputs they expect and confirms the list; the agents then work towards exactly
 * those. The kinds are fixed by code, never by a model: Docoo writes documents, not code, so a
 * kind it cannot produce is kept visible as outside Docoo instead of being promised.
 */

export const DELIVERABLE_KINDS = [
  'strategy_document',
  'product_documentation',
  'technical_prototype',
] as const;
export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number];

/** The kinds the documenter can produce today. */
export const SUPPORTED_DELIVERABLE_KINDS: readonly DeliverableKind[] = [
  'strategy_document',
  'product_documentation',
];

export const isDeliverableKind = (value: unknown): value is DeliverableKind =>
  DELIVERABLE_KINDS.some((kind) => kind === value);

export const isSupportedDeliverableKind = (kind: DeliverableKind): boolean =>
  SUPPORTED_DELIVERABLE_KINDS.includes(kind);

export const DELIVERABLE_LIMITS = {
  maxItems: 20,
  title: 200,
  text: 2000,
} as const;

export interface DeliverableItemInput {
  readonly kind: DeliverableKind;
  readonly title: string;
  readonly purpose: string;
  readonly scopeIn: string;
  readonly scopeOut: string;
}

const clean = (value: unknown, limit: number): string =>
  typeof value === 'string' ? value.trim().slice(0, limit) : '';

/**
 * The items a request or a model answer stands for. An item without a known kind or a usable
 * title is dropped and counted, so nothing half-formed reaches the plan.
 */
export function normalizeDeliverableItems(raw: unknown): {
  readonly items: DeliverableItemInput[];
  readonly discarded: number;
} {
  const list = Array.isArray(raw) ? raw : [];
  const items: DeliverableItemInput[] = [];
  let discarded = 0;
  const seen = new Set<string>();
  for (const entry of list) {
    const record =
      entry !== null && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const title = clean(record['title'], DELIVERABLE_LIMITS.title);
    const kind = record['kind'];
    const key = `${String(kind)}|${title.toLowerCase()}`;
    if (!isDeliverableKind(kind) || title.length < 2 || seen.has(key)) {
      discarded += 1;
      continue;
    }
    if (items.length >= DELIVERABLE_LIMITS.maxItems) {
      discarded += 1;
      continue;
    }
    seen.add(key);
    items.push({
      kind,
      title,
      purpose: clean(record['purpose'], DELIVERABLE_LIMITS.text),
      scopeIn: clean(record['scopeIn'], DELIVERABLE_LIMITS.text),
      scopeOut: clean(record['scopeOut'], DELIVERABLE_LIMITS.text),
    });
  }
  return { items, discarded };
}

/** A plan can be confirmed only when it promises at least one thing Docoo can produce. */
export const canConfirmDeliverables = (items: readonly { readonly kind: DeliverableKind }[]) =>
  items.some((item) => isSupportedDeliverableKind(item.kind));

export const DELIVERABLE_SCHEMA_NAME = 'deliverable_proposal';

/** The structured answer of the proposal call. */
export const DELIVERABLE_SCHEMA: Readonly<Record<string, unknown>> = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...DELIVERABLE_KINDS] },
          title: { type: 'string' },
          purpose: { type: 'string' },
          scopeIn: { type: 'string' },
          scopeOut: { type: 'string' },
        },
        required: ['kind', 'title', 'purpose', 'scopeIn', 'scopeOut'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

export const DELIVERABLE_PROPOSAL_RULES: readonly string[] = [
  'Propose the outputs the administrator most likely expects from this project, as a short list (usually 1 to 4 items).',
  'kind is exactly one of strategy_document (a document about what to do and why), product_documentation (documentation of a product or service) and technical_prototype (code or a built product).',
  'Use technical_prototype only when the problem clearly asks for code or a built product. Docoo writes documents, not code, so such an item is shown as outside Docoo.',
  'For each item say its purpose, what is in scope and what is out of scope. Use only what the project data says; do not invent facts.',
];

/** Rules added to the stages that work towards the confirmed plan. */
export const DELIVERABLE_STAGE_RULES: readonly string[] = [
  'confirmedDeliverables lists what the administrator confirmed as expected outputs. Work towards exactly these and stay inside each item’s scope.',
  'Do not add an output the administrator did not confirm. An item of kind technical_prototype is outside Docoo: mention it only as out of scope, never plan or describe its content.',
];
