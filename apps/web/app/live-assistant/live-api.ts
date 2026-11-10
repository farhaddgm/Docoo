import type {
  LiveActionView,
  LiveAskAnswer,
  LiveAssistantClientConfig,
  LiveCostSummary,
  LiveMessageView,
  LiveSessionView,
  LiveUsageAnswer,
} from '@docoo/contracts';

import { apiGet, apiSend } from '../api-client';

/**
 * What the live assistant's session needs from the server (ADR-0055 §4-5). The store knows only
 * this interface, so tests give it a stand-in and production gives it the API of one workspace.
 */
export interface LiveBackend {
  readonly startSession: (channel?: 'voice' | 'text') => Promise<LiveSessionView>;
  /** Type to the assistant: its model works through the gateway; changes come back waiting. */
  readonly ask: (
    sessionId: string,
    input: {
      text: string;
      context: readonly { role: 'user' | 'assistant'; content: string }[];
      currentProjectId?: string;
    },
  ) => Promise<LiveAskAnswer>;
  /** Totals so far, not increments; the server checks its caps against them and its own clock. */
  readonly reportUsage: (
    sessionId: string,
    totals: {
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      cachedInputTokens?: number;
      activity?: 'listening' | 'thinking' | 'speaking' | 'asleep';
    },
  ) => Promise<LiveUsageAnswer>;
  readonly appendMessages: (
    sessionId: string,
    messages: readonly { role: 'user' | 'assistant'; content: string }[],
  ) => Promise<unknown>;
  readonly endSession: (sessionId: string, reason: 'user' | 'idle' | 'error') => Promise<unknown>;
  /** The gateway: the server decides whether the change may exist and with which confirmations. */
  readonly proposeAction: (input: {
    sessionId: string;
    capability: string;
    params: Record<string, unknown>;
    tainted: boolean;
  }) => Promise<LiveActionView>;
  readonly confirmAction: (
    actionId: string,
    input: { via: 'voice' | 'click'; transcript?: string },
  ) => Promise<LiveActionView>;
  readonly cancelAction: (actionId: string) => Promise<LiveActionView>;
  /** Also lets the server close a proposal whose time ran out. */
  readonly getAction: (actionId: string) => Promise<LiveActionView>;
}

/**
 * No version prefix here: the web server's rewrite of `/api/...` (next.config.ts) already adds it,
 * so a path that carried it too reached the API with it twice, which no route matches (404).
 */
const base = (workspaceId: string) => `/workspaces/${workspaceId}/live-assistant`;

export function liveBackendFor(workspaceId: string): LiveBackend {
  const root = base(workspaceId);
  return {
    startSession: (channel = 'voice') =>
      apiSend<LiveSessionView>('POST', `${root}/sessions`, { channel }),
    ask: (sessionId, input) =>
      apiSend<LiveAskAnswer>('POST', `${root}/sessions/${sessionId}/ask`, input),
    reportUsage: (sessionId, totals) =>
      apiSend<LiveUsageAnswer>('POST', `${root}/sessions/${sessionId}/usage`, totals),
    appendMessages: (sessionId, messages) =>
      apiSend('POST', `${root}/sessions/${sessionId}/messages`, { messages }),
    endSession: (sessionId, reason) =>
      apiSend('POST', `${root}/sessions/${sessionId}/end`, { reason }),
    proposeAction: (input) => apiSend<LiveActionView>('POST', `${root}/actions`, input),
    confirmAction: (actionId, input) =>
      apiSend<LiveActionView>('POST', `${root}/actions/${actionId}/confirm`, input),
    cancelAction: (actionId) =>
      apiSend<LiveActionView>('POST', `${root}/actions/${actionId}/cancel`, {}),
    getAction: (actionId) => apiGet<LiveActionView>(`${root}/actions/${actionId}`),
  };
}

export interface LiveSessionDetail {
  readonly session: LiveSessionView;
  readonly messages: readonly LiveMessageView[];
  readonly actions: readonly LiveActionView[];
}

/** Reads for the Smart tab: whether the assistant can start, and the conversations so far. */
export const liveReadApi = {
  config: (workspaceId: string, signal?: AbortSignal) =>
    apiGet<LiveAssistantClientConfig>(`${base(workspaceId)}/config`, signal),
  cost: (workspaceId: string, signal?: AbortSignal) =>
    apiGet<LiveCostSummary>(`${base(workspaceId)}/cost`, signal),
  sessions: (workspaceId: string, signal?: AbortSignal) =>
    apiGet<{ items: LiveSessionView[] }>(`${base(workspaceId)}/sessions`, signal),
  session: (workspaceId: string, sessionId: string, signal?: AbortSignal) =>
    apiGet<LiveSessionDetail>(`${base(workspaceId)}/sessions/${sessionId}`, signal),
  /** Deletes the text of one ended conversation; its proposed changes and the audit trail stay. */
  deleteTranscript: (workspaceId: string, sessionId: string) =>
    apiSend<{ deleted: number }>('DELETE', `${base(workspaceId)}/sessions/${sessionId}/messages`),
};
