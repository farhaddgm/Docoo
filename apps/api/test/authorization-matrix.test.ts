import 'reflect-metadata';

import { ForbiddenException, RequestMethod, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AgentsController } from '../src/agents/agents.controller.js';
import { AnalysisController } from '../src/analysis/analysis.controller.js';
import { AuditController } from '../src/audit/audit.controller.js';
import { BusinessController } from '../src/business/business.controller.js';
import {
  permissionMetadataKey,
  ROLE_PERMISSIONS,
  roleHasPermission,
  WORKSPACE_PERMISSIONS,
  WorkspacePermissionGuard,
} from '../src/auth/auth.authorization.js';
import type { AuthService } from '../src/auth/auth.service.js';
import { DocumentsController } from '../src/documents/documents.controller.js';
import { ReportsController } from '../src/reports/reports.controller.js';
import { ConfigController } from '../src/config/config.controller.js';
import { KnowledgeController } from '../src/knowledge/knowledge.controller.js';
import { ProjectsController } from '../src/projects/projects.controller.js';
import { ProvidersController } from '../src/providers/providers.controller.js';
import { SmartController } from '../src/smart/smart.controller.js';
import { SourcesController } from '../src/sources/sources.controller.js';
import { TopicsController } from '../src/topics/topics.controller.js';
import { WorkflowController } from '../src/workflow/workflow.controller.js';
import { WorkspaceController } from '../src/workspaces/workspace.controller.js';

/**
 * The authorization matrix of docs/05-security/03-authorization-matrix.md. Every
 * workspace route must appear here with exactly this permission.
 */
const expectedMatrix: Record<string, string> = {
  'GET workspaces/:workspaceId': 'workspace.read',
  'GET workspaces/:workspaceId/topics': 'topic.read',
  'POST workspaces/:workspaceId/topics': 'topic.create',
  'GET workspaces/:workspaceId/topics/:topicId': 'topic.read',
  'PATCH workspaces/:workspaceId/topics/:topicId': 'topic.update',
  'GET workspaces/:workspaceId/topics/:topicId/versions': 'topic.read',
  'GET workspaces/:workspaceId/topics/:topicId/dependencies': 'topic.read',
  'POST workspaces/:workspaceId/topics/:topicId/archive': 'topic.archive',
  'POST workspaces/:workspaceId/topics/:topicId/restore': 'topic.restore',
  'DELETE workspaces/:workspaceId/topics/:topicId': 'topic.delete',
  'GET workspaces/:workspaceId/projects': 'project.read',
  'POST workspaces/:workspaceId/projects': 'project.create',
  'GET workspaces/:workspaceId/projects/:projectId': 'project.read',
  'PATCH workspaces/:workspaceId/projects/:projectId': 'project.update',
  'POST workspaces/:workspaceId/projects/:projectId/activate': 'project.run',
  'POST workspaces/:workspaceId/projects/:projectId/pause': 'project.pause',
  'POST workspaces/:workspaceId/projects/:projectId/resume': 'project.resume',
  'POST workspaces/:workspaceId/projects/:projectId/complete': 'project.run',
  'POST workspaces/:workspaceId/projects/:projectId/reopen': 'project.run',
  'POST workspaces/:workspaceId/projects/:projectId/archive': 'project.archive',
  'POST workspaces/:workspaceId/projects/:projectId/unarchive': 'project.archive',
  'POST workspaces/:workspaceId/projects/:projectId/restore': 'project.restore',
  'DELETE workspaces/:workspaceId/projects/:projectId': 'project.delete',
  'POST workspaces/:workspaceId/projects/:projectId/clone': 'project.create',
  'GET workspaces/:workspaceId/projects/:projectId/timeline': 'project.read',
  'GET workspaces/:workspaceId/projects/:projectId/effective-config': 'project.read',
  'GET workspaces/:workspaceId/projects/:projectId/config-snapshots': 'project.read',
  'GET workspaces/:workspaceId/settings/definitions': 'workspace.read',
  'GET workspaces/:workspaceId/settings/assignments': 'workspace.read',
  'GET workspaces/:workspaceId/settings/assignments/history': 'workspace.read',
  'PUT workspaces/:workspaceId/settings/assignments': 'workspace.configure',
  'POST workspaces/:workspaceId/settings/assignments/restore': 'workspace.configure',
  'GET workspaces/:workspaceId/settings/effective': 'workspace.read',
  'POST workspaces/:workspaceId/settings/preview': 'workspace.read',
  'GET workspaces/:workspaceId/audit-events': 'audit.read',
  'POST workspaces/:workspaceId/audit-events/export': 'audit.export',
  'POST workspaces/:workspaceId/retention/purge': 'retention.purge',
  'GET workspaces/:workspaceId/sources': 'knowledge.read',
  'POST workspaces/:workspaceId/sources/uploads': 'knowledge.create',
  'POST workspaces/:workspaceId/sources/text': 'knowledge.create',
  'POST workspaces/:workspaceId/sources/url': 'knowledge.create',
  'GET workspaces/:workspaceId/sources/:sourceId': 'knowledge.read',
  'POST workspaces/:workspaceId/sources/:sourceId/versions': 'knowledge.update',
  'POST workspaces/:workspaceId/sources/:sourceId/versions/:versionId/finalize': 'knowledge.create',
  'POST workspaces/:workspaceId/sources/:sourceId/versions/:versionId/retry': 'knowledge.update',
  'GET workspaces/:workspaceId/sources/:sourceId/versions/:versionId/segments': 'knowledge.read',
  'GET workspaces/:workspaceId/knowledge': 'knowledge.read',
  'POST workspaces/:workspaceId/knowledge': 'knowledge.create',
  'POST workspaces/:workspaceId/knowledge/from-source': 'knowledge.create',
  'POST workspaces/:workspaceId/knowledge/retrieve': 'knowledge.read',
  'GET workspaces/:workspaceId/knowledge/:knowledgeId': 'knowledge.read',
  'DELETE workspaces/:workspaceId/knowledge/:knowledgeId': 'knowledge.delete',
  'GET workspaces/:workspaceId/knowledge/:knowledgeId/uses': 'knowledge.read',
  'GET workspaces/:workspaceId/knowledge/:knowledgeId/versions': 'knowledge.read',
  'GET workspaces/:workspaceId/knowledge/:knowledgeId/versions/:versionId': 'knowledge.read',
  'POST workspaces/:workspaceId/knowledge/:knowledgeId/versions': 'knowledge.update',
  'POST workspaces/:workspaceId/knowledge/:knowledgeId/submit-audit': 'knowledge.audit',
  'GET workspaces/:workspaceId/audit-reviews': 'knowledge.read',
  'POST workspaces/:workspaceId/audit-reviews/:reviewId/override': 'knowledge.override',
  'GET workspaces/:workspaceId/knowledge-claims': 'knowledge.read',
  'GET workspaces/:workspaceId/knowledge-conflicts': 'knowledge.read',
  'POST workspaces/:workspaceId/knowledge-conflicts/:conflictId/resolve': 'knowledge.audit',
  'GET workspaces/:workspaceId/retrieval-snapshots/:snapshotId': 'knowledge.read',
  'GET workspaces/:workspaceId/provider-connections': 'provider.read',
  'POST workspaces/:workspaceId/provider-connections': 'provider.configure',
  'GET workspaces/:workspaceId/provider-connections/:connectionId': 'provider.read',
  'PATCH workspaces/:workspaceId/provider-connections/:connectionId': 'provider.configure',
  'POST workspaces/:workspaceId/provider-connections/:connectionId/rotate-secret':
    'provider.rotate_secret',
  'POST workspaces/:workspaceId/provider-connections/:connectionId/disable': 'provider.configure',
  'POST workspaces/:workspaceId/provider-connections/:connectionId/health-check': 'provider.test',
  'GET workspaces/:workspaceId/provider-connections/:connectionId/self-check': 'provider.read',
  'POST workspaces/:workspaceId/provider-connections/:connectionId/self-check': 'provider.test',
  'POST workspaces/:workspaceId/provider-connections/:connectionId/models/refresh':
    'provider.configure',
  'GET workspaces/:workspaceId/provider-connections/:connectionId/models': 'provider.read',
  'GET workspaces/:workspaceId/model-prices': 'provider.read',
  'POST workspaces/:workspaceId/model-prices': 'provider.configure',
  'POST workspaces/:workspaceId/model-prices/catalog-lookup': 'provider.configure',
  'POST workspaces/:workspaceId/model-prices/catalog-import': 'provider.configure',
  'GET workspaces/:workspaceId/model-invocations': 'provider.read',
  'GET workspaces/:workspaceId/integrations/contenter': 'integration.read',
  'PUT workspaces/:workspaceId/integrations/contenter': 'integration.configure',
  'POST workspaces/:workspaceId/integrations/contenter/test': 'integration.configure',
  'DELETE workspaces/:workspaceId/integrations/contenter': 'integration.configure',
  'GET workspaces/:workspaceId/contenter-businesses': 'business.read',
  'GET workspaces/:workspaceId/projects/:projectId/business': 'business.read',
  'PUT workspaces/:workspaceId/projects/:projectId/business': 'business.link',
  'POST workspaces/:workspaceId/projects/:projectId/business/unlink': 'business.link',
  'POST workspaces/:workspaceId/projects/:projectId/business/sync': 'business.link',
  'GET workspaces/:workspaceId/projects/:projectId/business/snapshots': 'business.read',
  'GET workspaces/:workspaceId/projects/:projectId/business/snapshots/:snapshotId': 'business.read',
  'GET workspaces/:workspaceId/projects/:projectId/business/context': 'business.read',
  'GET workspaces/:workspaceId/projects/:projectId/usage': 'project.read',
  'GET workspaces/:workspaceId/projects/:projectId/workflow': 'project.read',
  'POST workspaces/:workspaceId/projects/:projectId/workflow/start': 'project.run',
  'POST workspaces/:workspaceId/projects/:projectId/workflow/sync': 'project.run',
  'POST workspaces/:workspaceId/projects/:projectId/workflow/cancel': 'workflow.cancel',
  'GET workspaces/:workspaceId/projects/:projectId/stages/:stageRunId': 'project.read',
  'POST workspaces/:workspaceId/projects/:projectId/stages/:stageRunId/outputs/:outputId/approve':
    'workflow.approve',
  'POST workspaces/:workspaceId/projects/:projectId/stages/:stageRunId/outputs/:outputId/reject':
    'workflow.reject',
  'POST workspaces/:workspaceId/projects/:projectId/stages/:stageRunId/outputs/:outputId/comment':
    'project.update',
  'POST workspaces/:workspaceId/projects/:projectId/stages/:stageRunId/outputs/:outputId/edit':
    'project.update',
  'POST workspaces/:workspaceId/projects/:projectId/stages/:stageRunId/attempt-decision':
    'workflow.override',
  'GET workspaces/:workspaceId/human-tasks': 'workspace.read',
  'GET workspaces/:workspaceId/projects/:projectId/analysis': 'project.read',
  'GET workspaces/:workspaceId/projects/:projectId/analysis/question-batches': 'project.read',
  'GET workspaces/:workspaceId/projects/:projectId/problem-definitions': 'project.read',
  'POST workspaces/:workspaceId/question-batches/:batchId/answers': 'analysis.answer',
  'POST workspaces/:workspaceId/projects/:projectId/analysis/finish': 'workflow.approve',
  'GET workspaces/:workspaceId/agent-roles': 'agent_definition.read',
  'GET workspaces/:workspaceId/agent-roles/:role': 'agent_definition.read',
  'GET workspaces/:workspaceId/agent-roles/:role/definitions': 'agent_definition.read',
  'POST workspaces/:workspaceId/agent-roles/:role/definitions': 'agent_definition.version',
  'POST workspaces/:workspaceId/agent-roles/:role/definitions/:definitionId/activate':
    'agent_definition.activate',
  'GET workspaces/:workspaceId/agent-roles/:role/outputs': 'agent_definition.read',
  'GET workspaces/:workspaceId/projects/:projectId/agents': 'agent_definition.read',
  'GET workspaces/:workspaceId/projects/:projectId/agents/:role': 'agent_definition.read',
  'POST workspaces/:workspaceId/projects/:projectId/agents/:role/copy-default':
    'agent_definition.update',
  'PATCH workspaces/:workspaceId/projects/:projectId/agents/:role': 'agent_definition.update',
  'POST workspaces/:workspaceId/projects/:projectId/agents/:role/pin': 'agent_definition.update',
  'GET workspaces/:workspaceId/document-templates': 'workspace.read',
  'GET workspaces/:workspaceId/solution-criteria/defaults': 'workspace.read',
  'GET workspaces/:workspaceId/projects/:projectId/solution-criteria': 'project.read',
  'PUT workspaces/:workspaceId/projects/:projectId/solution-criteria': 'project.update',
  'POST workspaces/:workspaceId/projects/:projectId/solutions/generate': 'project.run',
  'GET workspaces/:workspaceId/projects/:projectId/solutions': 'project.read',
  'POST workspaces/:workspaceId/projects/:projectId/solution-selections': 'workflow.approve',
  'GET workspaces/:workspaceId/projects/:projectId/documents': 'document.read',
  'GET workspaces/:workspaceId/documents/:documentId': 'document.read',
  'PUT workspaces/:workspaceId/documents/:documentId/content': 'document.edit',
  'GET workspaces/:workspaceId/documents/:documentId/versions': 'document.read',
  'GET workspaces/:workspaceId/documents/:documentId/versions/:versionId': 'document.read',
  'GET workspaces/:workspaceId/documents/:documentId/diff': 'document.read',
  'POST workspaces/:workspaceId/documents/:documentId/versions/:versionId/restore':
    'document.restore',
  'POST workspaces/:workspaceId/documents/:documentId/writings': 'document.edit',
  'GET workspaces/:workspaceId/documents/:documentId/writings': 'document.read',
  'GET workspaces/:workspaceId/documents/:documentId/writings/:writingId': 'document.read',
  'POST workspaces/:workspaceId/documents/:documentId/writings/:writingId/pause': 'document.edit',
  'POST workspaces/:workspaceId/documents/:documentId/writings/:writingId/resume': 'document.edit',
  'POST workspaces/:workspaceId/documents/:documentId/writings/:writingId/cancel': 'document.edit',
  'POST workspaces/:workspaceId/documents/:documentId/check': 'document.edit',
  'POST workspaces/:workspaceId/documents/:documentId/submit': 'document.edit',
  'POST workspaces/:workspaceId/documents/:documentId/approve': 'document.approve',
  'POST workspaces/:workspaceId/documents/:documentId/reject': 'document.approve',
  'POST workspaces/:workspaceId/documents/:documentId/lock': 'document.lock',
  'POST workspaces/:workspaceId/documents/:documentId/supersede': 'document.lock',
  'POST workspaces/:workspaceId/documents/:documentId/exports': 'document.export',
  'GET workspaces/:workspaceId/documents/:documentId/artifacts': 'document.read',
  'GET workspaces/:workspaceId/documents/:documentId/artifacts/:artifactId/download':
    'document.export',
  'GET workspaces/:workspaceId/documents/:documentId/artifacts/:artifactId/verify': 'document.read',
  'GET workspaces/:workspaceId/projects/:projectId/rubric': 'project.read',
  'PUT workspaces/:workspaceId/projects/:projectId/rubric': 'project.update',
  'POST workspaces/:workspaceId/documents/:documentId/evaluate': 'document.approve',
  'GET workspaces/:workspaceId/evaluations/:evaluationId': 'document.read',
  'POST workspaces/:workspaceId/evaluations/:evaluationId/accept-exception': 'workflow.override',
  'PATCH workspaces/:workspaceId/evaluation-findings/:findingId': 'workflow.override',
  'GET workspaces/:workspaceId/dashboard': 'workspace.read',
  'GET workspaces/:workspaceId/reports/usage': 'provider.read',
  'POST workspaces/:workspaceId/brain-reports': 'knowledge.audit',
  'GET workspaces/:workspaceId/brain-reports': 'knowledge.read',
  'GET workspaces/:workspaceId/brain-reports/:reportId': 'knowledge.read',
  'GET workspaces/:workspaceId/smart/summary': 'smart.read',
  'GET workspaces/:workspaceId/smart/walker/progress': 'smart.read',
  'POST workspaces/:workspaceId/smart/errors': 'workspace.read',
  'GET workspaces/:workspaceId/smart/errors': 'smart.read',
  'GET workspaces/:workspaceId/smart/errors/feed': 'smart.read',
  'GET workspaces/:workspaceId/smart/errors/:errorId': 'smart.read',
  'PATCH workspaces/:workspaceId/smart/errors/:errorId': 'smart.manage',
  'GET workspaces/:workspaceId/smart/conversations': 'smart.read',
  'POST workspaces/:workspaceId/smart/conversations': 'smart.chat',
  'GET workspaces/:workspaceId/smart/conversations/:conversationId': 'smart.read',
  'DELETE workspaces/:workspaceId/smart/conversations/:conversationId': 'smart.chat',
  'POST workspaces/:workspaceId/smart/conversations/:conversationId/messages': 'smart.chat',
  'GET workspaces/:workspaceId/smart/issues': 'smart.read',
  'POST workspaces/:workspaceId/smart/issues': 'smart.manage',
  'GET workspaces/:workspaceId/smart/issues/:issueId': 'smart.read',
  'PATCH workspaces/:workspaceId/smart/issues/:issueId': 'smart.manage',
  'DELETE workspaces/:workspaceId/smart/issues/:issueId': 'smart.manage',
};

const controllers = [
  WorkspaceController,
  TopicsController,
  ProjectsController,
  ConfigController,
  AuditController,
  SourcesController,
  KnowledgeController,
  ProvidersController,
  WorkflowController,
  AgentsController,
  AnalysisController,
  BusinessController,
  DocumentsController,
  ReportsController,
  SmartController,
];

function routeTable(): Record<string, string | undefined> {
  const table: Record<string, string | undefined> = {};
  for (const controller of controllers) {
    const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
    const prototype = controller.prototype as unknown as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[name];
      if (typeof handler !== 'function' || name === 'constructor') continue;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (path === undefined || method === undefined) continue;
      const full = [base, path].filter((part) => part && part !== '/').join('/');
      const guards = (Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[];
      expect(guards, `${full} must use WorkspacePermissionGuard`).toContain(
        WorkspacePermissionGuard,
      );
      table[`${RequestMethod[method]} ${full}`] = Reflect.getMetadata(
        permissionMetadataKey,
        handler,
      ) as string | undefined;
    }
  }
  return table;
}

describe('authorization matrix (AUTH-003, TC-AUTH-005)', () => {
  it('protects every workspace route with exactly the documented permission', () => {
    expect(routeTable()).toEqual(expectedMatrix);
  });

  it('uses only known permissions', () => {
    for (const permission of Object.values(expectedMatrix)) {
      expect(WORKSPACE_PERMISSIONS).toContain(permission);
    }
  });

  it('grants Super Admin every permission and unknown roles none', () => {
    expect([...ROLE_PERMISSIONS.super_admin].sort()).toEqual([...WORKSPACE_PERMISSIONS].sort());
    for (const permission of WORKSPACE_PERMISSIONS) {
      expect(roleHasPermission('super_admin', permission)).toBe(true);
      expect(roleHasPermission('unknown', permission)).toBe(false);
      expect(roleHasPermission('__proto__', permission)).toBe(false);
    }
  });

  it('denies a membership whose role lacks the permission', async () => {
    const workspace = {
      id: '810b1170-629e-4718-b880-5cb0b81d6f32',
      code: 'main',
      name: 'Docoo',
      role: 'viewer',
    };
    const authService = {
      currentSession: vi.fn().mockResolvedValue({
        user: { id: '405c9eaa-d469-493c-94b3-6ec7744df8e7' },
        workspaces: [workspace],
        maxAgeSeconds: 1800,
      }),
      assertSameOrigin: vi.fn(),
      secureCookies: false,
    } as unknown as AuthService;
    const request = {
      id: 'request-id',
      method: 'GET',
      headers: {},
      cookies: { docoo_session: 'token' },
      params: { workspaceId: workspace.id },
    } as unknown as FastifyRequest;
    const reply = { setCookie: vi.fn(), header: vi.fn() } as unknown as FastifyReply;
    const context = {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- only read as metadata key
      getHandler: () => TopicsController.prototype.list,
      getClass: () => TopicsController,
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
    } as unknown as ExecutionContext;

    const guard = new WorkspacePermissionGuard(authService, new Reflector());
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
