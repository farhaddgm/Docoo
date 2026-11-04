import type {
  LiveActionView,
  LiveAssistantClientConfig,
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
  readonly startSession: () => Promise<LiveSessionView>;
  /** Totals so far, not increments; the server checks its caps against them and its own clock. */
  readonly reportUsage: (
    sessionId: string,
    totals: { inputTokens: number; outputTokens: number; costUsd: number },
  ) => Promise<LiveUsageAnswer>;
  readonly appendMessages: (
    sessionId: string,
    messages: readonly { role: 'user' | 'assistant'; content: string }[],
  ) => Promise<unknown>;
  readonly endSession: (sessionId: string, reason: 'user' | 'idle' | 'error') => Promise<unknown>;
}

const base = (workspaceId: string) => `/v1/workspaces/${workspaceId}/live-assistant`;

export function liveBackendFor(workspaceId: string): LiveBackend {
  const root = base(workspaceId);
  return {
    startSession: () => apiSend<LiveSessionView>('POST', `${root}/sessions`, {}),
    reportUsage: (sessionId, totals) =>
      apiSend<LiveUsageAnswer>('POST', `${root}/sessions/${sessionId}/usage`, totals),
    appendMessages: (sessionId, messages) =>
      apiSend('POST', `${root}/sessions/${sessionId}/messages`, { messages }),
    endSession: (sessionId, reason) =>
      apiSend('POST', `${root}/sessions/${sessionId}/end`, { reason }),
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
  sessions: (workspaceId: string, signal?: AbortSignal) =>
    apiGet<{ items: LiveSessionView[] }>(`${base(workspaceId)}/sessions`, signal),
  session: (workspaceId: string, sessionId: string, signal?: AbortSignal) =>
    apiGet<LiveSessionDetail>(`${base(workspaceId)}/sessions/${sessionId}`, signal),
};
