import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission, UsesAi } from '../auth/auth.authorization.js';
import { IntakeService } from './intake.service.js';

const bodySchema = z
  .object({
    transcript: z.string().trim().min(40).max(20_000),
    locale: z.enum(['fa', 'en']).default('fa'),
  })
  .strict();

@Controller('workspaces/:workspaceId/project-intake')
export class IntakeController {
  constructor(@Inject(IntakeService) private readonly intake: IntakeService) {}

  /** A told problem as a draft for the new-project wizard; nothing is stored. */
  @UsesAi()
  @Post()
  @HttpCode(200)
  @RequireWorkspacePermission('project.create')
  async draft(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const scope = request.workspaceAuthorization;
    if (!scope) throw new ForbiddenException();
    const abort = new AbortController();
    const close = () => {
      if (!reply.raw.writableEnded) abort.abort();
    };
    reply.raw.once('close', close);
    try {
      return await this.intake.draft(
        { workspaceId: scope.workspace.id, actorId: scope.user.id, correlationId: request.id },
        parsed.data,
        abort.signal,
      );
    } finally {
      reply.raw.off('close', close);
    }
  }
}
