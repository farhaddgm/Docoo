import type { ViewerMonitorView } from '@docoo/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { monitorMessages } from './messages';
import { ViewerMonitorView as View } from './viewer-monitor-view';

const base: ViewerMonitorView = {
  generatedAt: '2026-11-09T12:00:00.000Z',
  delayS: 3,
  project: {
    name: 'Market study',
    code: 'MS-1',
    status: 'active',
    currentStage: 'research',
    topics: null,
    business: null,
  },
  transcript: null,
  stages: [
    {
      stage: 'analysis',
      status: 'completed',
      current: false,
      startedAt: '2026-11-09T11:00:00.000Z',
      completedAt: '2026-11-09T11:30:00.000Z',
      attempts: 2,
      output: { title: 'Problem', text: 'The full text\nof the output' },
      error: null,
    },
    {
      stage: 'research',
      status: 'running',
      current: true,
      startedAt: null,
      completedAt: null,
      attempts: null,
      output: null,
      error: null,
    },
    {
      stage: 'ideation',
      status: 'failed',
      current: false,
      startedAt: null,
      completedAt: null,
      attempts: null,
      output: null,
      error: { message: null },
    },
  ],
  gates: null,
  documents: null,
  research: null,
  agents: null,
  assistant: null,
  usage: null,
};

const html = (view: ViewerMonitorView, locale: 'fa' | 'en' = 'en') =>
  renderToStaticMarkup(createElement(View, { view, locale }));

describe('the viewer monitor view', () => {
  it('waits with a notice when no project is on the projector', () => {
    const out = html({ ...base, project: null, stages: [] });
    expect(out).toContain(monitorMessages('en').viewer.noProject);
    expect(out).not.toContain('viewer-stages');
  });

  it('draws the steps with their status, the current one marked, the output in full and a generic error', () => {
    const text = monitorMessages('en').viewer;
    const out = html(base);
    expect(out).toContain('Market study');
    expect(out).toContain('Analysis');
    expect(out).toContain(text.status.completed);
    expect(out).toContain(text.status.running);
    expect(out).toContain('viewer-stage-current');
    expect(out).toContain(text.currentStage);
    expect(out).toContain('The full text');
    expect(out).toContain(text.errorGeneric);
    expect(out).toContain('2 attempts');
  });

  it('draws nothing for the parts the settings hid', () => {
    const text = monitorMessages('en').viewer;
    const out = html(base);
    for (const hidden of [
      text.gatesTitle,
      text.documentsTitle,
      text.agentsTitle,
      text.assistantTitle,
      text.usageTitle,
    ]) {
      expect(out).not.toContain(hidden);
    }
  });

  it('draws the side parts when the view holds them', () => {
    const text = monitorMessages('en').viewer;
    const out = html({
      ...base,
      gates: [{ title: 'Approve the problem', status: 'pending' }],
      documents: [{ title: 'Report', status: 'draft', preview: 'Preview text', quality: null }],
      agents: [{ role: 'analyst', calls: 4, last: { tool: 'web_search', decision: 'allowed' } }],
      assistant: {
        live: true,
        steps: [{ status: 'executed', summary: 'Opened the project', target: 'Docs' }],
      },
      usage: {
        models: [{ provider: 'openai', model: 'gpt-x', tokens: 1500, input: 1000, output: 500 }],
        tokensTotal: 1500,
        costUsd: 0.5,
        costByModel: [0.5],
      },
    });
    for (const shown of [
      text.gatesTitle,
      'Approve the problem',
      text.documentsTitle,
      'Preview text',
      text.agentsTitle,
      'Analyst',
      'web_search',
      text.assistantLive,
      'Opened the project',
      'OpenAI',
      'gpt-x',
      '1,500',
      '$0.50',
    ]) {
      expect(out).toContain(shown);
    }
  });

  it('draws document quality and research sources, as a count, the sites, or the full list', () => {
    const text = monitorMessages('en').viewer;
    const withParts = {
      ...base,
      documents: [
        { title: 'Report', status: 'draft', preview: null, quality: { passed: true, score: 88 } },
      ],
    };
    const out = html({
      ...withParts,
      research: {
        count: 3,
        verified: 2,
        internal: 1,
        domains: ['example.com'],
        sources: [{ title: 'Page A', url: 'https://example.com/a', verified: true }],
      },
    });
    for (const shown of [
      text.qualityPass,
      'score 88',
      text.researchTitle,
      '3 sources, 2 verified',
      '1 from internal knowledge',
      'Page A',
      text.sourceVerified,
      'https://example.com/a',
    ]) {
      expect(out).toContain(shown);
    }
    const sites = html({
      ...withParts,
      research: {
        count: 3,
        verified: 2,
        internal: 0,
        domains: ['example.com', 'news.org'],
        sources: null,
      },
    });
    expect(sites).toContain('example.com · news.org');
    const failed = html({
      ...withParts,
      documents: [{ ...withParts.documents[0]!, quality: { passed: false, score: null } }],
    });
    expect(failed).toContain(text.qualityFail);
    expect(
      html({
        ...base,
        research: { count: 0, verified: 0, internal: 0, domains: null, sources: null },
      }),
    ).not.toContain(text.researchTitle);
  });

  it('draws the topics, the business and the assistant conversation when the view holds them', () => {
    const text = monitorMessages('en').viewer;
    const out = html({
      ...base,
      project: { ...base.project!, topics: ['Retail', 'Food'], business: 'Shop Ltd' },
      transcript: [
        { role: 'assistant', text: 'Opening the project', at: '2026-11-09T11:58:00.000Z' },
      ],
    });
    for (const shown of ['Retail، Food', 'Shop Ltd', text.transcriptTitle, 'Opening the project']) {
      expect(out).toContain(shown);
    }
    expect(html(base)).not.toContain(text.transcriptTitle);
  });

  it('shows the code alone when the name is hidden, and reads in Persian', () => {
    const out = html(
      {
        ...base,
        project: {
          name: null,
          code: 'MS-1',
          status: 'active',
          currentStage: 'research',
          topics: null,
          business: null,
        },
      },
      'fa',
    );
    expect(out).toContain('MS-1');
    expect(out).toContain(monitorMessages('fa').viewer.stages.analysis);
  });
});
