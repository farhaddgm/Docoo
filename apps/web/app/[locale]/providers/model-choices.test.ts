import { describe, expect, it } from 'vitest';

import { modelAfterConnectionChange, modelChoices } from './model-choices';

const list = [
  { id: 'gpt-a', name: 'GPT A' },
  { id: 'gpt-b', name: '' },
  { id: 'gpt-a', name: 'duplicate' },
];

describe('the models the full model test offers', () => {
  it('lists each model once, by its name, or its id when it has no name', () => {
    expect(modelChoices(list, '')).toEqual([
      { id: 'gpt-a', label: 'GPT A', outside: false },
      { id: 'gpt-b', label: 'gpt-b', outside: false },
    ]);
  });

  it('keeps a chosen model that the list does not hold, marked, instead of dropping it', () => {
    expect(modelChoices(list, 'retired-model').at(-1)).toEqual({
      id: 'retired-model',
      label: 'retired-model',
      outside: true,
    });
    expect(modelChoices(list, 'gpt-b').some((item) => item.outside)).toBe(false);
    expect(modelChoices(list, '   ').some((item) => item.outside)).toBe(false);
  });

  it('offers nothing for a connection with no list and no choice', () => {
    expect(modelChoices([], '')).toEqual([]);
  });
});

describe('changing the connection of the full model test', () => {
  it('keeps the model only when the new connection offers it', () => {
    expect(modelAfterConnectionChange(list, 'gpt-a')).toBe('gpt-a');
    expect(modelAfterConnectionChange(list, 'claude-x')).toBe('');
    expect(modelAfterConnectionChange([], 'gpt-a')).toBe('');
  });
});
