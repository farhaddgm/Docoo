import { levelBoundsProblem } from '@docoo/documents';

/**
 * Rules a value must follow beyond its type and range (docs/04-architecture/03-api-contracts.md).
 * They keep a setting from being saved in a form the system would silently ignore.
 */
const rules: Readonly<Record<string, (value: unknown) => string | null>> = {
  'document.level_bounds': levelBoundsProblem,
};

export function settingSemanticProblem(key: string, value: unknown): string | null {
  return rules[key]?.(value) ?? null;
}
