import type {
  VoiceBrand,
  VoiceClientConfig,
  VoiceConversationKind,
  VoicePreferences,
} from '@docoo/contracts';

import { apiGet, apiPost, apiPostBinary, apiSend, query } from '../api-client';

export type { VoiceClientConfig, VoicePreferences };

export interface VoiceScope {
  readonly conversationKind: VoiceConversationKind;
  readonly conversationId: string;
}

export interface Transcript {
  text: string;
  language: string | null;
  durationMs: number | null;
  audioId: string | null;
}

export interface VoiceModelInfo {
  id: string;
  displayName: string;
  kind: 'stt' | 'tts';
  languages: string[];
}

export interface VoiceInfo {
  id: string;
  name: string;
  languages: string[];
  description: string | null;
  previewUrl: string | null;
}

export interface UsageTotal {
  kind: 'stt' | 'tts';
  provider: string;
  model: string;
  calls: number;
  failed: number;
  audioSeconds: number;
  characters: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  unpriced: number;
}

export interface VoiceUsage {
  days: number;
  totals: UsageTotal[];
  byDay: { day: string; kind: 'stt' | 'tts'; calls: number; costUsd: number }[];
  byUser: { userId: string | null; calls: number; costUsd: number }[];
}

export interface VoicePrice {
  id: string;
  provider: VoiceBrand;
  model: string;
  kind: 'stt' | 'tts';
  perMinute: number | null;
  per1kCharacters: number | null;
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  effectiveFrom: string;
}

const base = (workspaceId: string) => `/workspaces/${workspaceId}/voice`;

export const voiceApi = {
  config: (workspaceId: string) => apiGet<VoiceClientConfig>(`${base(workspaceId)}/config`),
  preferences: (workspaceId: string) =>
    apiGet<VoicePreferences>(`${base(workspaceId)}/preferences`),
  savePreferences: (workspaceId: string, value: VoicePreferences) =>
    apiSend<VoicePreferences>('PUT', `${base(workspaceId)}/preferences`, value),

  transcribe: (
    workspaceId: string,
    recording: {
      blob: Blob;
      durationMs: number;
      locale: 'fa' | 'en';
      scope?: VoiceScope | undefined;
    },
  ) =>
    apiPostBinary<Transcript>(
      `${base(workspaceId)}/transcribe${query({
        locale: recording.locale,
        durationMs: String(Math.round(recording.durationMs)),
        conversationKind: recording.scope?.conversationKind,
        conversationId: recording.scope?.conversationId,
      })}`,
      recording.blob,
      recording.blob.type || 'audio/webm',
    ),

  /** The spoken answer as audio; `truncated` says the text was cut to the length limit. */
  async speak(
    workspaceId: string,
    text: string,
    scope?: VoiceScope,
  ): Promise<{ blob: Blob; truncated: boolean }> {
    const response = await apiPost(`${base(workspaceId)}/speak`, { text, ...scope });
    return {
      blob: await response.blob(),
      truncated: response.headers.get('x-voice-truncated') === '1',
    };
  },

  async preview(
    workspaceId: string,
    input: { text: string; voiceId?: string; model?: string; speed?: number },
  ): Promise<Blob> {
    return (await apiPost(`${base(workspaceId)}/preview`, input)).blob();
  },

  catalog: (workspaceId: string, provider?: VoiceBrand) =>
    apiGet<{ provider: string; models: VoiceModelInfo[]; voices: VoiceInfo[] }>(
      `${base(workspaceId)}/catalog${query({ provider })}`,
    ),

  attach: (workspaceId: string, audioId: string, messageId: string) =>
    apiSend('POST', `${base(workspaceId)}/audio/${audioId}/attach`, { messageId }),
  deleteConversationAudio: (workspaceId: string, scope: VoiceScope) =>
    apiSend<{ deleted: number }>('DELETE', `${base(workspaceId)}/audio${query({ ...scope })}`),
  deleteMyAudio: (workspaceId: string) =>
    apiSend<{ deleted: number }>('DELETE', `${base(workspaceId)}/audio`),
  deleteWorkspaceAudio: (workspaceId: string) =>
    apiSend<{ deleted: number }>('DELETE', `${base(workspaceId)}/workspace-audio`),
  purgeExpired: (workspaceId: string) =>
    apiSend<{ deleted: number }>('POST', `${base(workspaceId)}/workspace-audio/purge-expired`),

  usage: (workspaceId: string, days: number, all: boolean) =>
    apiGet<VoiceUsage>(
      `${base(workspaceId)}/usage${all ? '/all' : ''}${query({ days: String(days) })}`,
    ),
  prices: (workspaceId: string) => apiGet<{ items: VoicePrice[] }>(`${base(workspaceId)}/prices`),
  addPrice: (workspaceId: string, input: Omit<VoicePrice, 'id'>) =>
    apiSend('POST', `${base(workspaceId)}/prices`, stripNulls(input)),
};

function stripNulls<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null)) as Partial<T>;
}
