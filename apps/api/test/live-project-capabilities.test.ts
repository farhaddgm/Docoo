import { projectCommands } from '@docoo/domain';
import { describe, expect, it, vi } from 'vitest';

import { LiveCapabilityRegistry } from '../src/live-assistant/capabilities.js';
import { decideProposal, liveSettingsFrom } from '../src/live-assistant/live-gateway.js';
import { compactReport, projectCapabilities } from '../src/live-assistant/project-capabilities.js';
import type { NotificationsService } from '../src/notifications/notifications.service.js';
import type { ProjectReportService } from '../src/projects/project-report.service.js';
import type { ProjectsService } from '../src/projects/projects.service.js';
import type { WorkflowService } from '../src/workflow/workflow.service.js';

const P1 = '11111111-1111-4111-8111-111111111111';
const context = {
  workspaceId: '22222222-2222-4222-8222-222222222222',
  actorId: '33333333-3333-4333-8333-333333333333',
  correlationId: '44444444-4444-4444-8444-444444444444',
};

const project = {
  id: P1,
  code: 'spring',
  title: 'Spring plan',
  description: 'A long confidential description',
  initialProblem: 'A long confidential problem statement',
  status: 'active',
  currentStage: 'research',
  pauseReason: null,
  nextAction: { kind: 'wait' },
  availableCommands: ['pause', 'complete'],
  updatedAt: '2026-11-04T10:00:00.000000Z',
  version: 7,
};

function reportFixture() {
  return {
    project: {
      id: P1,
      code: 'spring',
      title: 'Spring plan',
      status: 'active',
      currentStage: 'research',
      outputLanguage: 'fa',
      kind: 'standard',
      createdAt: 'x',
      updatedAt: 'y',
    },
    problem: {
      initialProblem: 'p'.repeat(5000),
      description: 'd'.repeat(3000),
      expectedOutput: 'e',
      approvedStatement: 's'.repeat(5000),
    },
    usage: {
      totals: {
        invocations: 3,
        inputTokens: 100,
        outputTokens: 50,
        reasoningTokens: 10,
        costUsd: 0.5,
        failures: 1,
      },
      byStage: [{ key: 'analysis' }],
      byModel: [{ key: 'openai:m' }],
    },
    ideas: {
      createdAt: 'z',
      items: Array.from({ length: 12 }, (_, index) => ({
        id: `id-${index}`,
        ordinal: index + 1,
        title: `Idea ${index}`,
        summary: 'x'.repeat(900),
        score: index,
        selectedPriority: index === 0 ? 1 : null,
      })),
    },
    outputs: {
      inProgress: 2,
      items: [
        {
          id: 'doc',
          title: 'Final plan',
          status: 'approved',
          level: 1,
          language: 'fa',
          approvalKind: 'human',
          versionNo: 3,
          updatedAt: 'u',
          artifacts: [
            { id: 'a1', format: 'pdf', sizeBytes: 10, createdAt: 'c' },
            { id: 'a2', format: 'docx', sizeBytes: 20, createdAt: 'c' },
          ],
        },
      ],
    },
  };
}

function fakes() {
  const get = vi.fn().mockResolvedValue(project);
  const command = vi.fn().mockResolvedValue({ ...project, status: 'paused', version: 8 });
  const list = vi.fn().mockResolvedValue({
    items: [{ ...project, waiting: { kind: 'gate', stage: 'research' } }],
    nextCursor: 'more',
  });
  const onProjectCommand = vi.fn().mockResolvedValue(undefined);
  const report = vi.fn().mockResolvedValue(reportFixture());
  const update = vi.fn().mockResolvedValue({ ...project, title: 'Summer plan', version: 8 });
  const summary = vi.fn().mockResolvedValue({ unread: 4 });
  const notes = vi.fn().mockResolvedValue({
    items: [
      {
        id: 'n1',
        kind: 'human_task',
        projectId: P1,
        project: { code: 'spring', title: 'Spring plan' },
        payload: { secret: 'free text that must stay out' },
        createdAt: 'c',
        readAt: null,
        stillWaiting: true,
      },
    ],
    nextCursor: null,
  });
  const registry = new LiveCapabilityRegistry(
    projectCapabilities({
      projects: { get, command, list, update } as unknown as ProjectsService,
      reports: { report } as unknown as ProjectReportService,
      notifications: { summary, list: notes } as unknown as NotificationsService,
      workflow: { onProjectCommand } as unknown as WorkflowService,
    }),
  );
  return { registry, get, command, list, onProjectCommand, report, update, summary, notes };
}

const settings = (over: Record<string, unknown> = {}) =>
  liveSettingsFrom({
    'live_assistant.enabled': true,
    'live_assistant.disclosure_accepted': true,
    'live_assistant.connection_id': P1,
    'live_assistant.model': 'm',
    'live_assistant.access_level': 'act',
    ...over,
  });

describe('the first live assistant capabilities', () => {
  it('are reads and the whole life of a project, each with the right risk', () => {
    const { registry } = fakes();
    expect(registry.names()).toEqual(
      [
        'project.archive',
        'project.complete',
        'project.delete',
        'project.pause',
        'project.rename',
        'project.reopen',
        'project.report',
        'project.restore',
        'project.resume',
        'project.status',
        'project.unarchive',
        'notifications.unread',
        'projects.overview',
        'projects.waiting',
      ].sort(),
    );
    const klass = (name: string) => registry.get(name)?.meta.klass;
    for (const name of [
      'projects.overview',
      'projects.waiting',
      'notifications.unread',
      'project.status',
      'project.report',
    ]) {
      expect(klass(name), name).toBe('T0');
    }
    // Reversible: undone by the opposite command, no model work started.
    for (const name of [
      'project.pause',
      'project.archive',
      'project.unarchive',
      'project.restore',
    ]) {
      expect(klass(name), name).toBe('T1');
    }
    // Starting work again spends money and completing closes the work: consequential, read back first.
    expect(klass('project.resume')).toBe('T2');
    expect(klass('project.complete')).toBe('T2');
    expect(klass('project.reopen')).toBe('T2');
    // Irreversible after 30 days: off until its category is switched on.
    expect(klass('project.delete')).toBe('T3');
    expect(registry.get('project.delete')?.meta.t3Category).toBe('delete');
    expect(registry.get('projects.overview')?.meta.area).toBe('projects_overview');
    expect(registry.get('project.pause')?.meta.area).toBe('project');
  });

  it('expose every lifecycle command of a project except starting it, which is not for a voice', () => {
    const { registry } = fakes();
    const exposed = registry
      .names()
      .filter((name) => registry.get(name)?.meta.write && name !== 'project.rename')
      .map((name) => name.replace('project.', ''))
      .sort();
    expect(exposed).toEqual([...projectCommands].filter((name) => name !== 'activate').sort());
  });

  it('mark only the content reads as untrusted, so a status never makes a change stricter', () => {
    const { registry } = fakes();
    const untrusted = registry.names().filter((name) => registry.get(name)?.untrustedOutput);
    expect(untrusted).toEqual(['project.report']);
  });

  it('check their parameters: a real id, a reason for a pause, a bounded list', () => {
    const { registry } = fakes();
    const parse = (name: string, params: unknown) => registry.get(name)?.params.safeParse(params);
    expect(
      parse('project.pause', { projectId: P1.toUpperCase(), reason: ' waiting ' })?.data,
    ).toEqual({
      projectId: P1,
      reason: 'waiting',
    });
    expect(parse('project.pause', { projectId: P1 })?.success).toBe(false);
    expect(parse('project.pause', { projectId: P1, reason: '   ' })?.success).toBe(false);
    expect(parse('project.pause', { projectId: 'nope', reason: 'x' })?.success).toBe(false);
    expect(parse('project.resume', { projectId: P1 })?.success).toBe(true);
    expect(parse('projects.overview', {})?.data).toEqual({ limit: 10 });
    expect(parse('projects.overview', { limit: 21 })?.success).toBe(false);
    expect(parse('projects.overview', { q: 'x'.repeat(101) })?.success).toBe(false);
  });

  it('tell the owner which project, by its real title and code, in their language', () => {
    const { registry } = fakes();
    const pause = registry.get('project.pause');
    const facts = { title: 'Spring plan', code: 'spring', status: 'active' };
    const params = { projectId: P1, reason: 'waiting for data' };
    expect(pause?.describe(params, 'fa', facts).summary).toBe(
      'توقف پروژهٔ «Spring plan» (spring) — دلیل: waiting for data',
    );
    expect(pause?.describe(params, 'en', facts).summary).toBe(
      'Pause project «Spring plan» (spring) — reason: waiting for data',
    );
    // Without facts it falls back to the id rather than inventing a name.
    expect(pause?.describe(params, 'en', undefined).summary).toContain(P1);
    expect(
      registry.get('project.resume')?.describe({ projectId: P1 }, 'en', facts).summary,
    ).toContain('work and model costs start again');
  });

  it("look the project up themselves before a proposal, so the preview is the server's own", async () => {
    const { registry, get } = fakes();
    const facts = await registry
      .get('project.pause')
      ?.prepare?.(context, { projectId: P1, reason: 'x' });
    expect(facts).toEqual({ title: 'Spring plan', code: 'spring', status: 'active' });
    expect(get).toHaveBeenCalledWith(context, P1);
    get.mockRejectedValueOnce(new Error('not found'));
    await expect(
      registry.get('project.status')?.prepare?.(context, { projectId: P1 }),
    ).rejects.toThrow('not found');
    expect(registry.get('projects.overview')?.prepare).toBeUndefined();
  });

  it('pause as the back office does: current version, a marked reason, then the workflow follows', async () => {
    const { registry, get, command, onProjectCommand } = fakes();
    const out = await registry
      .get('project.pause')
      ?.execute({ context, sessionId: P1, actionId: P1 }, { projectId: P1, reason: 'waiting' });
    expect(get).toHaveBeenCalledWith(context, P1);
    expect(command).toHaveBeenCalledWith(context, P1, 'pause', {
      expectedVersion: 7,
      reason: 'Voice assistant: waiting',
    });
    expect(onProjectCommand).toHaveBeenCalledWith(context, P1, 'pause');
    expect(command.mock.invocationCallOrder[0]).toBeLessThan(
      onProjectCommand.mock.invocationCallOrder[0] ?? 0,
    );
    expect(out).toEqual({ id: P1, status: 'paused', version: 8 });
  });

  it('resume the same way, with a reason even when none was given', async () => {
    const { registry, command, onProjectCommand } = fakes();
    await registry
      .get('project.resume')
      ?.execute({ context, sessionId: P1, actionId: P1 }, { projectId: P1 });
    expect(command).toHaveBeenCalledWith(context, P1, 'resume', {
      expectedVersion: 7,
      reason: 'Voice assistant: resumed',
    });
    expect(onProjectCommand).toHaveBeenCalledWith(context, P1, 'resume');
  });

  it('do not follow the workflow when the project refuses the command', async () => {
    const { registry, command, onProjectCommand } = fakes();
    command.mockRejectedValueOnce(new Error('PROJECT_STATE_CONFLICT'));
    await expect(
      registry
        .get('project.pause')
        ?.execute({ context, sessionId: P1, actionId: P1 }, { projectId: P1, reason: 'x' }),
    ).rejects.toThrow('PROJECT_STATE_CONFLICT');
    expect(onProjectCommand).not.toHaveBeenCalled();
  });

  it('read a small fixed set of fields, never the problem text', async () => {
    const { registry } = fakes();
    const run = { context, sessionId: P1, actionId: P1 };
    const one = await registry.get('project.status')?.execute(run, { projectId: P1 });
    expect(one).toEqual({
      id: P1,
      code: 'spring',
      title: 'Spring plan',
      status: 'active',
      stage: 'research',
      pauseReason: null,
      nextAction: { kind: 'wait' },
      availableCommands: ['pause', 'complete'],
      updatedAt: '2026-11-04T10:00:00.000000Z',
    });
    const list = await registry.get('projects.overview')?.execute(run, { limit: 5, q: 'spr' });
    expect(list).toEqual({
      projects: [
        {
          id: P1,
          code: 'spring',
          title: 'Spring plan',
          status: 'active',
          stage: 'research',
          waitingForYou: true,
        },
      ],
      more: true,
    });
    expect(JSON.stringify([one, list])).not.toMatch(/confidential/u);
  });

  it('go through the same gateway: a read runs, a pause waits, and out of scope is refused before the target is looked at', () => {
    const { registry } = fakes();
    const ask = (
      name: string,
      params: unknown,
      over: Record<string, unknown> = {},
      extra: object = {},
    ) =>
      decideProposal({
        registry,
        capability: name,
        params,
        settings: settings(over),
        tainted: false,
        currentProjectId: null,
        ...extra,
      });
    expect(ask('projects.overview', {}, { 'live_assistant.access_level': 'read' })).toMatchObject({
      outcome: 'accepted',
      tier: 'T0',
    });
    expect(
      ask(
        'project.pause',
        { projectId: P1, reason: 'x' },
        {},
        { facts: { title: 'T', code: 'c', status: 'active' } },
      ),
    ).toMatchObject({
      outcome: 'accepted',
      tier: 'T1',
      preview: { summary: expect.stringContaining('«T»') as string },
    });
    expect(
      ask(
        'project.pause',
        { projectId: P1, reason: 'x' },
        { 'live_assistant.access_level': 'read' },
      ),
    ).toEqual({
      outcome: 'refused',
      reason: 'read_only',
    });
    const outOfScope = {
      'live_assistant.access_scope': 'selected_projects',
      'live_assistant.access_project_ids': ['99999999-9999-4999-8999-999999999999'],
    };
    // No existence oracle: out of scope is said first, even for a project that is not there.
    expect(
      ask('project.pause', { projectId: P1, reason: 'x' }, outOfScope, { prepareFailed: true }),
    ).toEqual({
      outcome: 'refused',
      reason: 'out_of_scope',
    });
    expect(
      ask('project.pause', { projectId: P1, reason: 'x' }, {}, { prepareFailed: true }),
    ).toEqual({
      outcome: 'refused',
      reason: 'target_not_found',
    });
  });

  it('asking again at confirmation checks access and tier without rebuilding the preview', () => {
    const { registry } = fakes();
    const again = decideProposal({
      registry,
      capability: 'project.resume',
      params: { projectId: P1 },
      settings: settings(),
      tainted: false,
      currentProjectId: null,
      skipPreview: true,
    });
    expect(again).toMatchObject({
      outcome: 'accepted',
      tier: 'T2',
      projectId: P1,
      preview: { summary: '' },
    });
    expect(
      decideProposal({
        registry,
        capability: 'project.resume',
        params: { projectId: P1 },
        settings: settings({ 'live_assistant.access_level': 'read' }),
        tainted: false,
        currentProjectId: null,
        skipPreview: true,
      }),
    ).toEqual({ outcome: 'refused', reason: 'read_only' });
  });
});

describe('the rest of the project capabilities', () => {
  const run = { context, sessionId: P1, actionId: P1 };

  it('need a reason only where the back office does', () => {
    const { registry } = fakes();
    const parse = (name: string, params: unknown) =>
      registry.get(name)?.params.safeParse(params)?.success;
    expect(parse('project.complete', { projectId: P1 })).toBe(false);
    expect(parse('project.reopen', { projectId: P1 })).toBe(false);
    expect(parse('project.complete', { projectId: P1, reason: 'finished' })).toBe(true);
    for (const name of [
      'project.archive',
      'project.unarchive',
      'project.delete',
      'project.restore',
    ]) {
      expect(parse(name, { projectId: P1 }), name).toBe(true);
    }
  });

  it('name the project in every preview, and an irreversible change by its title', () => {
    const { registry } = fakes();
    const facts = { title: 'Spring plan', code: 'spring', status: 'active' };
    for (const name of registry.names().filter((item) => registry.get(item)?.meta.write)) {
      const capability = registry.get(name);
      const params = { projectId: P1, reason: 'because' };
      for (const locale of ['fa', 'en'] as const) {
        const preview = capability?.describe(params, locale, facts);
        expect(preview?.summary, `${name} ${locale}`).toContain('«Spring plan» (spring)');
      }
    }
    expect(registry.get('project.delete')?.describe({ projectId: P1 }, 'en', facts)).toMatchObject({
      targetName: 'Spring plan',
    });
    // Only the irreversible one carries a name to be echoed.
    expect(
      registry.get('project.archive')?.describe({ projectId: P1 }, 'en', facts).targetName,
    ).toBeUndefined();
  });

  it('delete as the back office does, with the workflow following', async () => {
    const { registry, command, onProjectCommand } = fakes();
    await registry.get('project.delete')?.execute(run, { projectId: P1 });
    expect(command).toHaveBeenCalledWith(context, P1, 'delete', {
      expectedVersion: 7,
      reason: 'Voice assistant: deleted',
    });
    expect(onProjectCommand).toHaveBeenCalledWith(context, P1, 'delete');
  });

  it('refuse an irreversible change without a name to confirm it by', () => {
    const { registry } = fakes();
    const decision = decideProposal({
      registry,
      capability: 'project.delete',
      params: { projectId: P1 },
      settings: liveSettingsFrom({
        'live_assistant.enabled': true,
        'live_assistant.disclosure_accepted': true,
        'live_assistant.connection_id': P1,
        'live_assistant.model': 'm',
        'live_assistant.access_level': 'act',
        'live_assistant.t3_categories': ['delete'],
      }),
      tainted: false,
      currentProjectId: null,
      facts: undefined,
    });
    expect(decision).toEqual({ outcome: 'refused', reason: 'misconfigured' });
  });

  it('cut the report down to what a conversation needs', async () => {
    const { registry, report } = fakes();
    const out = (await registry
      .get('project.report')
      ?.execute(run, { projectId: P1 })) as ReturnType<typeof compactReport>;
    expect(report).toHaveBeenCalledWith(context, P1);
    expect(out.problem.initialProblem).toHaveLength(4000);
    expect(out.problem.description).toHaveLength(2000);
    expect(out.problem.approvedStatement).toHaveLength(4000);
    expect(out.ideas.total).toBe(12);
    expect(out.ideas.items).toHaveLength(10);
    expect(out.ideas.items[0]).toEqual({
      title: 'Idea 0',
      summary: 'x'.repeat(600),
      score: 0,
      chosenPriority: 1,
    });
    expect(out.usage).toEqual({
      invocations: 3,
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.5,
      failures: 1,
    });
    expect(out.outputs.final).toEqual([
      {
        title: 'Final plan',
        status: 'approved',
        language: 'fa',
        version: 3,
        formats: ['pdf', 'docx'],
      },
    ]);
    // The same bounds hold whatever the report holds: ids of files, per-model breakdowns and the like stay out.
    expect(JSON.stringify(out)).not.toMatch(/openai:m|"a1"|byStage/u);
    expect(compactReport(reportFixture() as never).project.stage).toBe('research');
  });
});

describe('waiting work, notifications and renaming', () => {
  const run = { context, sessionId: P1, actionId: P1 };

  it('lists what waits for the owner, without the long texts', async () => {
    const { registry, list } = fakes();
    const out = await registry.get('projects.waiting')?.execute(run, { limit: 5 });
    expect(list).toHaveBeenCalledWith(context, { limit: 5, status: 'current', waiting: true });
    expect(out).toEqual({
      projects: [
        {
          id: P1,
          code: 'spring',
          title: 'Spring plan',
          status: 'active',
          stage: 'research',
          waitingFor: 'gate',
          waitingStage: 'research',
        },
      ],
      more: true,
    });
    expect(registry.get('projects.waiting')?.meta.area).toBe('projects_overview');
  });

  it('reads unread notifications as a back office matter, and leaves their free text out', async () => {
    const { registry, summary, notes } = fakes();
    const capability = registry.get('notifications.unread');
    expect(capability?.meta.area).toBe('backoffice');
    const out = await capability?.execute(run, { limit: 3 });
    expect(summary).toHaveBeenCalledWith(context);
    expect(notes).toHaveBeenCalledWith(context, { status: 'unread', limit: 3 });
    expect(out).toEqual({
      unread: 4,
      items: [
        {
          kind: 'human_task',
          project: { code: 'spring', title: 'Spring plan' },
          stillWaiting: true,
          createdAt: 'c',
        },
      ],
    });
    expect(JSON.stringify(out)).not.toContain('free text');
  });

  it('are out of reach of an assistant that has the projects but not the back office', () => {
    const { registry } = fakes();
    const ask = (name: string, params: unknown, scope: string) =>
      decideProposal({
        registry,
        capability: name,
        params,
        settings: liveSettingsFrom({
          'live_assistant.enabled': true,
          'live_assistant.disclosure_accepted': true,
          'live_assistant.connection_id': P1,
          'live_assistant.model': 'm',
          'live_assistant.access_scope': scope,
        }),
        tainted: false,
        currentProjectId: null,
      });
    expect(ask('notifications.unread', {}, 'all_projects')).toEqual({
      outcome: 'refused',
      reason: 'out_of_scope',
    });
    expect(ask('notifications.unread', {}, 'backoffice')).toMatchObject({
      outcome: 'accepted',
      tier: 'T0',
    });
    expect(ask('projects.waiting', {}, 'all_projects')).toMatchObject({
      outcome: 'accepted',
      tier: 'T0',
    });
  });

  it('rename keeps the old title in the ledger, and says both names in the preview', async () => {
    const { registry, get, update } = fakes();
    const capability = registry.get('project.rename');
    const facts = { title: 'Spring plan', code: 'spring', status: 'active' };
    expect(capability?.describe({ projectId: P1, title: 'Summer plan' }, 'en', facts).summary).toBe(
      'Rename project «Spring plan» (spring) to "Summer plan"',
    );
    expect(
      capability?.describe({ projectId: P1, title: 'Summer plan' }, 'fa', facts).summary,
    ).toContain('«Spring plan»');
    const out = await capability?.execute(run, { projectId: P1, title: 'Summer plan' });
    expect(get).toHaveBeenCalledWith(context, P1);
    expect(update).toHaveBeenCalledWith(context, P1, 7, {
      title: 'Summer plan',
      reason: 'Voice assistant: renamed',
    });
    expect(out).toEqual({ id: P1, from: 'Spring plan', to: 'Summer plan', version: 8 });
  });

  it('rename needs a real title', () => {
    const { registry } = fakes();
    const parse = (params: unknown) => registry.get('project.rename')?.params.safeParse(params);
    expect(parse({ projectId: P1, title: '  New  ' })?.data).toEqual({
      projectId: P1,
      title: 'New',
    });
    expect(parse({ projectId: P1, title: '   ' })?.success).toBe(false);
    expect(parse({ projectId: P1, title: 'x'.repeat(201) })?.success).toBe(false);
    expect(parse({ projectId: P1 })?.success).toBe(false);
  });
});
