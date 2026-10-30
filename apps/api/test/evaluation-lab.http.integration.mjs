import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { createHmac, randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { parseEnvironment } from '@docoo/config';
import {
  evaluationBlindReviewPackSchema,
  evaluationComparisonPageSchema,
  evaluationExperimentPageSchema,
} from '@docoo/contracts';
import { AccountPolicyService } from '../dist/auth/account-policy.service.js';
import { AuthService } from '../dist/auth/auth.service.js';
import { WorkspacePermissionGuard } from '../dist/auth/auth.authorization.js';
import { EvaluationLabController } from '../dist/projects/evaluation-lab.controller.js';
import { EvaluationLabService } from '../dist/projects/evaluation-lab.service.js';
import { TemporalWorkflowEngine, WORKFLOW_ENGINE } from '../dist/workflow/workflow.engine.js';
import { API_CONFIG, DATABASE_POOL } from '../dist/tokens.js';

/** Called only by the isolated PostgreSQL gate, using its real sessions, guard and RLS role. */
export async function verifyEvaluationLabHttp({
  pool,
  admin,
  workspaceId,
  projectId,
  actorId,
  reviewerId,
  viewerId,
  foreignWorkspaceId,
  foreignActorId,
}) {
  const pepper = randomBytes(32).toString('hex');
  const tokens = new Map();
  for (const actor of [actorId, reviewerId, viewerId, foreignActorId]) {
    const token = randomBytes(32).toString('base64url');
    tokens.set(actor, token);
    await admin.query(
      `insert into sessions (user_id,token_digest,idle_expires_at,absolute_expires_at)
      values ($1,$2,now()+interval '30 minutes',now()+interval '1 day')`,
      [actor, createHmac('sha256', pepper).update(token).digest('hex')],
    );
  }
  const config = parseEnvironment({ SESSION_PEPPER: pepper, NODE_ENV: 'test' });
  const module = await Test.createTestingModule({
    controllers: [EvaluationLabController],
    providers: [
      EvaluationLabService,
      WorkspacePermissionGuard,
      AccountPolicyService,
      { provide: DATABASE_POOL, useValue: pool },
      { provide: API_CONFIG, useValue: config },
      { provide: WORKFLOW_ENGINE, useValue: new TemporalWorkflowEngine(config) },
      {
        provide: AuthService,
        useValue: new AuthService(pool, config),
      },
    ],
  }).compile();
  const app = module.createNestApplication(new FastifyAdapter(), { logger: false });
  await app.register(cookie);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const base = `/workspaces/${workspaceId}/projects/${projectId}/evaluation-experiments`;
  const inject = (
    url,
    actor = actorId,
    method = 'GET',
    payload,
    origin = 'http://localhost:3000',
    commandKey = 'http-review-command-01',
  ) =>
    app.inject({
      method,
      url,
      headers: {
        ...(actor ? { cookie: `docoo_session=${tokens.get(actor)}` } : {}),
        origin,
        ...(method === 'POST' && commandKey ? { 'idempotency-key': commandKey } : {}),
      },
      ...(payload ? { payload } : {}),
    });
  try {
    assert.equal((await inject(base, null)).statusCode, 401);
    assert.equal((await inject(base, foreignActorId)).statusCode, 404);
    const beforeDisabledStart = await admin.query(
      'select count(*)::int as count from project_evaluation_experiments where workspace_id=$1 and project_id=$2',
      [workspaceId, projectId],
    );
    const disabledStart = await inject(
      base,
      actorId,
      'POST',
      {
        role: 'analyst',
        repetition: 1,
        timeoutMs: 90_000,
        baseline: {
          definitionVersionId: actorId,
          connectionId: actorId,
          modelId: 'fixture-model-a',
        },
        candidate: {
          definitionVersionId: actorId,
          connectionId: actorId,
          modelId: 'fixture-model-b',
        },
      },
      'http://localhost:3000',
      'http-start-disabled-01',
    );
    assert.equal(disabledStart.statusCode, 403);
    assert.equal(disabledStart.json().code, 'EVALUATION_LAB_DISABLED');
    const afterDisabledStart = await admin.query(
      'select count(*)::int as count from project_evaluation_experiments where workspace_id=$1 and project_id=$2',
      [workspaceId, projectId],
    );
    assert.equal(afterDisabledStart.rows[0].count, beforeDisabledStart.rows[0].count);
    const first = await inject(`${base}?limit=1`);
    assert.equal(first.statusCode, 200);
    assert.equal(first.headers['cache-control'], 'no-store');
    const page = evaluationExperimentPageSchema.parse(first.json());
    assert.equal(page.items.length, 1);
    assert.ok(page.nextCursor);
    const second = await inject(`${base}?limit=1&cursor=${page.nextCursor}`);
    assert.equal(second.statusCode, 200);
    assert.notEqual(
      evaluationExperimentPageSchema.parse(second.json()).items[0].id,
      page.items[0].id,
    );
    const wrongCursor = Buffer.from(
      JSON.stringify({
        version: 1,
        workspaceId: foreignWorkspaceId,
        projectId,
        createdAt: page.items[0].createdAt,
        id: page.items[0].id,
      }),
    ).toString('base64url');
    assert.equal((await inject(`${base}?cursor=${wrongCursor}`)).statusCode, 400);
    const packResponse = await inject(`${base}/persisted-01/review-pack`, reviewerId);
    assert.equal(packResponse.statusCode, 200);
    const pack = evaluationBlindReviewPackSchema.parse(packResponse.json());
    assert.equal(pack.cases.length, 30);
    assert.ok(!packResponse.body.includes('integration-fixture-v1'));
    assert.equal((await inject(`${base}/failed-01/review-pack`)).statusCode, 409);
    const input = {
      experimentHash: pack.experimentHash,
      rubricHash: pack.rubricHash,
      reviewedAt: '2026-10-16T14:00:00.000Z',
      ratings: pack.cases.flatMap((item) =>
        item.variants.map((variant) => ({
          itemId: variant.itemId,
          outputHash: variant.outputHash,
          humanScore: 82,
          humanAccepted: true,
          citationErrors: 0,
        })),
      ),
    };
    assert.equal(
      (
        await inject(
          `${base}/persisted-01/reviews`,
          reviewerId,
          'POST',
          input,
          'https://foreign.example',
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (await inject(`${base}/persisted-01/reviews`, viewerId, 'POST', input)).statusCode,
      403,
    );
    assert.equal(
      (
        await inject(`${base}/persisted-01/reviews`, reviewerId, 'POST', {
          ...input,
          reviewerId: actorId,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await inject(`${base}/persisted-01/reviews`, reviewerId, 'POST', {
          ...input,
          ratings: input.ratings.map((rating) => ({ ...rating, judgeAccepted: true })),
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await inject(`${base}/persisted-01/reviews`, reviewerId, 'POST', {
          ...input,
          ratings: input.ratings.map((rating, index) =>
            index ? rating : { ...rating, outputHash: 'a'.repeat(64) },
          ),
        })
      ).statusCode,
      409,
    );
    const saved = await inject(`${base}/persisted-01/reviews`, reviewerId, 'POST', input);
    assert.equal(saved.statusCode, 200);
    const retry = await inject(`${base}/persisted-01/reviews`, reviewerId, 'POST', {
      ...input,
      ratings: [...input.ratings].reverse(),
    });
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.json().id, saved.json().id);
    assert.equal(
      (
        await inject(
          `${base}/persisted-01/reviews`,
          reviewerId,
          'POST',
          input,
          'http://localhost:3000',
          null,
        )
      ).statusCode,
      400,
    );
    const changed = {
      ...input,
      ratings: input.ratings.map((rating, index) =>
        index ? rating : { ...rating, humanScore: 50 },
      ),
    };
    assert.equal(
      (await inject(`${base}/persisted-01/reviews`, reviewerId, 'POST', changed)).statusCode,
      409,
    );
    const alias = await inject(
      `${base}/persisted-01/reviews`,
      reviewerId,
      'POST',
      input,
      'http://localhost:3000',
      'review-alias-command-02',
    );
    assert.equal(alias.statusCode, 200);
    assert.equal(alias.json().id, saved.json().id);
    assert.equal(
      (
        await inject(
          `${base}/persisted-01/reviews`,
          reviewerId,
          'POST',
          changed,
          'http://localhost:3000',
          'review-alias-command-02',
        )
      ).statusCode,
      409,
    );
    const race = await Promise.all(
      [input, changed].map((payload) =>
        inject(
          `${base}/persisted-01/reviews`,
          reviewerId,
          'POST',
          payload,
          'http://localhost:3000',
          'review-racing-command-03',
        ),
      ),
    );
    assert.deepEqual(race.map((response) => response.statusCode).sort(), [200, 409]);
    const comparisons = await inject(`${base}/persisted-01/comparisons`, viewerId);
    assert.equal(comparisons.statusCode, 200);
    const report = evaluationComparisonPageSchema
      .parse(comparisons.json())
      .items.find((item) => item.id === saved.json().id);
    assert.equal(report.reviewerId, reviewerId);
    assert.equal(report.comparison.metrics.fa.caseCount, 15);
    assert.equal(report.comparison.metrics.en.caseCount, 15);
    assert.equal(report.comparison.metrics.all.cost.candidateMinusBaselineUsd, null);
    assert.equal(report.comparison.metrics.all.judgeHumanAgreement.candidate.agreementRate, null);
    assert.equal(report.comparison.decision, null);
    await admin.query('delete from resource_access where user_id=$1', [reviewerId]);
    assert.equal((await inject(`${base}/persisted-01/review-pack`, reviewerId)).statusCode, 404);
    assert.equal((await inject(`${base}/persisted-01/comparisons`, reviewerId)).statusCode, 404);
    // Restore the fixture grant so the enclosing gate can independently test its own revocation.
    await admin.query(
      `insert into resource_access (workspace_id,user_id,kind,resource_id,access,granted_by)
      values ($1,$2,'project',$3,'EDIT',$4)`,
      [workspaceId, reviewerId, projectId, actorId],
    );
    process.stdout.write(
      'Evaluation lab HTTP gate passed with real cookies, origin checks, permission guard, PostgreSQL/RLS, blinded reviews and cursor binding.\n',
    );
  } finally {
    await app.close();
  }
}
