import type { FastifyReply, FastifyRequest } from 'fastify';

import { badRequest, preconditionRequired } from './problems.js';

/** Reads the required `If-Match: "<version>"` header for optimistic concurrency. */
export function requireIfMatch(request: FastifyRequest, codePrefix: string): number {
  const header = request.headers['if-match'];
  if (typeof header !== 'string' || header.length === 0) {
    throw preconditionRequired(
      `${codePrefix}_PRECONDITION_REQUIRED`,
      'Send the current version in the If-Match header.',
    );
  }
  const match = /^(?:W\/)?"?(\d{1,9})"?$/.exec(header.trim());
  if (!match?.[1]) {
    throw badRequest(`${codePrefix}_INVALID_REQUEST`, 'The If-Match header is invalid.');
  }
  return Number(match[1]);
}

export function setVersionHeader(reply: FastifyReply, version: number): void {
  reply.header('ETag', `"${version}"`);
}
