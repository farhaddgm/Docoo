import 'reflect-metadata';

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import {
  RequireWorkspacePermission,
  WorkspacePermissionGuard,
} from '../src/auth/auth.authorization.js';
import type { AuthService } from '../src/auth/auth.service.js';

const workspace = {
  id: '810b1170-629e-4718-b880-5cb0b81d6f32',
  code: 'main',
  name: 'Docoo',
  role: 'super_admin' as const,
};
const user = {
  id: '405c9eaa-d469-493c-94b3-6ec7744df8e7',
  email: 'admin@example.test',
  displayName: 'Docoo Admin',
  role: 'super_admin' as const,
};

class ProtectedController {
  @RequireWorkspacePermission('workspace.read')
  read(this: void) {}

  unprotected(this: void) {}
}

function fixture() {
  const request = {
    id: 'request-id',
    method: 'GET',
    headers: {},
    cookies: { docoo_session: 'opaque-session-token' },
    params: { workspaceId: workspace.id },
    body: {},
  } as unknown as FastifyRequest;
  const setCookie = vi.fn();
  const header = vi.fn();
  const reply = { setCookie, header } as unknown as FastifyReply;
  const currentSession = vi.fn().mockResolvedValue({
    user,
    workspaces: [workspace],
    maxAgeSeconds: 1800,
  });
  const assertSameOrigin = vi.fn();
  const authService = {
    currentSession,
    assertSameOrigin,
    secureCookies: false,
  } as unknown as AuthService;
  const guard = new WorkspacePermissionGuard(authService, new Reflector());
  const context = {
    getHandler: () => ProtectedController.prototype.read,
    getClass: () => ProtectedController,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => reply,
    }),
  } as unknown as ExecutionContext;
  return { request, setCookie, header, currentSession, assertSameOrigin, guard, context };
}

describe('WorkspacePermissionGuard', () => {
  it('uses the session membership for the workspace in the route', async () => {
    const { request, setCookie, header, currentSession, guard, context } = fixture();
    request.body = { workspaceId: 'db791fac-c634-4554-850f-52bcfdffdd57' };

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(currentSession).toHaveBeenCalledWith('opaque-session-token');
    expect(request.workspaceAuthorization).toEqual({
      user,
      workspace,
      permission: 'workspace.read',
    });
    expect(setCookie).toHaveBeenCalledWith(
      'docoo_session',
      'opaque-session-token',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', maxAge: 1800 }),
    );
    expect(header).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('rejects a missing session without a database lookup', async () => {
    const { request, currentSession, guard, context } = fixture();
    request.cookies = {};

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(currentSession).not.toHaveBeenCalled();
  });

  it('does not reveal whether a workspace outside the membership exists', async () => {
    const { request, setCookie, guard, context } = fixture();
    request.params = { workspaceId: 'db791fac-c634-4554-850f-52bcfdffdd57' };
    request.body = { workspaceId: workspace.id };

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(NotFoundException);
    expect(request.workspaceAuthorization).toBeUndefined();
    expect(setCookie).not.toHaveBeenCalled();
  });

  it('rejects a malformed or absent workspace route parameter', async () => {
    const { request, guard, context } = fixture();
    request.params = { workspaceId: 'not-a-uuid' };

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('denies a membership without the required role', async () => {
    const { currentSession, guard, context } = fixture();
    currentSession.mockResolvedValue({
      user,
      workspaces: [{ ...workspace, role: 'viewer' }],
      maxAgeSeconds: 1800,
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('checks same-origin protection before a state-changing request', async () => {
    const { request, assertSameOrigin, currentSession, guard, context } = fixture();
    Object.assign(request, { method: 'POST' });
    request.headers.origin = 'https://attacker.invalid';
    assertSameOrigin.mockImplementation(() => {
      throw new ForbiddenException();
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(assertSameOrigin).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'https://attacker.invalid' }),
    );
    expect(currentSession).not.toHaveBeenCalled();
  });

  it('fails closed if a route attaches the guard without a permission', async () => {
    const { currentSession, guard, context } = fixture();
    vi.spyOn(context, 'getHandler').mockReturnValue(ProtectedController.prototype.unprotected);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(currentSession).not.toHaveBeenCalled();
  });
});
