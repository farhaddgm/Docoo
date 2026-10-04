import { describe, expect, it } from 'vitest';

import type { SmartError, WalkerProgress } from './api';
import { createLimiter } from './error-reporter';
import { developerReport, normalizeDisplayPath } from './format';
import { fill, smartErrorMessage, smartMessagesFor } from './messages';
import { createToastGate, isLocalEcho } from './toast-logic';
import { defaultUiState, parseUiState } from './ui-state';
import { defaultStepKey, neighbourKey, projectIdFromPath, stepHref } from './walker';

/** The steps the API reports (apps/api/src/smart/walker-steps.ts); every one needs texts. */
const STEP_KEYS = [
  'connect_provider',
  'configure_ai',
  'create_topic',
  'add_sources',
  'approve_knowledge',
  'create_project',
  'activate_project',
  'complete_stages',
  'choose_solution',
  'evaluate_document',
  'approve_document',
  'review_brain',
];

function shape(value: unknown): unknown {
  if (Array.isArray(value)) return 'list';
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== 'steps' && key !== 'errorCodes')
        .map(([key, field]) => [key, shape(field)]),
    );
  }
  return typeof value;
}

describe('Smart messages', () => {
  it('has the same structure in Persian and English', () => {
    expect(shape(smartMessagesFor('en'))).toEqual(shape(smartMessagesFor('fa')));
  });

  it('describes every walker step with a summary and what to do, in both languages', () => {
    for (const locale of ['fa', 'en'] as const) {
      const steps = smartMessagesFor(locale).walker.steps;
      expect(Object.keys(steps).sort()).toEqual([...STEP_KEYS].sort());
      for (const key of STEP_KEYS) {
        expect(steps[key]!.title.length, `${locale} ${key} title`).toBeGreaterThan(2);
        expect(steps[key]!.summary.length, `${locale} ${key} summary`).toBeGreaterThan(10);
        expect(steps[key]!.todo.length, `${locale} ${key} todo`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('shares the same API problem codes across languages and falls back to a generic text', () => {
    expect(Object.keys(smartMessagesFor('fa').errorCodes).sort()).toEqual(
      Object.keys(smartMessagesFor('en').errorCodes).sort(),
    );
    expect(smartErrorMessage('en', 'AI_NOT_CONFIGURED')).toContain('ai.connection_id');
    expect(smartErrorMessage('en', 'NOPE')).toBe(smartMessagesFor('en').errorCodes['generic']);
    expect(smartErrorMessage('fa', undefined)).toBe(smartMessagesFor('fa').errorCodes['generic']);
  });

  it('fills placeholders and keeps unknown ones visible', () => {
    expect(fill('{current} of {total}', { current: 2, total: 5 })).toBe('2 of 5');
    expect(fill('Hello {name}', {})).toBe('Hello {name}');
  });
});

describe('persisted Smart state', () => {
  it('falls back to defaults for missing, broken or foreign values', () => {
    expect(parseUiState(null)).toEqual(defaultUiState);
    expect(parseUiState('{broken')).toEqual(defaultUiState);
    expect(parseUiState('42')).toEqual(defaultUiState);
    expect(parseUiState('null')).toEqual(defaultUiState);
  });

  it('keeps valid fields and repairs invalid ones one by one', () => {
    const projectId = '3f2b7c1e-6a0e-4a39-9d52-0a5a1c3b9f10';
    expect(
      parseUiState(
        JSON.stringify({ enabled: false, minimized: false, side: 'start', tab: 'chat', projectId }),
      ),
    ).toEqual({ enabled: false, minimized: false, side: 'start', tab: 'chat', projectId });
    expect(
      parseUiState(
        JSON.stringify({ enabled: 'yes', side: 'top', tab: 'nope', projectId: '../../etc' }),
      ),
    ).toEqual(defaultUiState);
  });
});

describe('error report limiter', () => {
  it('sends one report per signature and window', () => {
    const limiter = createLimiter({ windowMs: 60_000, max: 5, dedupeMs: 30_000 });
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 10_000)).toBe(false);
    expect(limiter.allow('a', 31_000)).toBe(true);
  });

  it('caps the total per window so a crash loop cannot flood the server', () => {
    const limiter = createLimiter({ windowMs: 60_000, max: 3, dedupeMs: 1 });
    const results = ['a', 'b', 'c', 'd', 'e'].map((key, index) => limiter.allow(key, index * 10));
    expect(results).toEqual([true, true, true, false, false]);
    expect(limiter.allow('f', 61_000)).toBe(true);
  });
});

describe('toast dedupe', () => {
  it('shows the same toast once per window', () => {
    const gate = createToastGate(30_000);
    expect(gate('x', 0)).toBe(true);
    expect(gate('x', 29_999)).toBe(false);
    expect(gate('y', 29_999)).toBe(true);
    expect(gate('x', 30_000)).toBe(true);
  });

  const item = (patch: Partial<SmartError> = {}) => ({
    source: 'server' as const,
    method: 'GET',
    httpStatus: 500,
    lastSeenAt: '2026-10-04T10:00:05.000000Z',
    ...patch,
  });
  const at = Date.parse('2026-10-04T10:00:00Z');

  it('recognises the feed echo of an error this browser already toasted', () => {
    expect(isLocalEcho(item(), [{ method: 'GET', status: 500, at }])).toBe(true);
    expect(isLocalEcho(item(), [{ method: 'POST', status: 500, at }])).toBe(false);
    expect(isLocalEcho(item(), [{ method: 'GET', status: 503, at }])).toBe(false);
    expect(isLocalEcho(item(), [{ method: 'GET', status: 500, at: at - 60_000 }])).toBe(false);
    expect(isLocalEcho(item({ source: 'client' }), [{ method: 'GET', status: 500, at }])).toBe(
      false,
    );
  });
});

describe('walker helpers', () => {
  const progress = (nextStep: string | null): WalkerProgress => ({
    projectId: null,
    doneCount: 1,
    total: 3,
    nextStep,
    steps: ['one', 'two', 'three'].map((key, index) => ({
      key,
      order: index + 1,
      status: 'ready',
      blockedBy: null,
      counter: null,
      attention: 0,
    })),
  });

  it('shows the suggested step first, or the last one when everything is done', () => {
    expect(defaultStepKey(progress('two'))).toBe('two');
    expect(defaultStepKey(progress(null))).toBe('three');
  });

  it('walks to the neighbour and stays put at both ends', () => {
    expect(neighbourKey(progress('two'), 'two', 1)).toBe('three');
    expect(neighbourKey(progress('two'), 'two', -1)).toBe('one');
    expect(neighbourKey(progress('two'), 'three', 1)).toBe('three');
    expect(neighbourKey(progress('two'), 'one', -1)).toBe('one');
  });

  it('links only to pages that exist, with the locale and the selected project', () => {
    const id = '3f2b7c1e-6a0e-4a39-9d52-0a5a1c3b9f10';
    expect(stepHref('fa', 'connect_provider')).toBe('/fa/providers');
    expect(stepHref('en', 'review_brain')).toBe('/en/brain');
    expect(stepHref('en', 'create_topic')).toBe('/en/topics');
    expect(stepHref('en', 'create_project')).toBe('/en/projects/new');
    expect(stepHref('fa', 'activate_project')).toBe('/fa/projects');
    expect(stepHref('fa', 'activate_project', id)).toBe(`/fa/projects/${id}`);
    expect(stepHref('en', 'complete_stages', id)).toBe(`/en/projects/${id}?tab=workflow`);
    expect(stepHref('en', 'choose_solution', id)).toBe(`/en/projects/${id}?tab=solutions`);
    expect(stepHref('en', 'approve_document', id)).toBe(`/en/projects/${id}?tab=documents`);
    // A project step without a selected project has nowhere to go; so do steps without a page.
    expect(stepHref('en', 'complete_stages')).toBeNull();
    expect(stepHref('en', 'add_sources')).toBeNull();
    expect(stepHref('en', 'configure_ai')).toBeNull();
  });

  it('follows the project of the current page', () => {
    const id = '3F2B7C1E-6A0E-4A39-9D52-0A5A1C3B9F10';
    expect(projectIdFromPath(`/fa/projects/${id}/documents`)).toBe(id.toLowerCase());
    expect(projectIdFromPath(`/en/projects/${id}`)).toBe(id.toLowerCase());
    expect(projectIdFromPath('/fa/projects')).toBeNull();
    expect(projectIdFromPath('/fa/projects/not-an-id/x')).toBeNull();
  });
});

describe('display helpers', () => {
  it('hides ids in paths shown to the admin', () => {
    expect(
      normalizeDisplayPath('/workspaces/3f2b7c1e-6a0e-4a39-9d52-0a5a1c3b9f10/topics?status=all'),
    ).toBe('/workspaces/:id/topics');
  });

  it('builds a complete Markdown report for a developer', () => {
    const report = developerReport({
      header: 'Smart report',
      id: 'i1',
      title: 'Broken gate',
      status: 'open',
      createdAt: '2026-10-04T10:00:00Z',
      body: '# Broken gate\n\nDetails',
      context: { route: '/fa' },
      note: 'Looking',
    });
    expect(report).toContain('# Smart report');
    expect(report).toContain('- ID: i1');
    expect(report).toContain('- Fix note: Looking');
    expect(report).toContain('```json');
    expect(report).toContain('"route": "/fa"');
  });
});
