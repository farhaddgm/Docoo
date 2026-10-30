import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { defaultPolicy, resolveAccess, type AccountPolicy } from '@docoo/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { AccountPolicyService } from '../src/auth/account-policy.service.js';
import {
  RequireWorkspacePermission,
  UploadsFile,
  UsesAi,
  WorkspacePermissionGuard,
} from '../src/auth/auth.authorization.js';
import type { AuthService } from '../src/auth/auth.service.js';

const workspace = { id: '810b1170-629e-4718-b880-5cb0b81d6f32', code: 'main', name: 'Docoo' };

class Routes {
  @RequireWorkspacePermission('knowledge.read')
  readKnowledge(this: void) {}

  @RequireWorkspacePermission('knowledge.create')
  createKnowledge(this: void) {}

  @RequireWorkspacePermission('document.edit')
  editDocument(this: void) {}

  @RequireWorkspacePermission('topic.create')
  createTopic(this: void) {}

  @RequireWorkspacePermission('project.create')
  createProject(this: void) {}

  @UsesAi()
  @RequireWorkspacePermission('project.run')
  runProject(this: void) {}

  @UploadsFile()
  @RequireWorkspacePermission('knowledge.create')
  upload(this: void) {}
}

type Handler = keyof Routes;

async function attempt(
  role: 'editor' | 'viewer',
  policy: Partial<AccountPolicy> | null,
  handler: Handler,
  method = 'POST',
) {
  const stored = policy ? { ...defaultPolicy(), ...policy } : null;
  const user = {
    id: '405c9eaa-d469-493c-94b3-6ec7744df8e7',
    email: 'member@example.test',
    displayName: 'Member',
    role,
    policy: stored,
    access: resolveAccess(role, stored),
  };
  const authService = {
    currentSession: vi.fn().mockResolvedValue({
      user,
      workspaces: [{ ...workspace, role }],
      maxAgeSeconds: 1800,
    }),
    assertSameOrigin: vi.fn(),
    resourceAccess: vi.fn().mockResolvedValue('EDIT'),
    secureCookies: false,
  } as unknown as AuthService;
  const request = {
    id: 'request-id',
    method,
    headers: {},
    cookies: { docoo_session: 'token' },
    params: { workspaceId: workspace.id },
    body: {},
    query: {},
  } as unknown as FastifyRequest;
  const reply = { setCookie: vi.fn(), header: vi.fn() } as unknown as FastifyReply;
  const context = {
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
  } as unknown as ExecutionContext;
  const guard = new WorkspacePermissionGuard(
    authService,
    new Reflector(),
    new AccountPolicyService({} as unknown as Pool),
  );
  return guard.canActivate(context).then(
    () => 'allowed',
    (error: { response?: { code?: string } }) => error.response?.code ?? 'denied',
  );
}

describe('the owner’s per-account settings in the permission guard (ADR-0042)', () => {
  it('lets a viewer read and never write, whatever the policy gives it', async () => {
    expect(await attempt('viewer', null, 'readKnowledge', 'GET')).toBe('allowed');
    const generous = { sections: { knowledge: 'edit' as const }, canCreateProjects: true };
    expect(await attempt('viewer', generous, 'createKnowledge')).toBe('AUTH_PERMISSION_DENIED');
    expect(await attempt('viewer', generous, 'createProject')).toBe('AUTH_PERMISSION_DENIED');
  });

  it('closes a section the owner set to none, even for reading', async () => {
    const closed = { sections: { knowledge: 'none' as const } };
    expect(await attempt('editor', closed, 'readKnowledge', 'GET')).toBe('AUTH_SECTION_DENIED');
    expect(await attempt('editor', closed, 'createKnowledge')).toBe('AUTH_SECTION_DENIED');
  });

  it('lets a view-only section be read but not changed', async () => {
    const look = { sections: { documents: 'view' as const, knowledge: 'view' as const } };
    expect(await attempt('editor', look, 'readKnowledge', 'GET')).toBe('allowed');
    expect(await attempt('editor', look, 'editDocument')).toBe('AUTH_SECTION_DENIED');
  });

  it('leaves an editor with no policy able to change everything but create nothing', async () => {
    expect(await attempt('editor', null, 'createKnowledge')).toBe('allowed');
    expect(await attempt('editor', null, 'createProject')).toBe('AUTH_PROJECT_CREATE_DENIED');
    expect(await attempt('editor', null, 'createTopic')).toBe('AUTH_TOPIC_CREATE_DENIED');
    expect(await attempt('editor', { canCreateProjects: true }, 'createProject')).toBe('allowed');
    expect(await attempt('editor', { canCreateTopics: true }, 'createTopic')).toBe('allowed');
  });

  it('refuses work that needs a model once AI is off, and an upload once it is barred', async () => {
    const off = { ai: { ...defaultPolicy().ai, enabled: false } };
    expect(await attempt('editor', off, 'runProject')).toBe('AUTH_AI_DISABLED');
    expect(await attempt('editor', null, 'runProject')).toBe('allowed');
    expect(await attempt('editor', { canUploadFiles: false }, 'upload')).toBe('AUTH_UPLOAD_DENIED');
    expect(await attempt('editor', null, 'upload')).toBe('allowed');
  });
});
