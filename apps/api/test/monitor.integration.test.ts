import { randomBytes, randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { WorkspaceRequestContext } from '../src/common/request-context.js';
import { WorkspaceDatabase } from '../src/common/workspace-database.js';
import { insertSession, providerOfConnection } from '../src/live-assistant/live-store.js';
import { MonitorService } from '../src/monitor/monitor.service.js';
import { adminUrl } from './support/harness.js';

/**
 * The voice assistant monitor against a real database (ADR-0056 §6): the rows of the owner and
 * nobody else's, what each setting lets through, the masking of the work's texts, and the new
 * provider column of a session. The settings are given directly; reading them is tested elsewhere.
 */
describe.skipIf(!adminUrl)('voice monitor (real database)', () => {
  const SECRET = 'SECRET-SENTINEL-4471';
  const roleName = `docoo_mon_${randomBytes(6).toString('hex')}`;
  const rolePassword = randomBytes(18).toString('hex');
  const ids = {
    workspace: randomUUID(),
    owner: randomUUID(),
    other: randomUUID(),
    third: randomUUID(),
    connection: randomUUID(),
    live: randomUUID(),
    ended: randomUUID(),
    foreign: randomUUID(),
    project: randomUUID(),
  };
  const suffix = randomBytes(4).toString('hex');
  let admin: Client;
  let pool: Pool;
  let values: Record<string, unknown> = {};
  let monitor: MonitorService;

  const context = (actorId = ids.owner): WorkspaceRequestContext => ({
    workspaceId: ids.workspace,
    actorId,
    correlationId: randomUUID(),
  });
  const config = { resolve: () => Promise.resolve({ values }) };
  const view = () => monitor.voiceView(context());

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(
      `create role ${roleName} login inherit nosuperuser nobypassrls nocreatedb nocreaterole password '${rolePassword}'`,
    );
    await admin.query(`grant docoo_app to ${roleName}`);
    const runtime = new URL(adminUrl!);
    runtime.username = roleName;
    runtime.password = rolePassword;
    pool = new Pool({ connectionString: runtime.toString(), max: 3 });
    monitor = new MonitorService(new WorkspaceDatabase(pool), config as never);

    await admin.query(`insert into workspaces (id, code, name) values ($1, $2, 'Monitor test')`, [
      ids.workspace,
      `mon-${suffix}`,
    ]);
    for (const [id, name] of [
      [ids.owner, 'Ali Rezaei'],
      [ids.other, 'Other Admin'],
      [ids.third, 'Third Admin'],
    ] as const) {
      await admin.query(
        `insert into users (id, email, password_hash, display_name) values ($1, $2, 'x', $3)`,
        [id, `${id}@mon-${suffix}.example.test`, name],
      );
      await admin.query(`insert into memberships (workspace_id, user_id) values ($1, $2)`, [
        ids.workspace,
        id,
      ]);
    }
    await admin.query(
      `insert into provider_connections (id, workspace_id, provider, name) values ($1, $2, 'openai', $3)`,
      [ids.connection, ids.workspace, `conn-${suffix}`],
    );
    const caps = JSON.stringify({
      idleSleepS: 120,
      sessionMaxMinutes: 30,
      sessionCostCapUsd: 5,
      dailyCostCapUsd: 20,
      taskCostCapUsd: 1,
      maxActionsPerTask: 8,
      confirmTimeoutS: 300,
    });
    const rules = JSON.stringify([{ scope: { mode: 'all_projects' }, level: 'read' }]);
    const session = (
      id: string,
      user: string,
      status: 'active' | 'ended',
      minutesAgo: number,
      extra: { provider: string; model: string; cost: number },
    ) =>
      admin.query(
        `insert into live_sessions
           (id, workspace_id, user_id, status, end_reason, ended_at, mode, model, provider, access_rules, caps,
            input_tokens, output_tokens, cost_usd, executor_input_tokens, executor_output_tokens,
            executor_cost_usd, executor_calls, started_at, last_activity_at)
         values ($1, $2, $3, $4, $5, $6, 'realtime', $7, $8, $9::jsonb, $10::jsonb,
                 1000, 500, $11, 200, 100, 0.1, 3,
                 now() - make_interval(mins => $12), now())`,
        [
          id,
          ids.workspace,
          user,
          status,
          status === 'ended' ? 'user' : null,
          status === 'ended' ? new Date().toISOString() : null,
          extra.model,
          extra.provider,
          rules,
          caps,
          extra.cost,
          minutesAgo,
        ],
      );
    await session(ids.live, ids.owner, 'active', 10, {
      provider: 'openai',
      model: 'gpt-realtime',
      cost: 0.5,
    });
    await session(ids.ended, ids.owner, 'ended', 180, {
      provider: 'gemini',
      model: 'old-model',
      cost: 1,
    });
    await session(ids.foreign, ids.other, 'active', 5, {
      provider: 'anthropic',
      model: SECRET,
      cost: 7,
    });

    const line = (
      session_: string,
      user: string,
      seq: number,
      role: string,
      text: string,
      secondsAgo: number,
    ) =>
      admin.query(
        `insert into live_messages (workspace_id, session_id, user_id, seq, role, content, created_at)
         values ($1, $2, $3, $4, $5, $6, now() - make_interval(secs => $7))`,
        [ids.workspace, session_, user, seq, role, text, secondsAgo],
      );
    await line(ids.live, ids.owner, 1, 'user', 'Open the Acme project', 60);
    await line(ids.live, ids.owner, 2, 'assistant', 'Opening it. Mail ali@example.com', 55);
    await line(ids.live, ids.owner, 3, 'user', 'Fresh line now', 0);
    await line(ids.foreign, ids.other, 1, 'user', `${SECRET} private talk`, 30);

    const card = (
      session_: string,
      user: string,
      status: string,
      summary: string,
      secondsAgo: number,
    ) =>
      admin.query(
        `insert into live_actions
           (workspace_id, session_id, user_id, capability, tier, steps, params, summary, target_name,
            status, refusal_reason, proposed_at, expires_at, project_id)
         values ($1, $2, $3, 'project.open', 'T0', $4, $5::jsonb, $6, 'Acme', $7, $8,
                 now() - make_interval(secs => $9), now() + interval '1 hour', $10)`,
        [
          ids.workspace,
          session_,
          user,
          ['read the project', 'open the page'],
          JSON.stringify({ token: SECRET, password: SECRET }),
          summary,
          status,
          status === 'refused' ? 'not_allowed' : null,
          secondsAgo,
          ids.project,
        ],
      );
    await card(ids.live, ids.owner, 'proposed', 'Open the project Acme', 50);
    await card(ids.live, ids.owner, 'refused', 'Delete the project Acme', 40);
    await card(ids.foreign, ids.other, 'proposed', `${SECRET} card`, 30);

    // ---- a project on the projector, with everything the viewer monitor reads
    await admin.query(
      `insert into projects (id, workspace_id, code, title, initial_problem, status, current_stage)
       values ($1, $2, $3, 'Acme market study', 'Problem', 'active', 'research')`,
      [ids.project, ids.workspace, `ACME-${suffix}`],
    );
    const run = (
      await admin.query<{ id: string }>(
        `insert into workflow_runs (workspace_id, project_id, run_no, temporal_workflow_id)
         values ($1, $2, 1, $3) returning id`,
        [ids.workspace, ids.project, `wf-${suffix}`],
      )
    ).rows[0]!.id;
    const stage = async (kind: string, seq: number, status: string, attempts: number) =>
      (
        await admin.query<{ id: string }>(
          `insert into stage_runs (workspace_id, run_id, project_id, stage, sequence, status, attempts_used, started_at)
           values ($1, $2, $3, $4, $5, $6, $7, now() - interval '10 minutes') returning id`,
          [ids.workspace, run, ids.project, kind, seq, status, attempts],
        )
      ).rows[0]!.id;
    const analysis = await stage('analysis', 1, 'completed', 2);
    await stage('research', 2, 'running', 1);
    const ideation = await stage('ideation', 3, 'failed', 3);
    const output = (
      await admin.query<{ id: string }>(
        `insert into stage_outputs (workspace_id, stage_run_id, version_no, content, content_sha256, origin, created_at)
         values ($1, $2, 1, $3::jsonb, 'x', 'model', now() - interval '5 minutes') returning id`,
        [
          ids.workspace,
          analysis,
          JSON.stringify({
            problemStatement: 'Acme needs a market study',
            goals: ['grow', 'mail boss@acme.example'],
            secretField: SECRET.toLowerCase().includes('x') ? 'ok' : 'ok',
          }),
        ],
      )
    ).rows[0]!.id;
    await admin.query(`update stage_runs set latest_output_id = $1 where id = $2`, [
      output,
      analysis,
    ]);
    await admin.query(
      `insert into stage_attempts (workspace_id, stage_run_id, attempt_no, idempotency_key, status, error_code)
       values ($1, $2, 3, $3, 'permanent_failed', 'provider_error')`,
      [ids.workspace, ideation, `att-${suffix}`],
    );
    await admin.query(
      `insert into human_tasks (workspace_id, project_id, stage_run_id, kind, title, payload)
       values ($1, $2, $3, 'gate', 'Approve the problem for Acme', '{}'::jsonb)`,
      [ids.workspace, ids.project, analysis],
    );
    await admin.query(
      `insert into agent_tool_calls (workspace_id, project_id, role, tool, decision, input_sha256)
       values ($1, $2, 'analyst', 'web_search', 'allowed', repeat('a', 64))`,
      [ids.workspace, ids.project],
    );
    await admin.query(
      `insert into model_invocations (workspace_id, project_id, provider, model, purpose, status, input_tokens, output_tokens, cost_usd)
       values ($1, $2, 'openai', 'gpt-x', 'test', 'succeeded', 1000, 500, 0.5)`,
      [ids.workspace, ids.project],
    );
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`drop owned by ${roleName}`).catch(() => undefined);
      await admin.query(`drop role ${roleName}`).catch(() => undefined);
      await admin.end();
    }
  });

  it('answers nothing while the monitor is switched off', async () => {
    values = {};
    const error = await view().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(409);
  });

  it('shows the room profile: the owner own live session, no model, tokens, cost or text', async () => {
    values = { 'monitor.voice.enabled': true };
    const result = await view();
    expect(result.live).toBe(true);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({ id: ids.live, current: true, live: true });
    expect(result.model).toBeNull();
    expect(result.tokens).toBeNull();
    expect(result.cost).toBeNull();
    expect(result.current?.lines).toBeNull();
    // The room delay (3 seconds) keeps nothing back here: both cards are older than that.
    expect(result.current?.cards?.map((card) => card.summary)).toEqual([
      'Open the project Acme',
      'Delete the project Acme',
    ]);
    expect(result.current?.cards?.every((card) => card.detail === null)).toBe(true);
    expect(result.sessions[0]?.person).toEqual({ role: 'owner', name: null });
  });

  it('never shows another administrator session, text, cost or card', async () => {
    values = {
      'monitor.voice.enabled': true,
      'monitor.voice.sessions': 'all',
      'monitor.voice.transcript': 'full',
      'monitor.voice.cost': 'with_caps',
      'monitor.voice.model_info': 'all',
      'monitor.voice.people': 'full_name',
      'monitor.delay_s': 0,
    };
    const result = await view();
    const json = JSON.stringify(result);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain(ids.foreign);
    expect(result.sessions.map((session) => session.id).sort()).toEqual(
      [ids.live, ids.ended].sort(),
    );
    // 0.5 + 0.1 for the live one and 1 + 0.1 for the ended one; the other administrator's 7 is not in.
    expect(result.cost?.day).toBeCloseTo(1.7, 5);
    expect(result.cost?.month).toBeCloseTo(1.7, 5);
  });

  it('shows what the open settings allow, from the real rows', async () => {
    values = {
      'monitor.voice.enabled': true,
      'monitor.voice.transcript': 'full',
      'monitor.voice.action_cards': 'detail',
      'monitor.voice.model_info': 'all',
      'monitor.voice.tokens': 'split_executor',
      'monitor.voice.cost': 'with_caps',
      'monitor.voice.caps': 'amounts',
      'monitor.voice.access_info': 'scope_level',
      'monitor.voice.people': 'full_name',
      'live_assistant.voice_id': 'alloy',
      'live_assistant.language': 'fa',
      'monitor.delay_s': 0,
    };
    const result = await view();
    expect(result.model).toEqual({
      provider: 'openai',
      model: 'gpt-realtime',
      mode: 'realtime',
      language: 'fa',
      voice: 'alloy',
    });
    expect(result.tokens).toEqual({
      total: 1800,
      input: 1200,
      output: 600,
      executor: { input: 200, output: 100, calls: 3 },
    });
    expect(result.cost).toMatchObject({ session: 0.6, unpriced: false, estimateLabel: true });
    expect(result.cost?.caps).toMatchObject({ sessionCapUsd: 5, dailyCapUsd: 20 });
    expect(result.access).toEqual({ scope: 'all_projects', level: 'read' });
    expect(result.sessions[0]?.person).toEqual({ role: 'owner', name: 'Ali Rezaei' });
    expect(result.current?.lines?.map((line) => line.role)).toEqual(['user', 'assistant', 'user']);
    expect(result.current?.cards?.[0]?.detail).toMatchObject({
      targetName: 'Acme',
      steps: ['read the project', 'open the page'],
      tier: 'T0',
    });
    // The parameters and the project of a card, and the connection, are not in the answer.
    const json = JSON.stringify(result);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain('params');
    expect(json).not.toContain('projectId');
  });

  it('masks the texts of the work and the blocked words, and keeps back what is newer than the delay', async () => {
    values = {
      'monitor.voice.enabled': true,
      'monitor.voice.transcript': 'full',
      'monitor.voice.action_cards': 'detail',
      'monitor.blocked_words': ['Acme'],
      'monitor.delay_s': 10,
    };
    const result = await view();
    const texts = result.current?.lines?.map((line) => line.text) ?? [];
    expect(texts).toEqual([`Open the ●●● project`, 'Opening it. Mail ●●●']);
    const json = JSON.stringify(result);
    expect(json).not.toContain('Acme');
    expect(json).not.toContain('ali@example.com');
    expect(json).not.toContain('Fresh line now');
  });

  it('shows no conversation and no cards when the settings hide them, and reads none', async () => {
    values = {
      'monitor.voice.enabled': true,
      'monitor.voice.transcript': 'hidden',
      'monitor.voice.action_cards': 'hidden',
    };
    const result = await view();
    expect(result.current).toMatchObject({ id: ids.live, lines: null, cards: null });
  });

  it('is empty, and says nothing is live, for an administrator who never talked', async () => {
    // The third administrator has no session at all: the view is empty and says nothing is live.
    values = { 'monitor.voice.enabled': true, 'monitor.voice.sessions': 'all' };
    const result = await monitor.voiceView(context(ids.third));
    expect(result.live).toBe(false);
    expect(result.sessions).toEqual([]);
    expect(result.current).toBeNull();
    expect(result.indicator).toBe('off');
  });

  it('records the provider of a connection when a session starts, and nothing for an unknown one', async () => {
    await new WorkspaceDatabase(pool).run(context(ids.third), async (client) => {
      expect(await providerOfConnection(client, ids.connection)).toBe('openai');
      expect(await providerOfConnection(client, randomUUID())).toBe('');
      expect(await providerOfConnection(client, 'not-an-id')).toBe('');
      expect(await providerOfConnection(client, '')).toBe('');
      const created = await insertSession(client, {
        workspaceId: ids.workspace,
        userId: ids.third,
        mode: 'realtime',
        model: 'gpt-realtime',
        provider: await providerOfConnection(client, ids.connection),
        caps: {
          idleSleepS: 120,
          sessionMaxMinutes: 30,
          sessionCostCapUsd: 5,
          dailyCostCapUsd: 20,
          taskCostCapUsd: 1,
          maxActionsPerTask: 8,
          confirmTimeoutS: 300,
        },
        rules: [{ scope: { mode: 'all_projects' }, level: 'read' }],
      });
      const row = await client.query<{ provider: string }>(
        'select provider from live_sessions where id = $1',
        [created],
      );
      expect(row.rows[0]?.provider).toBe('openai');
    });
  });

  it('refuses to change the provider of a session afterwards: it is part of what it started with', async () => {
    await expect(
      admin.query(`update live_sessions set provider = 'gemini' where id = $1`, [ids.live]),
    ).rejects.toThrow(/cannot change/u);
  });

  describe('the viewer monitor', () => {
    const viewer = () => monitor.viewerView(context());

    it('answers nothing while the viewer monitor is switched off', async () => {
      values = {};
      const error = await viewer().catch((caught: unknown) => caught);
      expect((error as HttpException).getStatus()).toBe(409);
    });

    it('waits, with no project, until the owner puts one on the projector', async () => {
      values = { 'monitor.viewer.enabled': true };
      const result = await viewer();
      expect(result.project).toBeNull();
      expect(result.stages).toEqual([]);
    });

    it('shows the steps of the project in full, masked, and nothing of cost or model by default', async () => {
      values = {
        'monitor.viewer.enabled': true,
        'monitor.viewer.project_id': ids.project,
        'monitor.blocked_words': ['Acme'],
        'monitor.delay_s': 0,
      };
      const result = await viewer();
      expect(result.project).toMatchObject({ name: '●●● market study', currentStage: 'research' });
      expect(result.stages.map((item) => [item.stage, item.status])).toEqual([
        ['analysis', 'completed'],
        ['research', 'running'],
        ['ideation', 'failed'],
      ]);
      expect(result.stages[0]?.output?.text).toContain(
        'problemStatement: ●●● needs a market study',
      );
      expect(result.stages[2]?.error).toEqual({ message: 'provider_error' });
      expect(result.gates?.[0]).toEqual({
        title: 'Approve the problem for ●●●',
        status: 'pending',
      });
      expect(result.agents?.[0]).toMatchObject({
        role: 'analyst',
        calls: 1,
        last: { tool: 'web_search' },
      });
      expect(result.assistant?.steps?.length).toBe(2);
      expect(result.usage).toBeNull();
      const json = JSON.stringify(result);
      for (const forbidden of ['Acme', 'boss@', SECRET, ids.project, 'params']) {
        expect(json).not.toContain(forbidden);
      }
    });

    it('shows model, tokens and cost of the project when the settings allow', async () => {
      values = {
        'monitor.viewer.enabled': true,
        'monitor.viewer.project_id': ids.project,
        'monitor.viewer.model_info': 'full',
        'monitor.viewer.tokens': 'split',
        'monitor.viewer.cost': 'total',
        'monitor.delay_s': 0,
      };
      const result = await viewer();
      expect(result.usage).toMatchObject({ tokensTotal: 1500, costUsd: 0.5 });
      expect(result.usage?.models[0]).toMatchObject({
        provider: 'openai',
        model: 'gpt-x',
        input: 1000,
        output: 500,
      });
    });

    it('shows nothing of a project that does not exist', async () => {
      values = {
        'monitor.viewer.enabled': true,
        'monitor.viewer.project_id': randomUUID(),
      };
      expect((await viewer()).project).toBeNull();
    });
  });
});
