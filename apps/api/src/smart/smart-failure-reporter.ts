import { randomUUID } from 'node:crypto';

import { HttpException, Injectable, Logger } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { isUuid, type WorkspaceRequestContext } from '../common/request-context.js';
import { SmartErrorsService, type RecordErrorInput } from './smart-errors.service.js';

const WINDOW_MS = 10_000;
const WINDOW_LIMIT = 20;

interface FailureShape {
  readonly status: number;
  readonly message: string;
  readonly stack: string | null;
  readonly name: string;
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Turns anything thrown into a status and a short human message. */
export function describeFailure(exception: unknown): FailureShape {
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    const body = typeof response === 'object' ? (response as Record<string, unknown>) : {};
    const parts = [
      textOf(body['code']),
      textOf(body['detail']) ?? textOf(body['message']) ?? textOf(body['title']),
    ].filter((part): part is string => part !== null);
    return {
      status: exception.getStatus(),
      message: parts.length ? parts.join(': ') : exception.message,
      stack: exception.stack ?? null,
      name: exception.constructor.name,
    };
  }
  if (exception instanceof Error) {
    const record = exception as Error & { code?: unknown; statusCode?: unknown };
    const status =
      typeof record.statusCode === 'number' && record.statusCode >= 400 ? record.statusCode : 500;
    const code = typeof record.code === 'string' && record.code ? `[${record.code}] ` : '';
    return {
      status,
      message: `${code}${exception.message}`,
      stack: exception.stack ?? null,
      name: exception.constructor.name,
    };
  }
  return { status: 500, message: 'Unknown error', stack: null, name: 'Unknown' };
}

/**
 * Records server failures (5xx) of authorised workspace requests (SMT-001). It never throws and
 * never delays a response: a burst is dropped once the per-process window is full, so an outage
 * cannot turn the tracker into a second source of load.
 */
@Injectable()
export class SmartFailureReporter {
  private readonly logger = new Logger(SmartFailureReporter.name);
  private windowStart = 0;
  private windowCount = 0;

  constructor(private readonly errors: SmartErrorsService) {}

  report(exception: unknown, request: FastifyRequest | undefined): void {
    try {
      const failure = describeFailure(exception);
      const authorization = request?.workspaceAuthorization;
      if (!request || !authorization || failure.status < 500 || !this.admit()) return;
      const context: WorkspaceRequestContext = {
        workspaceId: authorization.workspace.id,
        actorId: authorization.user.id,
        correlationId: isUuid(request.id) ? request.id : randomUUID(),
      };
      const input: RecordErrorInput = {
        source: 'server',
        message: failure.message,
        status: failure.status,
        method: request.method,
        route: request.routeOptions?.url ?? null,
        correlationId: context.correlationId,
        stack: failure.stack,
        // Query keys only: values and bodies may carry confidential project content.
        context: { exception: failure.name, queryKeys: Object.keys(request.query ?? {}) },
      };
      this.errors.record(context, input).catch((error: unknown) => {
        this.logger.warn(
          `Could not record error: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      });
    } catch (error) {
      this.logger.warn(
        `Could not record error: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  private admit(): boolean {
    const now = Date.now();
    if (now - this.windowStart > WINDOW_MS) {
      this.windowStart = now;
      this.windowCount = 0;
    }
    this.windowCount += 1;
    return this.windowCount <= WINDOW_LIMIT;
  }
}
