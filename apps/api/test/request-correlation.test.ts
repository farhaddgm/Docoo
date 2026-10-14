import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { defer, lastValueFrom } from 'rxjs';
import { currentCorrelation } from '@docoo/observability';
import { expect, it } from 'vitest';

import {
  requestCorrelation,
  RequestCorrelationInterceptor,
} from '../src/common/request-correlation.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const project = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';

it('uses the authorized workspace and keeps correlation through the deferred controller subscription', async () => {
  const request = {
    id: requestId,
    params: { workspaceId: project, projectId: project },
    workspaceAuthorization: { workspace: { id: tenant } },
  } as unknown as FastifyRequest;
  const execution = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const next: CallHandler = {
    handle: () =>
      defer(async () => {
        await Promise.resolve();
        return currentCorrelation();
      }),
  };
  const result = await lastValueFrom(
    new RequestCorrelationInterceptor().intercept(execution, next),
  );
  expect(result).toMatchObject({ tenantId: tenant, projectId: project, requestId });
  expect(currentCorrelation().tenantId).toBeNull();
});

it('does not trust route tenant/project parameters before authorization or a content-bearing request ID', () => {
  const canary = 'PRIVATE_PROMPT_AND_SECRET_CANARY';
  const request = {
    id: canary,
    params: { workspaceId: tenant, projectId: project },
  } as unknown as FastifyRequest;
  const ids = requestCorrelation(request);
  expect(ids.tenantId).toBeNull();
  expect(ids.projectId).toBeNull();
  expect(ids.requestId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(JSON.stringify(ids)).not.toContain(canary);
});
