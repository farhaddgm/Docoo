import { Controller, ForbiddenException, Get, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { RequireWorkspacePermission } from '../auth/auth.authorization.js';

@ApiTags('workspaces')
@Controller('workspaces')
export class WorkspaceController {
  @Get(':workspaceId')
  @ApiCookieAuth('docoo_session')
  @ApiOperation({ summary: 'Read an authorized workspace' })
  @RequireWorkspacePermission('workspace.read')
  getWorkspace(@Req() request: FastifyRequest) {
    const authorization = request.workspaceAuthorization;
    if (!authorization) {
      throw new ForbiddenException({
        status: 403,
        title: 'Forbidden',
        code: 'AUTH_PERMISSION_DENIED',
        detail: 'The requested action is not permitted.',
      });
    }

    return { workspace: authorization.workspace };
  }
}
