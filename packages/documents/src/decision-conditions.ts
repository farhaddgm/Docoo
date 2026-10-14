import type { Block } from './model.js';

/** Approved conditions are copied verbatim; a model must not compress away a decision limit. */
export function decisionConditions(definition: Record<string, unknown>): string[] {
  return [
    ...new Set(
      ['objectives', 'constraints', 'successCriteria', 'outOfScope'].flatMap((key) => {
        const items = definition[key];
        return Array.isArray(items)
          ? items.flatMap((item: unknown) =>
              typeof item === 'string' && item.trim() ? [item.trim()] : [],
            )
          : [];
      }),
    ),
  ];
}

export function decisionConditionBlocks(
  conditions: readonly string[],
  language: 'fa' | 'en',
): Block[] {
  if (conditions.length === 0) return [];
  return [
    {
      type: 'heading',
      id: 'approved-decision-conditions',
      level: 1,
      text: language === 'fa' ? 'شروط مصوب تصمیم' : 'Approved decision conditions',
    },
    { type: 'list', id: 'approved-decision-condition-list', ordered: false, items: conditions },
  ];
}
