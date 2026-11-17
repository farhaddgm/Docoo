import { describe, expect, it } from 'vitest';
import {
  assessDecision,
  assessPortfolio,
  decisionQuality,
  learnThresholds,
  percentile,
  type DecisionFacts,
} from './decision-portfolio';

const now = new Date('2026-11-17T00:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const stages = (done: string[], running: string[] = []) =>
  ['analysis', 'research', 'ideation', 'documentation', 'evaluation'].map((stage) => ({
    stage,
    status: done.includes(stage) ? 'completed' : running.includes(stage) ? 'running' : 'pending',
  }));
const base = (over: Partial<DecisionFacts> = {}): DecisionFacts => ({
  project: { id: 'p', code: 'PRJ-1', title: 'T', status: 'active', updatedAt: daysAgo(1) },
  workflow: {
    run: { status: 'running', currentStage: 'research' },
    stages: stages(['analysis']),
    humanTasks: [],
  },
  solutionCount: 0,
  decided: false,
  lastDecisionAt: null,
  stability: null,
  ...over,
});
const thresholds = { warnDays: 7, staleDays: 21, source: 'default' as const };

describe('percentile and learned thresholds', () => {
  it('uses the nearest rank', () => {
    expect(percentile([], 85)).toBeNull();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 85)).toBe(9);
    expect(percentile([5], 50)).toBe(5);
  });
  it('keeps the defaults until enough waits exist, then learns from them', () => {
    expect(learnThresholds([1, 2, 3, 4])).toEqual({
      warnDays: 7,
      staleDays: 21,
      source: 'default',
    });
    expect(learnThresholds([2, 3, 4, 5, 6, 8, 9, 10, 11, 12])).toEqual({
      warnDays: 11,
      staleDays: 22,
      source: 'history',
    });
    expect(learnThresholds([0, 0, 0, 1, 1]).warnDays).toBe(3);
  });
});

describe('decision quality', () => {
  it('scores the six elements from facts and names the weakest', () => {
    const quality = decisionQuality(
      base({
        workflow: {
          run: { status: 'running', currentStage: 'documentation' },
          stages: stages(['analysis', 'research', 'ideation']),
          humanTasks: [],
        },
        solutionCount: 3,
        stability: 'fragile',
      }),
    );
    expect(quality.axes).toEqual({
      frame: 2,
      alternatives: 2,
      information: 2,
      values: 1,
      reasoning: 0,
      commitment: 1,
    });
    expect(quality.score).toBe(Math.round((8 / 12) * 100));
    expect(quality.weakest).toBe('reasoning');
  });
  it('a completed project is complete on every axis it can know', () => {
    const quality = decisionQuality(
      base({
        project: { ...base().project, status: 'completed' },
        solutionCount: 4,
        decided: true,
        stability: 'stable',
      }),
    );
    expect(quality.score).toBe(100);
    expect(quality.weakest).toBeNull();
  });
});

describe('attention', () => {
  it('a blocked project is urgent whatever its age', () => {
    const row = assessDecision(
      base({
        workflow: {
          run: { status: 'failed', currentStage: 'research' },
          stages: stages([]),
          humanTasks: [],
        },
      }),
      thresholds,
      now,
    );
    expect(row.attention).toBe('urgent');
    expect(row.reasons).toContain('blocked');
  });
  it('waiting for a person turns from ok to soon to urgent as it ages', () => {
    const waiting = (age: number) =>
      assessDecision(
        base({
          project: { ...base().project, updatedAt: daysAgo(age) },
          workflow: {
            run: { status: 'waiting_for_human', currentStage: 'analysis' },
            stages: stages([]),
            humanTasks: [{ kind: 'gate_review' }],
          },
        }),
        thresholds,
        now,
      );
    expect(waiting(2).attention).toBe('ok');
    expect(waiting(9).attention).toBe('soon');
    expect(waiting(30).attention).toBe('urgent');
  });
  it('solutions that nobody chose between are flagged once they age', () => {
    const row = assessDecision(
      base({
        project: { ...base().project, updatedAt: daysAgo(10) },
        solutionCount: 3,
        stability: 'stable',
      }),
      thresholds,
      now,
    );
    expect(row.attention).toBe('soon');
    expect(row.reasons).toContain('undecided_long');
  });
  it('a recent decision resets the age and a completed project is done', () => {
    const recent = assessDecision(
      base({
        project: { ...base().project, updatedAt: daysAgo(40) },
        lastDecisionAt: daysAgo(1),
        decided: true,
        solutionCount: 3,
      }),
      thresholds,
      now,
    );
    expect(recent.ageDays).toBe(1);
    const done = assessDecision(
      base({ project: { ...base().project, status: 'completed' } }),
      thresholds,
      now,
    );
    expect(done.attention).toBe('done');
  });
  it('orders the portfolio by what needs attention first, oldest first', () => {
    const waiting = (id: string, age: number) =>
      base({
        project: { id, code: id, title: id, status: 'active', updatedAt: daysAgo(age) },
        workflow: {
          run: { status: 'waiting_for_human', currentStage: 'analysis' },
          stages: stages([]),
          humanTasks: [{ kind: 'gate_review' }],
        },
      });
    const { rows } = assessPortfolio(
      [
        waiting('a', 2),
        waiting('b', 30),
        waiting('c', 9),
        base({ project: { ...base().project, id: 'd', code: 'd', status: 'completed' } }),
      ],
      now,
    );
    expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a', 'd']);
  });
});
