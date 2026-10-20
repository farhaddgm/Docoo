import { describe, expect, it } from 'vitest';

import {
  analyse,
  isExecutableAction,
  narrativeFacts,
  type AnalysisInput,
} from '../src/reports/brain-analysis.js';

const NOW = '2026-10-18T12:00:00.000Z';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const empty: AnalysisInput = {
  now: NOW,
  projectId: null,
  knowledge: { weak: [], unaudited: [], stale: [], conflicts: [] },
  stages: [],
  decisions: { passedStages: [], exceptions: [], overrides: [] },
  costs: { projects: [], unpriced: [] },
  failures: { invocations: [], exhaustedStages: [] },
};
const window = (reviewed: number, rejected: number, attempts = 0, incomplete = 0) => ({
  reviewed,
  rejected,
  attempts,
  incomplete,
});

describe('Brain analysis rules (ADR-0032)', () => {
  it('finds nothing in an empty workspace', () => {
    expect(analyse(empty)).toEqual([]);
  });

  it('ranks by score and is deterministic', () => {
    const input: AnalysisInput = {
      ...empty,
      knowledge: {
        ...empty.knowledge,
        weak: [{ id: id(1), itemId: id(1), overall: 40, at: NOW }],
        stale: [{ id: id(2), itemId: id(2), reason: 'expiring', at: NOW }],
        conflicts: [{ id: id(3), itemId: id(3), severity: 'high', at: NOW }],
      },
    };
    const first = analyse(input);
    expect(first.map((finding) => finding.kind)).toEqual([
      'knowledge_contradiction',
      'knowledge_weak',
      'knowledge_stale',
    ]);
    expect(first.map((finding) => finding.score)).toEqual(
      [...first.map((f) => f.score)].sort((a, b) => b - a),
    );
    expect(analyse(input)).toEqual(first);
    expect(first[1]!.severity).toBe('high');
    expect(first[1]!.evidence).toEqual([{ type: 'knowledge', id: id(1) }]);
    expect(first[0]!.actions.map((action) => action.kind)).toEqual([
      'open_conflicts',
      'open_knowledge',
    ]);
  });

  it('proposes an audit only for unaudited knowledge, and never changes anything itself', () => {
    const [finding] = analyse({
      ...empty,
      knowledge: {
        ...empty.knowledge,
        unaudited: [
          { id: id(1), itemId: id(1), ageDays: 20 },
          { id: id(2), itemId: id(2), ageDays: 5 },
        ],
      },
    });
    expect(finding!.kind).toBe('knowledge_unaudited');
    expect(finding!.severity).toBe('high');
    const executable = finding!.actions.filter((action) => isExecutableAction(action.kind));
    expect(executable.map((action) => action.target?.id)).toEqual([id(1), id(2)]);
    expect(new Set(finding!.actions.map((action) => action.key)).size).toBe(
      finding!.actions.length,
    );
  });

  it('flags quality drift only when a stage got clearly worse with enough data', () => {
    const stage = (recent: ReturnType<typeof window>, previous: ReturnType<typeof window>) => ({
      stage: 'research',
      role: 'researcher',
      recent,
      previous,
      recentRejections: [{ id: id(10) }],
      recentIncomplete: [],
      waiting: [{ projectId: id(20), stageRunId: id(21), outputId: id(22) }],
    });
    expect(analyse({ ...empty, stages: [stage(window(5, 2), window(5, 2))] })).toEqual([]);
    expect(analyse({ ...empty, stages: [stage(window(2, 2), window(5, 0))] })).toEqual([]);
    const [drift] = analyse({ ...empty, stages: [stage(window(5, 4), window(5, 1))] });
    expect(drift).toMatchObject({
      kind: 'quality_drift',
      severity: 'high',
      key: 'quality_drift:research',
      params: { stage: 'research', metric: 'rejection', recentPercent: 80, previousPercent: 20 },
    });
    expect(drift!.actions.map((action) => action.kind)).toEqual(['open_agent', 'request_revision']);
    expect(drift!.actions[1]!.params).toMatchObject({ outputId: id(22), stageRunId: id(21) });
  });

  it('reports risky decisions as separate findings with their own evidence', () => {
    const findings = analyse({
      ...empty,
      decisions: {
        passedStages: [{ id: id(1), projectId: id(9) }],
        exceptions: [{ id: id(2), projectId: id(9) }],
        overrides: [{ id: id(3), itemId: id(4) }],
      },
    });
    expect(findings.map((finding) => finding.key).sort()).toEqual([
      'risky_decision:exception',
      'risky_decision:override',
      'risky_decision:passed_stage',
    ]);
  });

  it('detects a cost spike, offers a pause only for an active project, and ignores small amounts', () => {
    const project = (status: string, recentUsd: number, previousUsd: number) => ({
      projectId: id(7),
      status,
      version: 4,
      recentUsd,
      previousUsd,
    });
    expect(
      analyse({ ...empty, costs: { projects: [project('active', 0.5, 0)], unpriced: [] } }),
    ).toEqual([]);
    expect(
      analyse({ ...empty, costs: { projects: [project('active', 3, 2)], unpriced: [] } }),
    ).toEqual([]);
    const [spike] = analyse({
      ...empty,
      costs: { projects: [project('active', 9, 2)], unpriced: [] },
    });
    expect(spike).toMatchObject({ kind: 'cost_anomaly', severity: 'high', projectId: id(7) });
    const pause = spike!.actions.find((action) => action.kind === 'pause_project');
    expect(pause?.params).toEqual({ projectId: id(7), expectedVersion: 4 });
    const [paused] = analyse({
      ...empty,
      costs: { projects: [project('paused', 9, 2)], unpriced: [] },
    });
    expect(paused!.actions.some((action) => action.kind === 'pause_project')).toBe(false);
  });

  it('groups recurring failures and needs a minimum count', () => {
    const failure = (n: number) => ({ id: id(n), provider: 'openai', errorCode: 'rate_limited' });
    expect(
      analyse({
        ...empty,
        failures: { invocations: [failure(1), failure(2)], exhaustedStages: [] },
      }),
    ).toEqual([]);
    const [finding] = analyse({
      ...empty,
      failures: { invocations: [failure(1), failure(2), failure(3)], exhaustedStages: [] },
    });
    expect(finding).toMatchObject({
      kind: 'recurring_failure',
      key: 'recurring_failure:provider:openai:rate_limited',
      count: 3,
    });
  });

  it('caps evidence per finding and gives the model nothing but kinds and counts', () => {
    const many = Array.from({ length: 50 }, (_, n) => ({
      id: id(n + 1),
      itemId: id(n + 1),
      overall: 50,
    }));
    const findings = analyse({ ...empty, knowledge: { ...empty.knowledge, weak: many } });
    expect(findings[0]!.count).toBe(50);
    expect(findings[0]!.evidence).toHaveLength(20);
    const facts = JSON.stringify(narrativeFacts(findings));
    expect(facts).not.toContain(id(1));
    expect(JSON.parse(facts)).toEqual([
      { kind: 'knowledge_weak', variant: null, severity: 'high', count: 50 },
    ]);
  });
});
