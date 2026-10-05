import type { JsonSchema } from './contract.js';

/**
 * What the providers' strict structured-output modes accept (OpenAI `strict: true` is the
 * narrowest of the three the adapters use). Every schema Docoo sends is checked against it in
 * tests, so a provider cannot be the first to reject a schema: the object is closed, every
 * property is required, only supported types and keywords appear and objects nest at most five deep.
 */
export const STRICT_LIMITS = { maxDepth: 5, maxProperties: 100, maxEnumValues: 500 } as const;

const SUPPORTED_TYPES = new Set([
  'object',
  'array',
  'string',
  'integer',
  'number',
  'boolean',
  'null',
]);

/** Keywords of the supported subset; anything else (oneOf, allOf, not, $ref, default…) is refused. */
const SUPPORTED_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'description',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Everything in a schema a strict structured-output mode would refuse; empty means it is fine. */
export function strictSchemaProblems(schema: JsonSchema): string[] {
  const problems: string[] = [];
  let properties = 0;

  const walk = (node: unknown, path: string, depth: number): void => {
    if (!isRecord(node)) {
      problems.push(`${path}: a schema must be an object`);
      return;
    }
    for (const keyword of Object.keys(node)) {
      if (!SUPPORTED_KEYWORDS.has(keyword))
        problems.push(`${path}: keyword "${keyword}" is not supported`);
    }
    const type = node['type'];
    if (typeof type !== 'string' || !SUPPORTED_TYPES.has(type)) {
      problems.push(`${path}: "type" must be one of ${[...SUPPORTED_TYPES].join(', ')}`);
      return;
    }
    // Only objects count as a level of nesting; an array passes its own level down.
    const level = type === 'object' ? depth + 1 : depth;
    if (level > STRICT_LIMITS.maxDepth) {
      problems.push(`${path}: nested deeper than ${STRICT_LIMITS.maxDepth} levels`);
      return;
    }
    if (Array.isArray(node['enum']) && node['enum'].length > STRICT_LIMITS.maxEnumValues) {
      problems.push(`${path}: more than ${STRICT_LIMITS.maxEnumValues} enum values`);
    }
    if (type === 'object') {
      const declared = isRecord(node['properties']) ? Object.keys(node['properties']) : [];
      if (node['additionalProperties'] !== false) {
        problems.push(`${path}: an object must set additionalProperties to false`);
      }
      const required = Array.isArray(node['required']) ? (node['required'] as unknown[]) : [];
      for (const key of declared) {
        if (!required.includes(key))
          problems.push(`${path}.${key}: every property must be required`);
      }
      for (const key of required) {
        if (typeof key === 'string' && !declared.includes(key)) {
          problems.push(`${path}: "${key}" is required but not declared`);
        }
      }
      properties += declared.length;
      if (properties > STRICT_LIMITS.maxProperties) {
        problems.push(`${path}: more than ${STRICT_LIMITS.maxProperties} properties in total`);
      }
      if (isRecord(node['properties'])) {
        for (const [key, child] of Object.entries(node['properties'])) {
          walk(child, `${path}.${key}`, level);
        }
      }
    }
    if (type === 'array') {
      if (node['items'] === undefined) problems.push(`${path}: an array must declare its items`);
      else walk(node['items'], `${path}[]`, level);
    }
  };

  if (schema['type'] !== 'object') problems.push('$: the root of a schema must be an object');
  walk(schema, '$', 0);
  return problems;
}
