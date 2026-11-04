import type { LiveActionView, LiveAskAnswer, LiveSessionView } from '@docoo/contracts';
import { describe, expect, it } from 'vitest';

import type { LiveBackend } from './live-api';
import { createLiveStore, type LiveStoreDeps } from './store';
import { projectIdFromPath } from './live-chat';

const caps = {
  idleSleepS: 120,
  sessionMaxMinutes: 30,
  sessionCostCapUsd: 5,
  dailyCostCapUsd: 20,
  taskCostCapUsd: 1,
  maxActionsPerTask: 8,
  confirmTimeoutS: 120,
};
const session = (): LiveSessionView =>
  ({
    id: '11111111-1111-4111-8111-111111111111',
    status: 'active',
    endReason: null,
    mode: 'text',
    caps,
  }) as unknown as LiveSessionView;
const answer = (over: Partial<LiveAskAnswer> = {}): LiveAskAnswer => ({
  answer: 'Hello.',
  actions: [],
  toolCalls: 0,
  stop: 'answered',
  errorCode: null,
  usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.01 },
  ...over,
});
const problem = (code: string) => Object.assign(new Error(code), { code, status: 409 });

function setup(ask: LiveBackend['ask']) {
  const log = {
    started: [] as (string | undefined)[],
    usage: [] as unknown[],
    asks: [] as unknown[],
  };
  const backend: LiveBackend = {
    startSession: (channel) => {
      log.started.push(channel);
      return Promise.resolve(session());
    },
    ask: (id, input) => {
      log.asks.push(input);
      return ask(id, input);
    },
    reportUsage: (_id, totals) => {
      log.usage.push(totals);
      return Promise.resolve({ session: session(), capStatus: 'ok' as const, capsReached: [] });
    },
    appendMessages: () => Promise.resolve({ saved: 0 }),
    endSession: () => Promise.resolve(session()),
    proposeAction: () => Promise.reject(new Error('unused')),
    confirmAction: () => Promise.reject(new Error('unused')),
    cancelAction: () => Promise.reject(new Error('unused')),
    getAction: () => Promise.reject(new Error('unused')),
  };
  const deps: LiveStoreDeps = {
    storage: null,
    acquireLock: () => Promise.resolve({ release: () => undefined }),
    now: () => 1000,
  };
  const store = createLiveStore(deps);
  store.setBackend(backend);
  return { store, log };
}

describe('typing to the assistant', () => {
  it('starts a typed session with no provider connection in the browser', async () => {
    const { store, log } = setup(() => Promise.resolve(answer()));
    expect(store.getSnapshot().available).toBe(false);
    await store.start({ channel: 'text' });
    expect(log.started).toEqual(['text']);
    expect(store.getSnapshot()).toMatchObject({ status: 'awake', channel: 'text', error: null });
    await store.stop();
    expect(store.getSnapshot().status).toBe('off');
  });

  it('still refuses a voice start without a provider', async () => {
    const { store } = setup(() => Promise.resolve(answer()));
    await store.start();
    expect(store.getSnapshot()).toMatchObject({ status: 'error', error: 'unavailable' });
  });

  it('shows the question and the answer, counts the executor tokens, and sends recent turns', async () => {
    const { store, log } = setup(() => Promise.resolve(answer()));
    await store.start({ channel: 'text' });
    expect(await store.ask('  hi  ', '22222222-2222-4222-8222-222222222222')).toBe(true);
    expect(store.getSnapshot().chat.map((line) => [line.role, line.text])).toEqual([
      ['user', 'hi'],
      ['assistant', 'Hello.'],
    ]);
    expect(store.getSnapshot().tokens).toBe(120);
    await store.ask('again');
    expect(log.asks[0]).toMatchObject({
      text: 'hi',
      context: [],
      currentProjectId: '22222222-2222-4222-8222-222222222222',
    });
    expect(log.asks[1]).toMatchObject({
      text: 'again',
      context: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'Hello.' },
      ],
    });
    expect(log.asks[1]).not.toHaveProperty('currentProjectId');
  });

  it('leaves the executor tokens out of what the heartbeat reports: the server counts them', async () => {
    const { store, log } = setup(() => Promise.resolve(answer()));
    await store.start({ channel: 'text' });
    await store.ask('hi');
    expect(store.getSnapshot().tokens).toBe(120);
    await store.stop();
    // The last report before the session ended carried no executor tokens.
    for (const totals of log.usage) {
      expect(totals).toMatchObject({ inputTokens: 0, outputTokens: 0 });
    }
  });

  it('puts what the assistant proposed on the confirmation card, waiting', async () => {
    const proposed = {
      id: '33333333-3333-4333-8333-333333333333',
      sessionId: session().id,
      capability: 'project.pause',
      status: 'proposed',
      proposedAt: '2026-11-04T10:00:00.000000Z',
      expiresAt: '2026-11-04T10:02:00.000000Z',
    } as unknown as LiveActionView;
    const { store } = setup(() => Promise.resolve(answer({ actions: [proposed], toolCalls: 1 })));
    await store.start({ channel: 'text' });
    await store.ask('pause it');
    expect(store.getSnapshot().actions.map((view) => view.id)).toEqual([proposed.id]);
  });

  it('answers one request at a time and ignores empty text', async () => {
    let release: (value: LiveAskAnswer) => void = () => undefined;
    const { store, log } = setup(
      () => new Promise<LiveAskAnswer>((resolve) => (release = resolve)),
    );
    await store.start({ channel: 'text' });
    const first = store.ask('one');
    expect(store.getSnapshot().asking).toBe(true);
    expect(await store.ask('two')).toBe(false);
    expect(await store.ask('   ')).toBe(false);
    release(answer());
    expect(await first).toBe(true);
    expect(store.getSnapshot().asking).toBe(false);
    expect(log.asks).toHaveLength(1);
  });

  it('says a failed request on the chat, keeps the session, and does not send the failure back as context', async () => {
    let calls = 0;
    const { store, log } = setup(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(problem('LIVE_ASK_BUSY')) : Promise.resolve(answer());
    });
    await store.start({ channel: 'text' });
    expect(await store.ask('hi')).toBe(false);
    const lines = store.getSnapshot().chat;
    expect(lines.at(-1)).toMatchObject({ failed: true, text: 'LIVE_ASK_BUSY' });
    expect(store.getSnapshot().status).toBe('awake');
    await store.ask('retry');
    expect(log.asks[1]).toMatchObject({ context: [{ role: 'user', content: 'hi' }] });
  });

  it('closes the session when the server says a cap was reached', async () => {
    const { store } = setup(() => Promise.reject(problem('LIVE_CAP_REACHED')));
    await store.start({ channel: 'text' });
    await store.ask('hi');
    expect(store.getSnapshot()).toMatchObject({ status: 'error', error: 'cap_reached' });
    expect(store.getSnapshot().chat).toEqual([]);
  });

  it('cannot ask without a running session', async () => {
    const { store, log } = setup(() => Promise.resolve(answer()));
    expect(await store.ask('hi')).toBe(false);
    expect(log.asks).toHaveLength(0);
  });
});

describe('the project the owner has open', () => {
  const id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  it('is read from the address', () => {
    expect(projectIdFromPath(`/fa/projects/${id}`)).toBe(id);
    expect(projectIdFromPath(`/en/projects/${id.toUpperCase()}/report`)).toBe(id);
    expect(projectIdFromPath('/fa/projects')).toBeUndefined();
    expect(projectIdFromPath(null)).toBeUndefined();
  });
});
