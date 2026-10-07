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
  'integration.read',
  'integration.configure',
  'business.read',
  'business.link',
  'analysis.answer',
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
    editor: new Set(
      WORKSPACE_PERMISSIONS.filter((p) => !/^(provider|retention|smart|integration)\./.test(p)),
    ),
    viewer: new Set(
      WORKSPACE_PERMISSIONS.filter((p) => !/^(provider|retention|smart|integration)\./.test(p)),
    ),
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
    if (workspace.role !== session.user.role || !roleHasPermission(workspace.role, permission)) {
      throw new ForbiddenException({
        status: 403,
        title: 'Forbidden',
        code: 'AUTH_PERMISSION_DENIED',
        detail: 'The requested action is not permitted.',
      });
    }

    if (workspace.role !== 'super_admin') {
      const params = (request.params ?? {}) as Record<string, unknown>;
      const body =
        request.body && typeof request.body === 'object'
          ? (request.body as Record<string, unknown>)
          : {};
      const nestedScope =
        body['scope'] && typeof body['scope'] === 'object'
          ? (body['scope'] as Record<string, unknown>)
          : {};
      const knowledgeScopes = Array.isArray(body['scopes']) ? body['scopes'] : [];
      for (const entry of knowledgeScopes) {
        const scope = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
        if (
          !['project', 'topic'].includes(String(scope['type'])) ||
          typeof scope['id'] !== 'string'
        )
          throw new ForbiddenException({ code: 'AUTH_PERMISSION_DENIED' });
        const granted = await this.authService.resourceAccess(
          workspace.id,
          session.user.id,
          scope['type'] === 'project' ? { projectId: scope['id'] } : { topicId: scope['id'] },
        );
        if (granted !== 'EDIT') throw new ForbiddenException({ code: 'AUTH_PERMISSION_DENIED' });
      }
      const firstKnowledgeScope = knowledgeScopes[0] as Record<string, unknown> | undefined;
      const scopeParams: Record<string, unknown> = {
        ...(firstKnowledgeScope
          ? { scopeType: firstKnowledgeScope['type'], scopeId: firstKnowledgeScope['id'] }
          : {}),
        ...(nestedScope['type']
          ? { scopeType: nestedScope['type'], scopeId: nestedScope['id'] }
          : {}),
        ...((request.query as Record<string, unknown>) ?? {}),
        ...body,
        ...params,
      };
      if (scopeParams['scopeType'] === 'run') scopeParams['runId'] = scopeParams['scopeId'];
      if (scopeParams['scopeType'] === 'topic') scopeParams['topicId'] = scopeParams['scopeId'];
      if (['project', 'agent'].includes(String(scopeParams['scopeType'])))
        scopeParams['projectId'] = scopeParams['parentProjectId'] ?? scopeParams['scopeId'];
      const scoped = [
        'projectId',
        'topicId',
        'batchId',
        'documentId',
        'sourceId',
        'knowledgeId',
        'evaluationId',
        'findingId',
        'runId',
        'sourceAssetId',
        'uploadIntentId',
        'knowledgeVersionId',
        'solutionId',
        'humanTaskId',
      ].some((key) => typeof scopeParams[key] === 'string');
      const platformOnly =
        /^(provider|retention|smart|integration)\./.test(permission) ||
        (permission.startsWith('business.') && !scoped) ||
        (permission.startsWith('audit.') && !scoped) ||
        (permission === 'workspace.configure' && !scoped) ||
        (!scoped &&
          (String(permission) === 'config.configure' ||
            /^agent_definition\.(update|version|activate)$/.test(permission))) ||
        ['topic.delete', 'project.delete', 'workflow.override'].includes(permission);
      if (platformOnly) throw new ForbiddenException({ code: 'AUTH_PERMISSION_DENIED' });
      const access = scoped
        ? await this.authService.resourceAccess(workspace.id, session.user.id, scopeParams)
        : null;
      if (scoped && !access) throw new NotFoundException({ code: 'AUTH_RESOURCE_NOT_FOUND' });
      const read =
        ['GET', 'HEAD', 'OPTIONS'].includes(request.method) || permission.endsWith('.read');
      const create = ['topic.create', 'project.create'].includes(permission) && !scoped;
      if (
        (!read && !create && (scoped ? access !== 'EDIT' : workspace.role !== 'editor')) ||
        (create && workspace.role !== 'editor')
      )
        throw new ForbiddenException({
          code: 'AUTH_PERMISSION_DENIED',
          detail: 'Read-only access.',
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
