import { describe, expect, it } from 'vitest';

import { explicitLabel } from './section-nav';

describe('the name a block gives itself in the side list', () => {
  it('uses a real name', () => {
    expect(explicitLabel('Plan')).toBe('Plan');
    expect(explicitLabel('  برنامه  ')).toBe('برنامه');
  });

  it('never takes the marker value of a bare attribute as a name', () => {
    expect(explicitLabel('true')).toBe('');
    expect(explicitLabel('')).toBe('');
    expect(explicitLabel(null)).toBe('');
  });
});
