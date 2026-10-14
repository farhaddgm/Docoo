import { randomUUID } from 'node:crypto';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';
import {
  activeTraceCorrelation,
  withCorrelation,
  type CorrelationInput,
} from '@docoo/observability';

import { isUuid } from './request-context.js';

export function requestCorrelation(request: FastifyRequest): CorrelationInput {
  const authorization = request.workspaceAuthorization;
  const params = request.params as Record<string, unknown> | undefined;
  return {
    tenantId: authorization?.workspace.id ?? null,
    projectId:
      authorization && isUuid(params?.['projectId']) ? params['projectId'].toLowerCase() : null,
    stageRunId:
      authorization && isUuid(params?.['stageRunId']) ? params['stageRunId'].toLowerCase() : null,
    requestId: isUuid(request.id) ? request.id : randomUUID(),
    ...activeTraceCorrelation(),
  };
}

/** Guards establish authorization before the controller's observable is subscribed. */
export class RequestCorrelationInterceptor implements NestInterceptor {
  intercept(execution: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ids = requestCorrelation(execution.switchToHttp().getRequest<FastifyRequest>());
    return new Observable((subscriber) =>
      withCorrelation(ids, () => next.handle().subscribe(subscriber)),
    );
  }
}
