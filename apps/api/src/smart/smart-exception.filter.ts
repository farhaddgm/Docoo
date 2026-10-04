import { Catch, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { SmartFailureReporter } from './smart-failure-reporter.js';

/**
 * Global filter that keeps Nest's default response untouched (it extends the built-in filter)
 * and, after replying, hands server failures to the Smart error tracker.
 */
@Catch()
export class SmartExceptionFilter extends BaseExceptionFilter {
  constructor(private readonly reporter: SmartFailureReporter) {
    super();
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    super.catch(exception, host);
    if (host.getType() === 'http') {
      this.reporter.report(exception, host.switchToHttp().getRequest<FastifyRequest>());
    }
  }
}
