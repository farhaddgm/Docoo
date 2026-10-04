import {
  applyDecorators,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { AuthService, type AuthUser, type AuthWorkspace } from './auth.service.js';

export const WORKSPACE_PERMISSIONS = [
  'workspace.read',
  'workspace.configure',
  'topic.create',
  'topic.read',
  'topic.update',
  'topic.archive',
  'topic.delete',
  'topic.restore',
  'project.create',
  'project.read',
  'project.update',
  'project.run',
  'project.pause',
  'project.resume',
  'project.archive',
  'project.delete',
  'project.restore',
  'agent_definition.read',
  'agent_definition.update',
  'agent_definition.version',
  'agent_definition.activate',
  'knowledge.create',
  'knowledge.read',
  'knowledge.update',
  'knowledge.audit',
  'knowledge.override',
  'knowledge.delete',
  'document.read',
  'document.edit',
  'document.approve',
  'document.export',
  'document.lock',
  'document.restore',
  'provider.read',
  'provider.configure',
  'provider.test',
  'provider.rotate_secret',
  'workflow.approve',
  'workflow.reject',
  'workflow.override',
  'workflow.retry',
  'workflow.cancel',
  'audit.read',
  'audit.export',
  'retention.configure',
  'retention.purge',
  'smart.read',
  'smart.chat',
  'smart.manage',
] as const;

export type WorkspacePermission = (typeof WORKSPACE_PERMISSIONS)[number];

export interface WorkspaceAuthorization {
  readonly user: AuthUser;
  readonly workspace: AuthWorkspace;
  readonly permission: WorkspacePermission;
}

declare module 'fastify' {
  interface FastifyRequest {
    workspaceAuthorization?: WorkspaceAuthorization;
  }
}

export type MembershipRole = AuthWorkspace['role'];

/**
 * Role → permission matrix (FR-AUTH-005). Version 1 only has Super Admin, who holds
 * every workspace permission; future roles are added here without touching routes.
 * See docs/05-security/03-authorization-matrix.md.
 */
export const ROLE_PERMISSIONS: Readonly<Record<MembershipRole, ReadonlySet<WorkspacePermission>>> =
  {
    super_admin: new Set(WORKSPACE_PERMISSIONS),
  };

export function roleHasPermission(role: string, permission: WorkspacePermission): boolean {
  return Object.hasOwn(ROLE_PERMISSIONS, role)
    ? ROLE_PERMISSIONS[role as MembershipRole].has(permission)
    : false;
}

export const permissionMetadataKey = Symbol('docoo.workspace_permission');
const knownPermissions: ReadonlySet<string> = new Set(WORKSPACE_PERMISSIONS);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Routes using this decorator must declare a :workspaceId path parameter. */
export function RequireWorkspacePermission(permission: WorkspacePermission) {
  return applyDecorators(
    SetMetadata(permissionMetadataKey, permission),
    UseGuards(WorkspacePermissionGuard),
  );
}

@Injectable()
export class WorkspacePermissionGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<WorkspacePermission>(
      permissionMetadataKey,
      [context.getHandler(), context.getClass()],
    );
    if (!permission || !knownPermissions.has(permission)) {
      throw new ForbiddenException({
        status: 403,
        title: 'Forbidden',
        code: 'AUTH_PERMISSION_DENIED',
        detail: 'The requested action is not permitted.',
      });
    }

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    reply.header('Cache-Control', 'no-store');
    const token = request.cookies?.['docoo_session'];
    if (!token) {
      throw new UnauthorizedException({
        status: 401,
        title: 'Unauthorized',
        code: 'AUTH_SESSION_INVALID',
        detail: 'The session is expired or invalid.',
      });
    }

    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      this.authService.assertSameOrigin({
        correlationId: request.id,
        ...(request.headers.origin ? { origin: request.headers.origin } : {}),
        ...(request.headers['sec-fetch-site']
          ? { fetchSite: request.headers['sec-fetch-site'] }
          : {}),
      });
    }

    const session = await this.authService.currentSession(token);
    const rawWorkspaceId = (request.params as Record<string, unknown> | undefined)?.['workspaceId'];
    if (typeof rawWorkspaceId !== 'string' || !uuidPattern.test(rawWorkspaceId)) {
      throw new BadRequestException({
        status: 400,
        title: 'Invalid request',
        code: 'AUTH_WORKSPACE_REQUIRED',
        detail: 'A valid workspace ID is required in the route.',
      });
    }

    const workspace = session.workspaces.find(
      (candidate) => candidate.id === rawWorkspaceId.toLowerCase(),
    );
    if (!workspace) {
      throw new NotFoundException({
        status: 404,
        title: 'Not Found',
        code: 'AUTH_WORKSPACE_NOT_FOUND',
        detail: 'The workspace was not found.',
      });
    }
    if (!roleHasPermission(workspace.role, permission)) {
      throw new ForbiddenException({
        status: 403,
        title: 'Forbidden',
        code: 'AUTH_PERMISSION_DENIED',
        detail: 'The requested action is not permitted.',
      });
    }

    request.workspaceAuthorization = { user: session.user, workspace, permission };
    reply.setCookie('docoo_session', token, {
      httpOnly: true,
      secure: this.authService.secureCookies,
      sameSite: 'lax',
      path: '/',
      maxAge: session.maxAgeSeconds,
    });
    return true;
  }
}
