import type { VoiceMonitorView } from '@docoo/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { monitorMessages } from './messages';
import { VoiceMonitorView as View } from './voice-monitor-view';

const closed: VoiceMonitorView = {
  generatedAt: '2026-11-09T12:00:00.000Z',
  delayS: 3,
  assistantName: 'Docoo',
  live: true,
  indicator: 'talking',
  model: null,
  tokens: null,
  cost: null,
  access: null,
  sessions: [
    {
      id: 's1',
      current: true,
      live: true,
      startedAt: '2026-11-09T11:50:00.000Z',
      minutes: 10,
      messageCount: 4,
      endReason: null,
      person: { role: 'owner', name: null },
      tokens: null,
      costUsd: null,
    },
  ],
  current: { id: 's1', lines: null, cards: [] },
};

const open: VoiceMonitorView = {
  ...closed,
  model: {
    provider: 'openai',
    model: 'gpt-realtime',
    mode: 'realtime',
    language: 'fa',
    voice: 'alloy',
  },
  tokens: {
    total: 1800,
    input: 1200,
    output: 600,
    executor: { input: 200, output: 100, calls: 3 },
  },
  cost: {
    session: 0.6,
    unpriced: false,
    estimateLabel: true,
    day: 2,
    month: 12,
    caps: { sessionPercent: 12, dailyPercent: 85, sessionCapUsd: 5, dailyCapUsd: 20 },
  },
  access: { scope: 'all_projects', level: 'read' },
  sessions: [
    {
      ...closed.sessions[0]!,
      person: { role: 'owner', name: 'Ali Rezaei' },
      tokens: 1800,
      costUsd: 0.6,
    },
    {
      id: 's0',
      current: false,
      live: false,
      startedAt: '2026-11-09T08:00:00.000Z',
      minutes: 30,
      messageCount: 9,
      endReason: 'cap_cost',
      person: { role: 'owner', name: 'Ali Rezaei' },
      tokens: 500,
      costUsd: null,
    },
  ],
  current: {
    id: 's1',
    lines: [
      { role: 'user', text: 'Open the project', at: '2026-11-09T11:58:00.000Z' },
      { role: 'assistant', text: 'Opening it', at: '2026-11-09T11:58:05.000Z' },
    ],
    cards: [
      {
        status: 'executed',
        summary: 'Open the project',
        at: '2026-11-09T11:58:10.000Z',
        detail: { targetName: 'Docs', steps: ['read', 'open'], tier: 'T0', finishedAt: null },
      },
    ],
  },
};

const html = (view: VoiceMonitorView, locale: 'fa' | 'en' = 'en') =>
  renderToStaticMarkup(createElement(View, { view, locale }));

describe('the voice monitor view', () => {
  it('draws nothing for what the settings hid', () => {
    const text = monitorMessages('en').voice;
    const out = html(closed);
    expect(out).toContain('Docoo');
    expect(out).toContain(text.indicator.talking);
    for (const hidden of [text.modelTitle, text.tokensTitle, text.costTitle, text.accessTitle]) {
      expect(out).not.toContain(hidden);
    }
    expect(out).not.toContain(`aria-label="${text.conversationTitle}"`);
    expect(out).toContain(text.sessionsTitle);
  });

  it('draws the model, tokens, cost with its estimate label, and the access', () => {
    const text = monitorMessages('en').voice;
    const out = html(open);
    expect(out).toContain('OpenAI');
    expect(out).toContain('gpt-realtime');
    expect(out).toContain('Realtime');
    expect(out).toContain('1,800');
    expect(out).toContain('$0.60');
    expect(out).toContain(text.cost.estimate);
    expect(out).toContain('$12.00');
    expect(out).toContain('All projects');
    expect(out).toContain('Read only');
  });

  it('draws the caps as bars, and marks one near its limit', () => {
    const out = html(open);
    expect((out.match(/role="progressbar"/gu) ?? []).length).toBe(2);
    expect(out).toContain('voice-bar-hot');
    expect(out).toContain('85% of the cap');
  });

  it('says "unpriced" instead of a zero cost', () => {
    const out = html({ ...open, cost: { ...open.cost!, session: null, unpriced: true } });
    expect(out).toContain(monitorMessages('en').voice.cost.unpriced);
    expect(out).not.toContain('$0.00');
  });

  it('draws the conversation by speaker, and the cards with their steps', () => {
    const out = html(open);
    expect(out).toContain('Open the project');
    expect(out).toContain('Opening it');
    expect(out).toContain('Ali Rezaei');
    expect(out).toContain(monitorMessages('en').voice.cardStatus.executed);
    expect(out).toContain('Docs');
    expect(out).toContain('read');
  });

  it('lists the end reason of an ended conversation and the live tag of the running one', () => {
    const out = html(open);
    expect(out).toContain('Cost cap');
    expect(out).toContain(monitorMessages('en').voice.live);
  });

  it('says so when there is nothing to list, and when the connection is lost', () => {
    const text = monitorMessages('en').voice;
    const empty = html({ ...closed, live: false, indicator: 'off', sessions: [], current: null });
    expect(empty).toContain(text.noSessions);
    expect(empty).toContain(text.indicator.off);
    const lost = renderToStaticMarkup(
      createElement(View, { view: closed, locale: 'en', lost: true }),
    );
    expect(lost).toContain(text.lost);
  });

  it('reads in Persian too', () => {
    const out = html(open, 'fa');
    expect(out).toContain(monitorMessages('fa').voice.modelTitle);
    expect(out).toContain('۱٬۸۰۰');
  });

  it('never invents a name: a session without one is the owner', () => {
    const out = html({
      ...closed,
      current: {
        id: 's1',
        lines: [{ role: 'user', text: 'hi', at: '2026-11-09T11:58:00.000Z' }],
        cards: null,
      },
    });
    expect(out).toContain(monitorMessages('en').voice.owner);
  });
});
