/**
 * Shapes and rules of the settings screens (ADR-0018). The server is the authority on what a
 * value may be; the checks here only keep an administrator from sending what it would refuse
 * and turn what they typed into the JSON value of the setting.
 */
export interface ValueSchema {
  type: 'boolean' | 'integer' | 'number' | 'string' | 'array';
  minimum?: number;
  maximum?: number;
  enum?: string[];
  maxLength?: number;
  pattern?: string;
  items?: ValueSchema;
  maxItems?: number;
}

export interface Definition {
  key: string;
  valueSchema: ValueSchema;
  defaultValue: unknown;
  allowedScopes: ('workspace' | 'topic' | 'project')[];
  sensitive: boolean;
  description: { fa: string; en: string };
}

export type Scope = 'workspace' | 'topic' | 'project';

export type Source =
  | { scope: 'system' }
  | { scope: Scope; scopeId: string; sequence: number }
  | { scope: 'project'; pending: true };

export interface Effective {
  values: Record<string, unknown>;
  sources: Record<string, Source>;
}

export interface Assignment {
  key: string;
  scopeType: Scope;
  scopeId: string;
  sequence: number;
  value: unknown;
  cleared: boolean;
  reason: string;
  restoredFromSequence: number | null;
  createdAt: string;
}

/** How the settings are grouped on the page, in reading order. */
export const SETTING_GROUPS = [
  {
    id: 'workflow',
    keys: [
      'workflow.require_human_approval',
      'workflow.max_attempts_per_stage',
      'ai.max_cost_usd_per_run',
    ],
  },
  { id: 'ai', keys: ['ai.connection_id', 'ai.model'] },
  {
    id: 'research',
    keys: [
      'research.max_queries',
      'research.knowledge_limit',
      'research.allow_restricted_knowledge',
      'research.max_sources',
      'knowledge.min_audit_score',
    ],
  },
  { id: 'solutions', keys: ['solution.count'] },
  {
    id: 'documents',
    keys: ['document.level', 'document.default_template', 'document.level_bounds'],
  },
  {
    id: 'ingestion',
    keys: ['ingestion.max_file_mb', 'ingestion.url_policy', 'ingestion.url_allowlist'],
  },
] as const;
export type GroupId = (typeof SETTING_GROUPS)[number]['id'];

/**
 * Recorded but not applied by any stage yet; the page says so instead of implying an effect.
 * Empty since 0.17.0: `research.max_sources` and `knowledge.min_audit_score` are enforced now.
 */
export const NOT_ENFORCED: ReadonlySet<string> = new Set<string>();

/** Edited on a page of their own (a list of ten numbers is not a form field). */
export const EDITED_ELSEWHERE: ReadonlySet<string> = new Set(['document.level_bounds']);

/** Shown and changed on the AI providers page, which also knows the connections and models. */
export const PROVIDER_PAGE: ReadonlySet<string> = new Set(['ai.connection_id', 'ai.model']);

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The text an editable control starts with for a value. */
export function toControlText(schema: ValueSchema, value: unknown): string {
  if (schema.type === 'array') {
    return Array.isArray(value)
      ? value.filter((item) => typeof item === 'string' || typeof item === 'number').join('\n')
      : '';
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

export type ProblemCode =
  | 'required'
  | 'not_a_number'
  | 'not_whole'
  | 'too_small'
  | 'too_large'
  | 'too_long'
  | 'bad_format'
  | 'too_many'
  | 'not_allowed'
  | 'item';

export interface ControlProblem {
  code: ProblemCode;
  min?: number;
  max?: number;
  count?: number;
  line?: number;
}

/** Turns what was typed or chosen into a value for the schema, or says what is wrong. */
export function parseControlText(
  schema: ValueSchema,
  text: string,
): { ok: true; value: unknown } | { ok: false; problem: ControlProblem } {
  switch (schema.type) {
    case 'boolean':
      return { ok: true, value: text === 'true' };
    case 'integer':
    case 'number': {
      const trimmed = text.trim();
      if (trimmed === '') return { ok: false, problem: { code: 'required' } };
      const number = Number(trimmed);
      if (!Number.isFinite(number)) return { ok: false, problem: { code: 'not_a_number' } };
      if (schema.type === 'integer' && !Number.isInteger(number)) {
        return { ok: false, problem: { code: 'not_whole' } };
      }
      if (schema.minimum !== undefined && number < schema.minimum) {
        return { ok: false, problem: { code: 'too_small', min: schema.minimum } };
      }
      if (schema.maximum !== undefined && number > schema.maximum) {
        return { ok: false, problem: { code: 'too_large', max: schema.maximum } };
      }
      return { ok: true, value: number };
    }
    case 'string': {
      if (schema.enum && !schema.enum.includes(text)) {
        return { ok: false, problem: { code: 'not_allowed' } };
      }
      if (schema.maxLength !== undefined && text.length > schema.maxLength) {
        return { ok: false, problem: { code: 'too_long', max: schema.maxLength } };
      }
      if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(text)) {
        return { ok: false, problem: { code: 'bad_format' } };
      }
      return { ok: true, value: text };
    }
    case 'array': {
      const lines = text
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line !== '');
      if (schema.maxItems !== undefined && lines.length > schema.maxItems) {
        return { ok: false, problem: { code: 'too_many', max: schema.maxItems } };
      }
      const items: unknown[] = [];
      for (const [index, line] of lines.entries()) {
        const parsed = schema.items
          ? parseControlText(schema.items, line)
          : ({ ok: true, value: line } as const);
        if (!parsed.ok)
          return { ok: false, problem: { ...parsed.problem, code: 'item', line: index + 1 } };
        items.push(parsed.value);
      }
      return { ok: true, value: items };
    }
  }
}

/** `document.level_bounds` as five rows of min and max, and back (`null` when not ten numbers). */
export function boundsToRows(value: unknown): { min: number; max: number }[] | null {
  if (!Array.isArray(value) || value.length !== 10 || !value.every(Number.isInteger)) return null;
  const numbers = value as number[];
  return [0, 1, 2, 3, 4].map((level) => ({
    min: numbers[level * 2]!,
    max: numbers[level * 2 + 1]!,
  }));
}

export function rowsToBounds(rows: readonly { min: number; max: number }[]): number[] {
  return rows.flatMap((row) => [row.min, row.max]);
}

export type BoundsProblem =
  | { code: 'not_whole'; level: number }
  | { code: 'min_not_below_max'; level: number }
  | { code: 'overlap'; level: number };

/** The same rules the server enforces for `document.level_bounds`, level by level. */
export function boundsProblem(rows: readonly { min: number; max: number }[]): BoundsProblem | null {
  for (const [index, row] of rows.entries()) {
    const level = index + 1;
    if (!Number.isInteger(row.min) || !Number.isInteger(row.max) || row.min < 0 || row.max < 0) {
      return { code: 'not_whole', level };
    }
    if (row.min >= row.max) return { code: 'min_not_below_max', level };
    if (index > 0 && row.min <= rows[index - 1]!.max) return { code: 'overlap', level };
  }
  return null;
}

/** Where a value comes from, as a short key the messages translate. */
export function sourceKind(
  source: Source | undefined,
): 'system' | 'workspace' | 'topic' | 'project' | 'pending' {
  if (!source) return 'system';
  if ('pending' in source) return 'pending';
  return source.scope;
}
