import { describe, expect, it } from 'vitest';

import { parseMaterialRef } from './project-materials.js';

describe('material references', () => {
  it('accepts the four kinds and nothing else', () => {
    expect(parseMaterialRef('problem')).toEqual({ kind: 'problem' });
    expect(parseMaterialRef('stage:research')).toEqual({ kind: 'stage', stage: 'research' });
    expect(parseMaterialRef('solution:2')).toEqual({ kind: 'solution', number: 2 });
    expect(parseMaterialRef('document:10')).toEqual({ kind: 'document', number: 10 });
    for (const bad of [
      '',
      'stage:',
      'stage:brain',
      'stage:research:extra',
      'solution:0',
      'solution:-1',
      'solution:1; drop table',
      'document:01',
      '../etc/passwd',
      'PROBLEM',
    ]) {
      expect(parseMaterialRef(bad), bad).toBeNull();
    }
  });
});
