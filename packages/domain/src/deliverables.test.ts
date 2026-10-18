import { describe, expect, it } from 'vitest';

import {
  canConfirmDeliverables,
  DELIVERABLE_LIMITS,
  isSupportedDeliverableKind,
  normalizeDeliverableItems,
} from './deliverables.js';

describe('deliverable plan', () => {
  it('keeps well-formed items and counts what it drops', () => {
    const { items, discarded } = normalizeDeliverableItems([
      {
        kind: 'strategy_document',
        title: '  What to do  ',
        purpose: 'p',
        scopeIn: 'a',
        scopeOut: 'b',
      },
      { kind: 'strategy_document', title: 'what to do' },
      { kind: 'poem', title: 'Not a kind' },
      { kind: 'product_documentation', title: 'x' },
      'text',
      null,
    ]);
    expect(items).toEqual([
      { kind: 'strategy_document', title: 'What to do', purpose: 'p', scopeIn: 'a', scopeOut: 'b' },
    ]);
    expect(discarded).toBe(5);
  });

  it('caps the list and the length of every text', () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      kind: 'product_documentation',
      title: `Doc ${index}`,
      purpose: 'x'.repeat(5000),
    }));
    const { items, discarded } = normalizeDeliverableItems(many);
    expect(items).toHaveLength(DELIVERABLE_LIMITS.maxItems);
    expect(discarded).toBe(10);
    expect(items[0]!.purpose).toHaveLength(DELIVERABLE_LIMITS.text);
  });

  it('treats code as outside Docoo and needs one thing Docoo can produce', () => {
    expect(isSupportedDeliverableKind('technical_prototype')).toBe(false);
    expect(canConfirmDeliverables([{ kind: 'technical_prototype' }])).toBe(false);
    expect(
      canConfirmDeliverables([{ kind: 'technical_prototype' }, { kind: 'strategy_document' }]),
    ).toBe(true);
    expect(canConfirmDeliverables([])).toBe(false);
  });
});
