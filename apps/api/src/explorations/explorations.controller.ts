import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { badRequest } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { ExplorationsService } from './explorations.service.js';

const listQuery = z
  .object({
    status: z.enum(['open', 'archived', 'all']).default('open'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

function invalid() {
  return badRequest('EXPLORATION_INVALID_REQUEST', 'Provide a valid exploration request.');
}
function id(raw: string): string {
  if (!isUuid(raw)) throw invalid();
  return raw.toLowerCase();
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw invalid();
  return parsed.data;
}

/**
 * The explorations of ADR-0044 are read only since ADR-0045 step F: a new exploration is a
 * project of kind `exploration`, and the older ones are kept for reading.
 */
@ApiTags('explorations')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId/explorations')
export class ExplorationsController {
  constructor(private readonly explorations: ExplorationsService) {}

  @Get()
  @ApiOperation({ summary: 'List the earlier explorations with the state of their candidates' })
  @RequireWorkspacePermission('exploration.read')
  list(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.explorations.list(workspaceContext(request), parse(listQuery, query));
  }

  @Get(':explorationId')
  @ApiOperation({ summary: 'An earlier exploration with its conversation and candidate problems' })
  @RequireWorkspacePermission('exploration.read')
  get(@Req() request: FastifyRequest, @Param('explorationId') exploration: string) {
    return this.explorations.get(workspaceContext(request), id(exploration));
  }
}
