import { describe, expect, it } from 'vitest';

import {
  appendLiveMessagesSchema,
  clientEndReasons,
  confirmLiveActionSchema,
  endLiveSessionSchema,
  liveCancelReasons,
  liveRefusalReasons,
  liveSessionEndReasons,
  proposeLiveActionSchema,
  reportLiveUsageSchema,
  startLiveSessionSchema,
} from './live-assistant-api.js';

const ID = '11111111-1111-4111-8111-111111111111';

describe('live assistant requests', () => {
  it('start takes nothing but the open project, and no stray field', () => {
    expect(startLiveSessionSchema.safeParse({}).success).toBe(true);
    expect(startLiveSessionSchema.safeParse({ currentProjectId: ID.toUpperCase() }).data).toEqual({
      currentProjectId: ID,
    });
    expect(startLiveSessionSchema.safeParse({ role: 'owner' }).success).toBe(false);
  });

  it('usage is a set of totals within sane bounds', () => {
    const ok = { inputTokens: 10, outputTokens: 5, costUsd: 0.25 };
    expect(reportLiveUsageSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, costUsd: -1 },
      { ...ok, inputTokens: 1.5 },
      { ...ok, outputTokens: -2 },
      { ...ok, costUsd: 1e9 },
      { ...ok, extra: 1 },
      { inputTokens: 1 },
    ]) {
      expect(reportLiveUsageSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('a browser may only end a session as the person, for being idle, or on an error', () => {
    expect(endLiveSessionSchema.parse({})).toEqual({ reason: 'user' });
    for (const reason of clientEndReasons) {
      expect(endLiveSessionSchema.safeParse({ reason }).success).toBe(true);
    }
    for (const reason of liveSessionEndReasons.filter(
      (item) => !clientEndReasons.includes(item as never),
    )) {
      expect(endLiveSessionSchema.safeParse({ reason }).success, reason).toBe(false);
    }
  });

  it('a proposal names a capability and carries free parameters, untainted unless said otherwise', () => {
    const parsed = proposeLiveActionSchema.parse({ sessionId: ID, capability: 'project.pause' });
    expect(parsed).toEqual({
      sessionId: ID,
      capability: 'project.pause',
      params: {},
      tainted: false,
    });
    expect(proposeLiveActionSchema.safeParse({ sessionId: ID, capability: '' }).success).toBe(
      false,
    );
    expect(
      proposeLiveActionSchema.safeParse({ sessionId: ID, capability: 'x', risk: 'T0' }).success,
    ).toBe(false);
    expect(proposeLiveActionSchema.safeParse({ sessionId: 'nope', capability: 'x' }).success).toBe(
      false,
    );
  });

  it('a spoken confirmation must carry what was said; a click needs nothing', () => {
    expect(confirmLiveActionSchema.safeParse({ via: 'click' }).success).toBe(true);
    expect(confirmLiveActionSchema.safeParse({ via: 'voice' }).success).toBe(false);
    expect(confirmLiveActionSchema.safeParse({ via: 'voice', transcript: '   ' }).success).toBe(
      false,
    );
    expect(confirmLiveActionSchema.safeParse({ via: 'voice', transcript: 'تایید' }).success).toBe(
      true,
    );
    expect(confirmLiveActionSchema.safeParse({ via: 'auto' }).success).toBe(false);
    expect(
      confirmLiveActionSchema.safeParse({ via: 'voice', transcript: 'x'.repeat(501) }).success,
    ).toBe(false);
  });

  it('transcript lines are bounded in number and length', () => {
    const line = { role: 'user', content: 'سلام' };
    expect(appendLiveMessagesSchema.safeParse({ messages: [line] }).success).toBe(true);
    expect(appendLiveMessagesSchema.safeParse({ messages: [] }).success).toBe(false);
    expect(
      appendLiveMessagesSchema.safeParse({ messages: Array.from({ length: 21 }, () => line) })
        .success,
    ).toBe(false);
    expect(
      appendLiveMessagesSchema.safeParse({ messages: [{ role: 'system', content: 'x' }] }).success,
    ).toBe(false);
    expect(
      appendLiveMessagesSchema.safeParse({
        messages: [{ role: 'user', content: 'x'.repeat(4001) }],
      }).success,
    ).toBe(false);
  });

  it('keeps its lists free of duplicates', () => {
    for (const list of [liveSessionEndReasons, liveRefusalReasons, liveCancelReasons]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });
});
