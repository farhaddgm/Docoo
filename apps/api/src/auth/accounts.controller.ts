import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { accountInputSchema, accountUpdateSchema } from '@docoo/contracts';
import { AccountsService } from './accounts.service.js';
import type { AuthRequestMetadata } from './auth.service.js';
export function requestMetadata(request: FastifyRequest): AuthRequestMetadata {
  return {
    correlationId: request.id,
    ...(request.headers.origin ? { origin: request.headers.origin } : {}),
    ...(request.headers['sec-fetch-site'] ? { fetchSite: request.headers['sec-fetch-site'] } : {}),
    ...(request.ip ? { ip: request.ip } : {}),
    ...(typeof request.headers['user-agent'] === 'string'
      ? { userAgent: request.headers['user-agent'] }
      : {}),
  };
}
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const value = schema.safeParse(body);
  if (!value.success)
    throw new BadRequestException({
      code: 'ACCOUNT_INVALID_REQUEST',
      detail: 'Provide valid account details.',
    });
  return value.data;
}
function session(request: FastifyRequest, reply: FastifyReply) {
  reply.header('Cache-Control', 'no-store');
  return request.cookies['docoo_session'];
}
const idSchema = z.uuid();
const querySchema = z
  .object({
    q: z.string().max(200).default(''),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
@Controller('admin/users')
export class AccountsController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}
  @Get() list(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query() query: unknown,
  ) {
    const p = parse(querySchema, query);
    return this.accounts.list(
      session(request, reply),
      requestMetadata(request),
      p.q,
      false,
      p.page,
    );
  }
  @Post() create(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    return this.accounts.save(
      session(request, reply),
      requestMetadata(request),
      parse(accountInputSchema, body),
    );
  }
  @Patch(':id') update(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.accounts.save(
      session(request, reply),
      requestMetadata(request),
      parse(accountUpdateSchema, body),
      parse(idSchema, id),
    );
  }
  @Delete(':id') @HttpCode(204) remove(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('id') id: string,
  ) {
    return this.accounts.remove(
      session(request, reply),
      requestMetadata(request),
      parse(idSchema, id),
    );
  }
}
@Controller('owner/google-access')
export class GoogleAccessController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}
  @Get() list(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query() query: unknown,
  ) {
    const p = parse(querySchema, query);
    return this.accounts.list(session(request, reply), requestMetadata(request), p.q, true, p.page);
  }
  @Post() grant(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const p = parse(accountInputSchema, body);
    if (p.loginMethod === 'PASSWORD') throw new BadRequestException();
    return this.accounts.save(
      session(request, reply),
      requestMetadata(request),
      p,
      undefined,
      true,
    );
  }
  @Patch(':id') update(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const p = parse(accountUpdateSchema, body);
    if (p.loginMethod === 'PASSWORD') throw new BadRequestException();
    return this.accounts.save(
      session(request, reply),
      requestMetadata(request),
      p,
      parse(idSchema, id),
      true,
    );
  }
  @Delete(':id') @HttpCode(204) revoke(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('id') id: string,
  ) {
    return this.accounts.remove(
      session(request, reply),
      requestMetadata(request),
      parse(idSchema, id),
      true,
    );
  }
}
@Controller('owner/users/:id')
export class ResourceAccessController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}
  @Get('access') list(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('id') id: string,
    @Query('workspaceId') workspaceId: string,
  ) {
    return this.accounts.access(
      session(request, reply),
      requestMetadata(request),
      parse(idSchema, id),
      parse(idSchema, workspaceId),
    );
  }
  @Put('access/:kind/:resourceId') set(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Param('resourceId') resourceId: string,
    @Body() body: unknown,
  ) {
    const p = parse(
      z.object({ workspaceId: z.uuid(), access: z.enum(['VIEW', 'EDIT']).nullable() }).strict(),
      body,
    );
    return this.accounts.setAccess(
      session(request, reply),
      requestMetadata(request),
      parse(idSchema, id),
      p.workspaceId,
      parse(z.enum(['topic', 'project']), kind),
      parse(idSchema, resourceId),
      p.access,
    );
  }
}
