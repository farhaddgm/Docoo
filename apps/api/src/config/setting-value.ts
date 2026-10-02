/** Subset of JSON Schema used by setting definitions (validated server-side). */
export interface SettingValueSchema {
  readonly type: 'boolean' | 'integer' | 'number' | 'string' | 'array';
  readonly minimum?: number;
  readonly maximum?: number;
  readonly enum?: readonly string[];
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly items?: SettingValueSchema;
  readonly maxItems?: number;
}

export function validateSettingValue(schema: SettingValueSchema, value: unknown): string | null {
  switch (schema.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'Expected true or false.';
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'Expected a number.';
      if (schema.type === 'integer' && !Number.isInteger(value)) return 'Expected a whole number.';
      if (schema.minimum !== undefined && value < schema.minimum) {
        return `Must be at least ${schema.minimum}.`;
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        return `Must be at most ${schema.maximum}.`;
      }
      return null;
    }
    case 'string': {
      if (typeof value !== 'string') return 'Expected text.';
      if (schema.enum && !schema.enum.includes(value)) {
        return `Must be one of: ${schema.enum.join(', ')}.`;
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        return `Must be at most ${schema.maxLength} characters.`;
      }
      if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) {
        return 'Has an invalid format.';
      }
      return null;
    }
    case 'array': {
      if (!Array.isArray(value)) return 'Expected a list.';
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        return `Must have at most ${schema.maxItems} items.`;
      }
      if (!schema.items) return null;
      for (const [index, item] of value.entries()) {
        const problem = validateSettingValue(schema.items, item);
        if (problem) return `Item ${index + 1}: ${problem}`;
      }
      return null;
    }
  }
}

/** Stable JSON with sorted object keys, used for snapshot hashes. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
