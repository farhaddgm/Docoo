import { describe, expect, it, vi } from 'vitest';

import { LiveCapabilityRegistry } from '../src/live-assistant/capabilities.js';
import { decideProposal, liveSettingsFrom } from '../src/live-assistant/live-gateway.js';
import { projectCapabilities } from '../src/live-assistant/project-capabilities.js';
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

function fakes() {
  const get = vi.fn().mockResolvedValue(project);
  const command = vi.fn().mockResolvedValue({ ...project, status: 'paused', version: 8 });
  const list = vi.fn().mockResolvedValue({
    items: [{ ...project, waiting: { kind: 'gate', stage: 'research' } }],
    nextCursor: 'more',
  });
  const onProjectCommand = vi.fn().mockResolvedValue(undefined);
  const registry = new LiveCapabilityRegistry(
    projectCapabilities({
      projects: { get, command, list } as unknown as ProjectsService,
      workflow: { onProjectCommand } as unknown as WorkflowService,
    }),
  );
  return { registry, get, command, list, onProjectCommand };
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
  it('are a read of the list, a read of one project, a pause and a resume, with the right risk', () => {
    const { registry } = fakes();
    expect(registry.names()).toEqual([
      'project.pause',
      'project.resume',
      'project.status',
      'projects.overview',
    ]);
    const klass = (name: string) => registry.get(name)?.meta.klass;
    expect(klass('projects.overview')).toBe('T0');
    expect(klass('project.status')).toBe('T0');
    expect(klass('project.pause')).toBe('T1');
    // Starting work again spends money: consequential, so it is read back before confirming.
    expect(klass('project.resume')).toBe('T2');
    expect(registry.get('projects.overview')?.meta.area).toBe('projects_overview');
    expect(registry.get('project.pause')?.meta.area).toBe('project');
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
