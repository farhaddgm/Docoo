import { describe, expect, it } from 'vitest';

import {
  InvalidProjectTransitionError,
  canTransitionProject,
  transitionProject,
} from './project.js';

describe('project state machine', () => {
  it('allows activation of a draft project', () => {
    expect(canTransitionProject('draft', 'active')).toBe(true);
    expect(transitionProject('draft', 'active')).toBe('active');
  });

  it('rejects a transition that skips the recovery lifecycle', () => {
    expect(() => transitionProject('deleted', 'completed')).toThrow(InvalidProjectTransitionError);
  });
});
