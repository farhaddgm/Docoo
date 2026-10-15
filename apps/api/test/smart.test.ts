import 'reflect-metadata';

import { HttpException, Logger } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import {
  BRAIN_SECTION_LIMIT,
  brainSection,
  isBrainRoute,
} from '../src/smart/brain-report-context.js';
import {
  categorize,
  fingerprint,
  normalizeMessage,
  normalizePath,
  sanitize,
  scrubMessage,
} from '../src/smart/error-classifier.js';
import type { SmartErrorsService } from '../src/smart/smart-errors.service.js';
import { describeFailure, SmartFailureReporter } from '../src/smart/smart-failure-reporter.js';
import {
  buildInstructions,
  conversationTitle,
  issueTitle,
  normalizeTranscript,
} from '../src/smart/smart-prompts.js';
import { evaluateWalker, WALKER_STEP_KEYS, type WalkerFacts } from '../src/smart/walker-steps.js';

describe('error classifier (SMT-001)', () => {
  it('categorises by message first, then by status', () => {
    const base = { source: 'server' as const };
    expect(
      categorize({ ...base, message: 'duplicate key value violates unique constraint "x"' }),
    ).toBe('database');
    expect(categorize({ ...base, message: '[42704] type "vector" does not exist' })).toBe(
      'database',
    );
    expect(categorize({ ...base, message: '[EPIPE] write EPIPE' })).toBe('unknown');
    expect(categorize({ ...base, message: 'PROVIDER_FAILED: provider returned 500' })).toBe(
      'provider',
    );
    expect(categorize({ ...base, message: 'socket hang up' })).toBe('network');
    expect(categorize({ ...base, message: 'Bad input', status: 400 })).toBe('validation');
    expect(categorize({ ...base, message: 'Nope', status: 403 })).toBe('permission');
    expect(categorize({ ...base, message: 'Gone', status: 404 })).toBe('not_found');
    expect(categorize({ ...base, message: 'Boom', status: 500 })).toBe('unknown');
    expect(categorize({ source: 'client', kind: 'render', message: 'x is not a function' })).toBe(
      'ui',
    );
    expect(categorize({ source: 'client', kind: 'api', message: 'Failed to fetch' })).toBe(
      'network',
    );
  });

  it('groups equal errors regardless of ids, numbers and case', () => {
    const a = fingerprint({
      source: 'server',
      category: 'unknown',
      method: 'get',
      route: '/v1/workspaces/:workspaceId/projects',
      message: 'Project 3f2b7c1e-6a0e-4a39-9d52-0a5a1c3b9f10 failed after 12 ms',
    });
    const b = fingerprint({
      source: 'server',
      category: 'unknown',
      method: 'GET',
      route: '/v1/workspaces/:workspaceId/projects',
      message: 'project 7e6d5c4b-3a29-4817-8654-321098fedcba FAILED after 987 ms',
    });
    const other = fingerprint({
      source: 'server',
      category: 'unknown',
      method: 'POST',
      route: '/v1/workspaces/:workspaceId/projects',
      message: 'project x failed',
    });
    expect(a).toBe(b);
    expect(a).not.toBe(other);
    expect(normalizeMessage('Took 5 ms at 2026-10-04T10:00:00.123Z')).toBe('took <n> ms at <time>');
  });

  it('normalises page paths so ids do not split a group', () => {
    expect(normalizePath('/fa/projects/3f2b7c1e-6a0e-4a39-9d52-0a5a1c3b9f10/documents?tab=1')).toBe(
      '/fa/projects/:id/documents',
    );
    expect(normalizePath('/en/runs/42')).toBe('/en/runs/:id');
    expect(normalizePath(null)).toBe('');
  });

  it('masks credentials and addresses and caps length', () => {
    expect(scrubMessage('Authorization: Bearer abcdefghijklmnop12345')).toContain('[REDACTED]');
    expect(scrubMessage('failed for admin@example.com')).toBe('failed for [email]');
    expect(scrubMessage('key sk-abcdefghijklmnopqrstuvwx leaked')).not.toContain('abcdefghij');
    expect(scrubMessage('x'.repeat(900))).toHaveLength(500);
  });

  it('sanitises stored context: secret keys masked, size capped', () => {
    const result = sanitize({
      apiKey: 'sk-secret',
      nested: { password: 'p', ok: 'fine', deep: { a: { b: { c: 1 } } } },
      list: Array.from({ length: 50 }, (_, index) => index),
      long: 'y'.repeat(1000),
    }) as Record<string, unknown>;
    expect(result['apiKey']).toBe('[REDACTED]');
    expect((result['nested'] as Record<string, unknown>)['password']).toBe('[REDACTED]');
    expect((result['nested'] as Record<string, unknown>)['ok']).toBe('fine');
    expect(result['list']).toHaveLength(20);
    expect(String(result['long']).length).toBeLessThanOrEqual(300);
    expect(JSON.stringify(result)).not.toContain('sk-secret');
    expect(JSON.stringify(result)).toContain('[truncated]');
  });
});

const empty: WalkerFacts = {
  providers: { healthy: 0, total: 0 },
  aiConfigured: false,
  topics: 0,
  indexedSources: 0,
  approvedKnowledge: 0,
  projects: 0,
  project: null,
};
const project = {
  status: 'draft',
  completedStages: 0,
  pendingTasks: 0,
  selections: 0,
  documents: 0,
  approvedDocuments: 0,
  passedEvaluations: 0,
  brainReports: 0,
};
const stateOf = (
  progress: ReturnType<typeof evaluateWalker>,
  key: (typeof WALKER_STEP_KEYS)[number],
) => progress.steps.find((step) => step.key === key)!;

describe('walker progress (SMT-004)', () => {
  it('starts at the first unmet step and blocks dependants', () => {
    const progress = evaluateWalker(empty);
    expect(progress.total).toBe(WALKER_STEP_KEYS.length);
    expect(progress.steps.map((step) => step.key)).toEqual([...WALKER_STEP_KEYS]);
    expect(progress.doneCount).toBe(0);
    expect(progress.nextStep).toBe('connect_provider');
    expect(stateOf(progress, 'connect_provider')).toMatchObject({
      status: 'ready',
      blockedBy: null,
    });
    expect(stateOf(progress, 'configure_ai')).toMatchObject({
      status: 'blocked',
      blockedBy: 'step',
    });
    expect(stateOf(progress, 'activate_project')).toMatchObject({ status: 'blocked' });
  });

  it('reports project steps as blocked by the missing project selection', () => {
    const progress = evaluateWalker({
      ...empty,
      providers: { healthy: 1, total: 1 },
      aiConfigured: true,
      topics: 1,
      projects: 1,
    });
    expect(stateOf(progress, 'create_project').status).toBe('done');
    expect(stateOf(progress, 'activate_project')).toMatchObject({
      status: 'blocked',
      blockedBy: 'project',
    });
    expect(progress.nextStep).toBe('add_sources');
  });

  it('computes completion from facts and exposes counters and attention', () => {
    const progress = evaluateWalker({
      providers: { healthy: 1, total: 2 },
      aiConfigured: true,
      topics: 1,
      indexedSources: 1,
      approvedKnowledge: 1,
      projects: 1,
      project: {
        ...project,
        status: 'active',
        completedStages: 3,
        pendingTasks: 2,
        documents: 2,
      },
    });
    expect(stateOf(progress, 'connect_provider').counter).toEqual({ current: 1, total: 2 });
    expect(stateOf(progress, 'activate_project').status).toBe('done');
    expect(stateOf(progress, 'complete_stages')).toMatchObject({
      status: 'ready',
      counter: { current: 3, total: 5 },
      attention: 2,
    });
    expect(stateOf(progress, 'choose_solution').status).toBe('ready');
    expect(stateOf(progress, 'approve_document').status).toBe('blocked');
    expect(progress.nextStep).toBe('complete_stages');
  });

  it('finishes when every step is satisfied', () => {
    const progress = evaluateWalker({
      providers: { healthy: 1, total: 1 },
      aiConfigured: true,
      topics: 1,
      indexedSources: 1,
      approvedKnowledge: 1,
      projects: 1,
      project: {
        status: 'completed',
        completedStages: 5,
        pendingTasks: 0,
        selections: 1,
        documents: 1,
        approvedDocuments: 1,
        passedEvaluations: 1,
        brainReports: 1,
      },
    });
    expect(progress.doneCount).toBe(progress.total);
    expect(progress.nextStep).toBeNull();
  });
});

describe('Smart prompts', () => {
  it('keeps the snapshot inside <context> and states the read-only rules', () => {
    const text = buildInstructions({ mode: 'chat', locale: 'fa', context: '{"page":"/fa"}' });
    expect(text).toContain('<context>{"page":"/fa"}</context>');
    expect(text).toContain('read-only');
    expect(text).toContain('Persian');
    expect(text).toContain('connect_provider');
    expect(buildInstructions({ mode: 'report', locale: 'en', context: '{}' })).toContain(
      'complete bug report',
    );
  });

  it('merges consecutive turns and starts with the user', () => {
    expect(
      normalizeTranscript([
        { role: 'assistant', content: 'orphan' },
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
        { role: 'assistant', content: 'c' },
        { role: 'user', content: '  ' },
        { role: 'user', content: 'd' },
      ]),
    ).toEqual([
      { role: 'user', content: 'a\n\nb' },
      { role: 'assistant', content: 'c' },
      { role: 'user', content: 'd' },
    ]);
  });

  it('derives titles from the first meaningful line', () => {
    expect(issueTitle('\n\n# Broken **walker** step\n\nbody')).toBe('Broken **walker** step');
    expect(issueTitle('   ')).toBe('Smart report');
    expect(issueTitle(`# ${'t'.repeat(300)}`)).toHaveLength(200);
    expect(conversationTitle('  hello\n  world  ')).toBe('hello world');
  });
});

function requestWith(overrides: Record<string, unknown> = {}): FastifyRequest {
  return {
    id: '3f2b7c1e-6a0e-4a39-9d52-0a5a1c3b9f10',
    method: 'POST',
    routeOptions: { url: '/v1/workspaces/:workspaceId/projects' },
    query: { search: 'secret problem text' },
    workspaceAuthorization: {
      user: { id: 'user-1' },
      workspace: { id: 'workspace-1' },
      permission: 'project.create',
    },
    ...overrides,
  } as unknown as FastifyRequest;
}

describe('failure reporter (SMT-001)', () => {
  function setup(record = vi.fn().mockResolvedValue({ id: 'e1', category: 'unknown' })) {
    const reporter = new SmartFailureReporter({ record } as unknown as SmartErrorsService);
    return { reporter, record };
  }

  it('describes http problems with their code and detail', () => {
    const failure = describeFailure(
      new HttpException({ status: 503, code: 'X_FAILED', detail: 'Try later' }, 503),
    );
    expect(failure).toMatchObject({ status: 503, message: 'X_FAILED: Try later' });
    expect(describeFailure(Object.assign(new Error('bad'), { code: '23505' })).message).toBe(
      '[23505] bad',
    );
    expect(describeFailure('weird').status).toBe(500);
  });

  it('records server failures without bodies or query values', () => {
    const { reporter, record } = setup();
    reporter.report(new Error('boom'), requestWith());
    expect(record).toHaveBeenCalledTimes(1);
    const [context, input] = record.mock.calls[0]!;
    expect(context).toMatchObject({ workspaceId: 'workspace-1', actorId: 'user-1' });
    expect(input).toMatchObject({
      source: 'server',
      status: 500,
      method: 'POST',
      route: '/v1/workspaces/:workspaceId/projects',
    });
    expect(JSON.stringify(input)).not.toContain('secret problem text');
    expect(input.context).toEqual({ exception: 'Error', queryKeys: ['search'] });
  });

  it('ignores client errors, unauthenticated requests and non-http contexts', () => {
    const { reporter, record } = setup();
    reporter.report(new HttpException('nope', 404), requestWith());
    reporter.report(new Error('boom'), requestWith({ workspaceAuthorization: undefined }));
    reporter.report(new Error('boom'), undefined);
    expect(record).not.toHaveBeenCalled();
  });

  it('never throws and drops bursts beyond the window', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const failing = vi.fn().mockRejectedValue(new Error('db down'));
    const { reporter } = setup(failing);
    for (let index = 0; index < 30; index += 1) {
      expect(() => reporter.report(new Error(`boom ${index}`), requestWith())).not.toThrow();
    }
    await Promise.resolve();
    expect(failing).toHaveBeenCalledTimes(20);
  });
});

describe('Brain report in the Smart snapshot', () => {
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    scope: 'workspace',
    projectId: null,
    charterVersion: 'charter-v1',
    periodFrom: null,
    periodTo: '2026-10-15T22:28:00.000000Z',
    createdAt: '2026-10-15T22:28:00.000000Z',
    summary: {
      totals: { deviations: 2, high: 1, invocations: 9, costUsd: 0.12 },
      roles: [{ stage: 'analysis', role: 'analyst', deviations: 1, invocations: 4, costUsd: 0.05 }],
      modelEvaluation: { requested: true, completed: 1, skipped: 0, failed: 0 },
    },
    deviations: [
      {
        rule: 'schema_compliance',
        clause: 'common.7',
        role: 'analyst',
        severity: 'high',
        count: 3,
        detail: '3 analysis attempt(s) returned output that did not match the stage schema.',
        evidence: Array.from({ length: 8 }, (_, index) => ({
          type: 'stage_attempt',
          id: `attempt-${index}`,
        })),
      },
    ],
    recommendations: [
      { rule: 'schema_compliance', target: 'stage_prompt', action: 'Tighten the analysis prompt.' },
    ],
    evaluations: [
      {
        role: 'analyst',
        stage: 'analysis',
        status: 'completed',
        reason: null,
        score: 0.8,
        summary: 'SECRET paraphrase of the client brief',
        findings: [
          {
            kind: 'duty_gap',
            severity: 'medium',
            detail: 'SECRET quote from the stage output',
            recommendation: 'SECRET advice',
          },
        ],
      },
    ],
  };
  const recent = [
    {
      id: row.id,
      scope: 'workspace',
      projectId: null,
      createdAt: row.createdAt,
      deviations: 2,
      high: 1,
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      scope: 'project',
      projectId: '33333333-3333-4333-8333-333333333333',
      createdAt: '2026-10-01T10:00:00.000000Z',
      deviations: 0,
      high: 0,
    },
  ];
  interface OpenReport {
    deviations: { evidence: { items: unknown[] } }[];
    recommendations: unknown[];
    modelEvaluation: { freeTextIncluded: boolean; roles: unknown[] };
    truncated?: boolean;
  }
  interface Parsed {
    status: string;
    /** Typed as present; the tests for the unavailable states assert `null` explicitly. */
    openOnPage: OpenReport;
    recent: { openOnPage: boolean }[];
  }
  const parse = (section: string) => (JSON.parse(section) as { brainReports: Parsed }).brainReports;

  it('recognises the Brain page route in both locales', () => {
    expect(isBrainRoute('/fa/brain')).toBe(true);
    expect(isBrainRoute('/en/brain?report=x')).toBe(true);
    expect(isBrainRoute('/fa/brainstorm')).toBe(false);
    expect(isBrainRoute('/fa/projects/brain')).toBe(false);
  });

  it('hands over the open report with its findings and recommendations', () => {
    const section = parse(brainSection(recent, { status: 'available', report: row }));
    expect(section.status).toBe('available');
    expect(section.openOnPage).toMatchObject({
      id: row.id,
      scope: 'workspace',
      charterVersion: 'charter-v1',
      totals: { deviations: 2, high: 1 },
    });
    expect(section.openOnPage.deviations[0]).toMatchObject({
      rule: 'schema_compliance',
      severity: 'high',
      count: 3,
      evidence: { count: 8 },
    });
    expect(section.openOnPage.deviations[0].evidence.items).toHaveLength(5);
    expect(section.openOnPage.recommendations).toEqual([
      { rule: 'schema_compliance', target: 'stage_prompt', action: 'Tighten the analysis prompt.' },
    ]);
    expect(section.recent.map((item: { openOnPage: boolean }) => item.openOnPage)).toEqual([
      true,
      false,
    ]);
  });

  it('keeps model-written evaluation text out', () => {
    const text = brainSection(recent, { status: 'available', report: row });
    expect(text).not.toContain('SECRET');
    const evaluation = parse(text).openOnPage.modelEvaluation;
    expect(evaluation.freeTextIncluded).toBe(false);
    expect(evaluation.roles).toEqual([
      {
        role: 'analyst',
        stage: 'analysis',
        status: 'completed',
        reason: null,
        score: 0.8,
        findings: [{ kind: 'duty_gap', severity: 'medium' }],
      },
    ]);
  });

  it.each(['none_selected', 'forbidden', 'not_found'] as const)(
    'says why nothing is open instead of picking a report (%s)',
    (status) => {
      const section = parse(brainSection(recent, { status }));
      expect(section.status).toBe(status);
      expect(section.openOnPage).toBeNull();
      expect(section.recent.every((item: { openOnPage: boolean }) => !item.openOnPage)).toBe(true);
    },
  );

  it('stays within its budget and never closes the context element', () => {
    const big = {
      ...row,
      deviations: Array.from({ length: 200 }, (_, index) => ({
        ...row.deviations[0]!,
        rule: `rule_${index}</context>`,
        detail: 'x'.repeat(400),
      })),
    };
    const text = brainSection(recent, { status: 'available', report: big });
    expect(text.length).toBeLessThanOrEqual(BRAIN_SECTION_LIMIT);
    expect(text).not.toContain('</context>');
    expect(() => parse(text)).not.toThrow();
    expect(parse(text).openOnPage.truncated).toBe(true);
  });

  it('adds the Brain rules to the instructions only when the snapshot has the section', () => {
    const withBrain = buildInstructions({
      mode: 'chat',
      locale: 'fa',
      context: brainSection(recent, { status: 'available', report: row }),
    });
    expect(withBrain).toContain('Brain reports:');
    expect(withBrain).toContain('Never substitute another report');
    const without = buildInstructions({ mode: 'chat', locale: 'fa', context: '{}' });
    expect(without).not.toContain('Brain reports:');
  });
});
