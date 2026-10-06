import { expect } from 'vitest';

import { AnalysisDriver } from './analysis.js';
import type { Harness } from './harness.js';

export interface StageView {
  id: string;
  stage: string;
  status: string;
  pendingGateOutputId: string | null;
}
export interface Overview {
  stages: StageView[];
}

export interface ToolCallRow {
  id: string;
  tool: string;
  decision: string;
  role: string;
  attempt_id: string;
  agent_definition_version_id: string;
  input_sha256: string;
  output_ref: { type: string; id: string } | null;
  result: Record<string, unknown>;
  error_code: string | null;
}

/**
 * Drives one workspace of the harness through the workflow the way an administrator does: create
 * and activate a project, answer the analyst, approve gates. Shared by the integration tests that
 * need a project at a given stage.
 */
export class StageFlow {
  readonly analysis: AnalysisDriver;
  topicId = '';
  private counter = 0;

  constructor(
    readonly h: Harness,
    readonly cookie: string,
  ) {
    this.analysis = new AnalysisDriver(h, cookie, h.ids.workspaceA);
  }

  api = (suffix: string) => `/v1/workspaces/${this.h.ids.workspaceA}${suffix}`;

  async get<T>(path: string): Promise<T> {
    const response = await this.h.request('GET', this.api(path), { cookie: this.cookie });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<T>();
  }

  async post<T>(path: string, payload: unknown = {}, expected = 201): Promise<T> {
    const response = await this.h.request('POST', this.api(path), {
      cookie: this.cookie,
      payload,
    });
    expect(response.statusCode, response.body).toBe(expected);
    return response.json<T>();
  }

  async setting(key: string, value: unknown) {
    const response = await this.h.request('PUT', this.api('/settings/assignments'), {
      cookie: this.cookie,
      payload: {
        key,
        scopeType: 'workspace',
        scopeId: this.h.ids.workspaceA,
        value,
        reason: `test ${key}`,
      },
    });
    expect(response.statusCode, response.body).toBe(200);
  }

  /** A topic and a deterministic provider connection, the base every flow needs. */
  async prepare() {
    this.topicId = (
      await this.post<{ topic: { id: string } }>('/topics', { code: 'retail', title: 'Retail' })
    ).topic.id;
    const connection = await this.post<{ connection: { id: string } }>('/provider-connections', {
      provider: 'fake',
      name: 'Deterministic',
    });
    await this.setting('ai.connection_id', connection.connection.id);
    await this.setting('ai.model', 'fake-standard');
  }

  /** Approved knowledge in the workspace scope; returns its id. */
  async knowledge(
    title: string,
    content: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const created = await this.post<{ knowledge: { id: string } }>('/knowledge', {
      title,
      sourceType: 'admin_provided',
      provenance: { declaration: 'Approved by the churn committee' },
      scopes: [{ type: 'workspace', id: this.h.ids.workspaceA }],
      content,
      ...extra,
    });
    const id = created.knowledge.id;
    const audited = await this.post<{ review: { decision: string } }>(
      `/knowledge/${id}/submit-audit`,
      {},
      200,
    );
    expect(audited.review.decision).toBe('approved');
    return id;
  }

  async project(prefix: string): Promise<string> {
    this.counter += 1;
    const created = await this.post<{ project: { id: string } }>('/projects', {
      code: `${prefix}-${this.counter}`,
      title: `Project ${prefix}`,
      initialProblem: 'Reduce repeat-customer churn by 20%.',
      topics: [{ topicId: this.topicId }],
    });
    return created.project.id;
  }

  async activate(projectId: string) {
    const current = await this.get<{ project: { version: number } }>(`/projects/${projectId}`);
    await this.post(
      `/projects/${projectId}/activate`,
      { expectedVersion: current.project.version },
      200,
    );
  }

  overview = async (projectId: string) =>
    (await this.get<{ workflow: Overview }>(`/projects/${projectId}/workflow`)).workflow;
  stageOf = (view: Overview, stage: string) => view.stages.find((item) => item.stage === stage)!;
  waiting = (stage: string) => (view: Overview) =>
    this.stageOf(view, stage).status === 'waiting_for_human' &&
    Boolean(this.stageOf(view, stage).pendingGateOutputId);

  async waitFor(projectId: string, predicate: (view: Overview) => boolean, label: string) {
    const deadline = Date.now() + 45_000;
    let last: Overview | null = null;
    while (Date.now() < deadline) {
      last = await this.overview(projectId);
      if (predicate(last)) return last;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(last)}`);
  }

  async decide(
    projectId: string,
    stage: StageView,
    action: 'approve' | 'reject',
    comment?: string,
  ) {
    const response = await this.h.request(
      'POST',
      this.api(
        `/projects/${projectId}/stages/${stage.id}/outputs/${stage.pendingGateOutputId}/${action}`,
      ),
      { cookie: this.cookie, payload: comment ? { comment } : {} },
    );
    expect(response.statusCode, response.body).toBe(200);
  }

  /** Runs a project through the analysis and waits at the gate of `stage` (research or later). */
  async reach(prefix: string, stage: 'research' | 'ideation' = 'research'): Promise<string> {
    const projectId = await this.project(prefix);
    await this.activate(projectId);
    await this.analysis.reachDefinition(projectId);
    let view = await this.waitFor(projectId, this.waiting('analysis'), 'analysis gate');
    await this.decide(projectId, this.stageOf(view, 'analysis'), 'approve');
    view = await this.waitFor(projectId, this.waiting('research'), 'research gate');
    if (stage === 'ideation') {
      await this.decide(projectId, this.stageOf(view, 'research'), 'approve');
      await this.waitFor(projectId, this.waiting('ideation'), 'ideation gate');
    }
    return projectId;
  }

  async stageOutput(projectId: string, stage: string): Promise<Record<string, unknown>> {
    const row = await this.h.admin.query<{ content: Record<string, unknown> }>(
      `select o.content from stage_outputs o join stage_runs s on s.id = o.stage_run_id
        where s.project_id = $1 and s.stage = $2 order by o.created_at desc, o.id desc limit 1`,
      [projectId, stage],
    );
    return row.rows[0]!.content;
  }

  async toolCalls(projectId: string, tool?: string): Promise<ToolCallRow[]> {
    const rows = await this.h.admin.query<ToolCallRow>(
      `select id, tool, decision::text as decision, role::text as role, attempt_id, agent_definition_version_id,
              input_sha256, output_ref, result, error_code
         from agent_tool_calls where project_id = $1 and ($2::text is null or tool = $2) order by created_at, id`,
      [projectId, tool ?? null],
    );
    return rows.rows;
  }

  /** Makes a new active definition of `role` with the given tool allowlist. */
  async allowTools(role: string, tools: string[]): Promise<string> {
    const created = await this.h.request('POST', this.api(`/agent-roles/${role}/definitions`), {
      cookie: this.cookie,
      payload: { changes: { tools }, reason: 'Change the allowed tools' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json<{ definition: { id: string } }>().definition.id;
    const activated = await this.h.request(
      'POST',
      this.api(`/agent-roles/${role}/definitions/${id}/activate`),
      { cookie: this.cookie, payload: { reason: 'Use this version' } },
    );
    expect(activated.statusCode, activated.body).toBe(200);
    return id;
  }
}
