import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { forbidden } from './problems.js';

export interface WorkspaceRequestContext {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly correlationId: string;
}

const uuidSchema = z.uuid();

export function isUuid(value: unknown): value is string {
  return uuidSchema.safeParse(value).success;
}

/** Builds the tenant context set by WorkspacePermissionGuard; never trusts request input. */
export function workspaceContext(request: FastifyRequest): WorkspaceRequestContext {
  const authorization = request.workspaceAuthorization;
  if (!authorization) {
    throw forbidden('AUTH_PERMISSION_DENIED', 'The requested action is not permitted.');
  }
  return {
    workspaceId: authorization.workspace.id,
    actorId: authorization.user.id,
    correlationId: isUuid(request.id) ? request.id : randomUUID(),
  };
}
