import { describe, expect, it } from 'vitest';

import {
  monitorSettingDefinitions,
  monitorSettingsFrom,
  type MonitorSettingKey,
  type MonitorSettingValue,
} from './monitor.js';
import { projectViewerMonitor, type ViewerMonitorSource } from './monitor-viewer.js';
import { MASK } from './redaction.js';

const NOW = Date.parse('2026-11-09T12:00:00.000Z');
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
const SECRET = 'SECRET-SENTINEL-9912';

const source = (over: Partial<ViewerMonitorSource> = {}): ViewerMonitorSource => ({
  nowMs: NOW,
  project: {
    code: 'ACME-1',
    title: 'Acme market study',
    status: 'active',
    currentStage: 'research',
  },
  stages: [
    {
      stage: 'analysis',
      status: 'completed',
      attempts: 2,
      startedAt: ago(900),
      completedAt: ago(600),
      outputTitle: 'Problem statement',
      outputText: 'Acme needs a market study. Contact boss@acme.example. '.repeat(20),
      outputAt: ago(600),
      errorCode: null,
      errorText: null,
    },
    {
      stage: 'research',
      status: 'running',
      attempts: 1,
      startedAt: ago(500),
      completedAt: null,
      outputTitle: null,
      outputText: null,
      outputAt: null,
      errorCode: null,
      errorText: null,
    },
    {
      stage: 'ideation',
      status: 'failed',
      attempts: 3,
      startedAt: ago(100),
      completedAt: null,
      outputTitle: null,
      outputText: null,
      outputAt: null,
      errorCode: 'provider_error',
      errorText: 'call to http://10.0.0.5:8080 failed',
    },
  ],
  gates: [{ title: 'Approve the problem for Acme', status: 'pending', createdAt: ago(300) }],
  documents: [
    {
      title: 'Report for Acme',
      status: 'draft',
      preview: 'Preview of Acme report '.repeat(30),
      updatedAt: ago(200),
    },
  ],
  agents: [
    { role: 'analyst', calls: 4, lastTool: 'search', lastDecision: 'allowed', lastAt: ago(60) },
  ],
  actions: [
    {
      status: 'executed',
      summary: 'Open the project Acme',
      targetName: 'Acme',
      proposedAt: ago(120),
    },
  ],
  assistantLive: true,
  usage: [
    { provider: 'openai', model: 'gpt-x', inputTokens: 1000, outputTokens: 500, costUsd: 0.5 },
  ],
  ...over,
});
const settings = (over: Partial<Record<MonitorSettingKey, MonitorSettingValue>> = {}) =>
  monitorSettingsFrom({ 'monitor.delay_s': 0, ...over });
const view = (over: Partial<Record<MonitorSettingKey, MonitorSettingValue>> = {}, src = source()) =>
  projectViewerMonitor(src, settings(over));

describe('the viewer monitor', () => {
  it('shows nothing but a waiting state until a project is put on the screen', () => {
    const empty = view({}, source({ project: null }));
    expect(empty.project).toBeNull();
    expect(empty.stages).toEqual([]);
    expect(empty.usage).toBeNull();
  });

  it('shows the steps of the project in full by default, masked, with no cost, model or tokens', () => {
    const v = view({ 'monitor.blocked_words': ['Acme'] });
    expect(v.stages.map((s) => s.stage)).toEqual(['analysis', 'research', 'ideation']);
    expect(v.stages[0]?.output?.text).toContain(`${MASK} needs a market study`);
    expect(v.stages[0]?.output?.text).not.toContain('boss@');
    expect(v.project).toMatchObject({
      name: `${MASK} market study`,
      code: `${MASK}-1`,
      currentStage: 'research',
    });
    expect(v.stages.find((s) => s.current)?.stage).toBe('research');
    expect(v.usage).toBeNull();
    expect(JSON.stringify(v)).not.toContain('Acme');
  });

  it('follows the output setting: hidden, title, excerpt, full', () => {
    const at = (value: string) => view({ 'monitor.viewer.stage_outputs': value }).stages[0]?.output;
    expect(at('hidden')).toBeNull();
    expect(at('title')).toEqual({ title: 'Problem statement', text: null });
    expect(at('excerpt')?.text?.length).toBeLessThanOrEqual(300);
    expect(at('full')?.text?.length).toBeGreaterThan(300);
  });

  it('follows the stage detail: status only, with times, with attempts', () => {
    expect(view({ 'monitor.viewer.stage_detail': 'status' }).stages[0]).toMatchObject({
      startedAt: null,
      completedAt: null,
      attempts: null,
    });
    expect(view({ 'monitor.viewer.stage_detail': 'times' }).stages[0]).toMatchObject({
      attempts: null,
    });
    expect(view({ 'monitor.viewer.stage_detail': 'times' }).stages[0]?.startedAt).not.toBeNull();
    expect(view({ 'monitor.viewer.stage_detail': 'attempts' }).stages[0]?.attempts).toBe(2);
    expect(view({ 'monitor.viewer.timestamps': 'hidden' }).stages[0]?.startedAt).toBeNull();
  });

  it('follows the project name setting', () => {
    expect(view({ 'monitor.viewer.project_name': 'code' }).project).toMatchObject({
      name: null,
      code: 'ACME-1',
    });
    expect(view({ 'monitor.viewer.project_name': 'hidden' }).project).toMatchObject({
      name: null,
      code: null,
    });
  });

  it('follows the error setting, and masks the message', () => {
    const at = (value: string) => view({ 'monitor.viewer.errors': value }).stages[2]?.error;
    expect(at('hidden')).toBeNull();
    expect(at('generic')).toEqual({ message: null });
    expect(at('message')?.message).toBe(`call to ${MASK} failed`);
    expect(view().stages[0]?.error).toBeNull();
  });

  it('follows the gates, documents, agents and assistant settings', () => {
    expect(view({ 'monitor.viewer.human_gates': 'hidden' }).gates).toBeNull();
    expect(view().gates).toHaveLength(1);
    expect(view({ 'monitor.viewer.documents': 'hidden' }).documents).toBeNull();
    expect(view({ 'monitor.viewer.documents': 'names' }).documents?.[0]?.preview).toBeNull();
    expect(
      view({ 'monitor.viewer.documents': 'preview' }).documents?.[0]?.preview?.length,
    ).toBeLessThanOrEqual(300);
    expect(view({ 'monitor.viewer.agents': 'hidden' }).agents).toBeNull();
    expect(view({ 'monitor.viewer.agents': 'roles' }).agents?.[0]?.last).toBeNull();
    expect(view({ 'monitor.viewer.agents': 'roles_actions' }).agents?.[0]?.last).toEqual({
      tool: 'search',
      decision: 'allowed',
    });
    expect(view({ 'monitor.viewer.assistant_activity': 'hidden' }).assistant).toBeNull();
    expect(view({ 'monitor.viewer.assistant_activity': 'status' }).assistant).toEqual({
      live: true,
      steps: null,
    });
    expect(
      view({ 'monitor.viewer.assistant_activity': 'steps' }).assistant?.steps?.[0]?.target,
    ).toBeNull();
    expect(
      view({ 'monitor.viewer.assistant_activity': 'steps_targets' }).assistant?.steps?.[0]?.target,
    ).toBe('Acme');
  });

  it('shows model, tokens and cost only as far as the settings say', () => {
    expect(view({ 'monitor.viewer.model_info': 'family' }).usage?.models[0]).toMatchObject({
      provider: 'openai',
      model: null,
    });
    expect(view({ 'monitor.viewer.model_info': 'full' }).usage?.models[0]?.model).toBe('gpt-x');
    expect(view({ 'monitor.viewer.tokens': 'total' }).usage).toMatchObject({
      tokensTotal: 1500,
      costUsd: null,
      models: [],
    });
    expect(
      view({ 'monitor.viewer.model_info': 'full', 'monitor.viewer.tokens': 'split' }).usage
        ?.models[0],
    ).toMatchObject({ input: 1000, output: 500 });
    expect(view({ 'monitor.viewer.cost': 'total' }).usage).toMatchObject({
      costUsd: 0.5,
      costByModel: null,
    });
    expect(
      view({ 'monitor.viewer.cost': 'detailed', 'monitor.viewer.model_info': 'family' }).usage
        ?.costByModel,
    ).toEqual([0.5]);
  });

  it('holds back what is newer than the delay', () => {
    const base = source();
    const fresh = source({
      stages: [{ ...base.stages[0]!, outputAt: ago(10) }],
      gates: [{ ...base.gates[0]!, createdAt: ago(10) }],
      documents: [{ ...base.documents[0]!, updatedAt: ago(10) }],
      agents: [{ ...base.agents[0]!, lastAt: ago(10) }],
      actions: [{ ...base.actions[0]!, proposedAt: ago(10) }],
    });
    const v = view({ 'monitor.delay_s': 30 }, fresh);
    expect(v.stages[0]?.output).toBeNull();
    expect(v.assistant?.steps).toEqual([]);
    expect(v.documents).toEqual([]);
    expect(v.gates).toEqual([]);
    expect(v.agents?.[0]?.last).toBeNull();
    expect(view({ 'monitor.delay_s': 5 }, fresh).stages[0]?.output).not.toBeNull();
  });
});

describe('nothing forbidden reaches a screen', () => {
  const planted = (): ViewerMonitorSource => {
    const add = <T extends object>(item: T): T => ({
      ...item,
      id: SECRET,
      projectId: SECRET,
      params: { token: SECRET },
      result: { key: SECRET },
      userId: SECRET,
      connectionId: SECRET,
      email: `${SECRET}@x.io`,
    });
    const s = source();
    return {
      ...s,
      project: add(s.project!),
      stages: s.stages.map(add),
      gates: s.gates.map(add),
      documents: s.documents.map(add),
      agents: s.agents.map(add),
      actions: s.actions.map(add),
      usage: s.usage.map(add),
    };
  };
  const viewerDefs = monitorSettingDefinitions.filter(
    (d) => d.group === 'viewer' || d.key === 'monitor.delay_s' || d.key === 'monitor.redaction',
  );

  it('keeps the planted secrets out for every choice and many random mixes', () => {
    let seed = 99;
    const rng = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const options = (d: (typeof viewerDefs)[number]): MonitorSettingValue[] =>
      d.kind === 'choice' ? [...d.options] : d.kind === 'boolean' ? [true, false] : [d.default];
    const combos: Partial<Record<MonitorSettingKey, MonitorSettingValue>>[] = [];
    for (const d of viewerDefs) for (const o of options(d)) combos.push({ [d.key]: o });
    for (let i = 0; i < 400; i += 1) {
      const c: Partial<Record<MonitorSettingKey, MonitorSettingValue>> = {};
      for (const d of viewerDefs) {
        const os = options(d);
        c[d.key] = os[Math.floor(rng() * os.length)] as MonitorSettingValue;
      }
      combos.push(c);
    }
    for (const c of combos) {
      const json = JSON.stringify(projectViewerMonitor(planted(), settings(c)));
      expect(json, JSON.stringify(c)).not.toContain(SECRET);
    }
  });

  it('keeps a blocked word and the addresses in the texts out for every mix', () => {
    for (const level of ['standard', 'strict'])
      for (const outputs of ['full', 'excerpt', 'title']) {
        const json = JSON.stringify(
          view({
            'monitor.blocked_words': ['Acme'],
            'monitor.redaction': level,
            'monitor.viewer.stage_outputs': outputs,
            'monitor.viewer.documents': 'preview',
            'monitor.viewer.assistant_activity': 'steps_targets',
            'monitor.viewer.human_gates': 'status',
          }),
        );
        for (const f of ['Acme', 'acme', 'boss@', '10.0.0.5'])
          expect(json, `${f} ${level} ${outputs}`).not.toContain(f);
      }
  });

  it('has only the fields of the view', () => {
    const v = view(
      {
        'monitor.viewer.model_info': 'full',
        'monitor.viewer.tokens': 'split',
        'monitor.viewer.cost': 'detailed',
      },
      planted(),
    );
    expect(Object.keys(v).sort()).toEqual([
      'agents',
      'assistant',
      'delayS',
      'documents',
      'gates',
      'generatedAt',
      'project',
      'stages',
      'usage',
    ]);
    expect(Object.keys(v.stages[0]!).sort()).toEqual([
      'attempts',
      'completedAt',
      'current',
      'error',
      'output',
      'stage',
      'startedAt',
      'status',
    ]);
    expect(Object.keys(v.usage!.models[0]!).sort()).toEqual([
      'input',
      'model',
      'output',
      'provider',
      'tokens',
    ]);
  });
});
