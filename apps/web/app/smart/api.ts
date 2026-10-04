import { apiDelete, apiGet, apiPatch, apiPost, query } from '../api-client';

export type ErrorStatus = 'new' | 'seen' | 'fixed' | 'ignored';
export type ErrorSource = 'server' | 'client';
export const ERROR_CATEGORIES = [
  'database',
  'validation',
  'permission',
  'network',
  'provider',
  'not_found',
  'ui',
  'unknown',
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];
export type IssueStatus = 'open' | 'in_progress' | 'fixed' | 'wont_fix';

export interface SmartError {
  id: string;
  source: ErrorSource;
  category: ErrorCategory;
  status: ErrorStatus;
  message: string;
  occurrences: number;
  method: string | null;
  route: string | null;
  httpStatus: number | null;
  page: string | null;
  projectId: string | null;
  correlationId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  stack?: string | null;
  context?: unknown;
}

export interface WalkerStep {
  key: string;
  order: number;
  status: 'done' | 'ready' | 'blocked';
  blockedBy: 'project' | 'step' | null;
  counter: { current: number; total: number } | null;
  attention: number;
}

export interface WalkerProgress {
  projectId: string | null;
  steps: WalkerStep[];
  doneCount: number;
  total: number;
  nextStep: string | null;
}

export interface Conversation {
  id: string;
  kind: 'walker' | 'error';
  projectId: string | null;
  errorId: string | null;
  route: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'done' | 'failed';
  createdAt: string;
  savedIssueId?: string | null;
}

export interface Issue {
  id: string;
  title: string;
  status: IssueStatus;
  note: string;
  sourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
  body?: string;
  context?: unknown;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ProjectOption {
  id: string;
  code: string;
  title: string;
  status: string;
}

const base = (workspaceId: string) => `/workspaces/${workspaceId}/smart`;

export const smartApi = {
  summary: (workspaceId: string, signal?: AbortSignal) =>
    apiGet<{ openErrors: number; openIssues: number }>(`${base(workspaceId)}/summary`, signal),

  progress: (workspaceId: string, projectId: string | null, signal?: AbortSignal) =>
    apiGet<{ progress: WalkerProgress }>(
      `${base(workspaceId)}/walker/progress${query({ projectId: projectId ?? undefined })}`,
      signal,
    ),

  projects: (workspaceId: string, signal?: AbortSignal) =>
    apiGet<{ items: ProjectOption[] }>(`/workspaces/${workspaceId}/projects?limit=100`, signal),

  errors: (
    workspaceId: string,
    filters: {
      status?: string;
      source?: string;
      category?: string;
      search?: string;
      cursor?: string;
      limit?: string;
    },
    signal?: AbortSignal,
  ) => apiGet<Page<SmartError>>(`${base(workspaceId)}/errors${query(filters)}`, signal),

  feed: (workspaceId: string, since: string, signal?: AbortSignal) =>
    apiGet<{ items: SmartError[]; now: string }>(
      `${base(workspaceId)}/errors/feed${query({ since })}`,
      signal,
    ),

  error: (workspaceId: string, id: string, signal?: AbortSignal) =>
    apiGet<{ error: SmartError }>(`${base(workspaceId)}/errors/${id}`, signal),

  setErrorStatus: (workspaceId: string, id: string, status: ErrorStatus) =>
    apiPatch<{ error: SmartError }>(`${base(workspaceId)}/errors/${id}`, { status }),

  conversations: (workspaceId: string, signal?: AbortSignal) =>
    apiGet<{ items: Conversation[] }>(`${base(workspaceId)}/conversations`, signal),

  conversation: (workspaceId: string, id: string, signal?: AbortSignal) =>
    apiGet<{ conversation: Conversation; messages: Message[] }>(
      `${base(workspaceId)}/conversations/${id}`,
      signal,
    ),

  createConversation: async (
    workspaceId: string,
    input: { kind: 'walker' | 'error'; route: string; projectId?: string; errorId?: string },
  ) =>
    (
      (await (await apiPost(`${base(workspaceId)}/conversations`, input)).json()) as {
        conversation: Conversation;
      }
    ).conversation,

  deleteConversation: (workspaceId: string, id: string) =>
    apiDelete(`${base(workspaceId)}/conversations/${id}`),

  sendMessage: async (
    workspaceId: string,
    conversationId: string,
    input: {
      content: string;
      mode: 'chat' | 'report';
      route: string;
      locale: 'fa' | 'en';
      projectId?: string;
      walkerStep?: string;
    },
  ) =>
    (await (
      await apiPost(`${base(workspaceId)}/conversations/${conversationId}/messages`, input)
    ).json()) as { userMessage: Message; assistantMessage: Message },

  saveIssue: async (workspaceId: string, messageId: string) =>
    (await (await apiPost(`${base(workspaceId)}/issues`, { messageId })).json()) as {
      issue: Issue;
      created: boolean;
    },

  issues: (
    workspaceId: string,
    filters: { status?: string; search?: string; cursor?: string },
    signal?: AbortSignal,
  ) => apiGet<Page<Issue>>(`${base(workspaceId)}/issues${query(filters)}`, signal),

  issue: (workspaceId: string, id: string, signal?: AbortSignal) =>
    apiGet<{ issue: Issue }>(`${base(workspaceId)}/issues/${id}`, signal),

  updateIssue: (
    workspaceId: string,
    id: string,
    patch: { status?: IssueStatus; title?: string; note?: string },
  ) => apiPatch<{ issue: Issue }>(`${base(workspaceId)}/issues/${id}`, patch),

  deleteIssue: (workspaceId: string, id: string) => apiDelete(`${base(workspaceId)}/issues/${id}`),
};
