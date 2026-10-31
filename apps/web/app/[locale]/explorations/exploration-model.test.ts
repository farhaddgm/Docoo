import { describe, expect, it } from 'vitest';

import {
  composerState,
  countByState,
  filterCandidates,
  offeredDecisions,
  proposeState,
  type CandidateState,
} from './exploration-model';

const candidates = (states: CandidateState[]) => states.map((state) => ({ state }));

describe('exploration screens', () => {
  it('counts candidates by state and in total', () => {
    expect(countByState(candidates(['proposed', 'proposed', 'dropped', 'promoted']))).toEqual({
      all: 4,
      proposed: 2,
      parked: 0,
      dropped: 1,
      promoted: 1,
    });
    expect(countByState([]).all).toBe(0);
  });

  it('filters by state and keeps the order', () => {
    const list = [
      { state: 'parked' as const, id: 1 },
      { state: 'proposed' as const, id: 2 },
      { state: 'parked' as const, id: 3 },
    ];
    expect(filterCandidates(list, 'parked').map((item) => item.id)).toEqual([1, 3]);
    expect(filterCandidates(list, 'all')).toEqual(list);
    expect(filterCandidates(list, 'dropped')).toEqual([]);
  });

  it('offers every way back, never the state it is in, and nothing for a project', () => {
    for (const state of ['proposed', 'parked', 'dropped'] as const) {
      const offered = offeredDecisions(state);
      expect(offered).toHaveLength(2);
      expect(offered).not.toContain(state);
    }
    expect(offeredDecisions('dropped')).toContain('proposed');
    expect(offeredDecisions('promoted')).toEqual([]);
  });

  it('says why a message cannot be sent, in a fixed order of reasons', () => {
    const base = {
      status: 'open' as const,
      usedMessages: 0,
      maxMessages: 5,
      readOnly: false,
      aiEnabled: true,
    };
    expect(composerState(base)).toEqual({ canSend: true, blocked: null });
    expect(composerState({ ...base, usedMessages: 5 }).blocked).toBe('limit');
    expect(composerState({ ...base, aiEnabled: false }).blocked).toBe('ai_off');
    expect(composerState({ ...base, status: 'archived', usedMessages: 5 }).blocked).toBe(
      'archived',
    );
    expect(composerState({ ...base, readOnly: true, status: 'archived' }).blocked).toBe(
      'read_only',
    );
  });

  it('applies the same reasons to asking for candidates', () => {
    const base = {
      status: 'open' as const,
      usedCandidates: 29,
      maxCandidates: 30,
      readOnly: false,
      aiEnabled: true,
    };
    expect(proposeState(base).canSend).toBe(true);
    expect(proposeState({ ...base, usedCandidates: 30 }).blocked).toBe('limit');
    expect(proposeState({ ...base, status: 'archived' }).blocked).toBe('archived');
  });
});
