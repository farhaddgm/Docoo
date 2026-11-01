import { z } from 'zod';

/**
 * Voice conversation (ADR-0046). The administrator chooses how they speak and how Docoo answers;
 * the pipeline is always the text chat with speech to text before and text to speech after.
 */
export const voiceModes = ['text', 'voice'] as const;
export type VoiceMode = (typeof voiceModes)[number];

export const voiceBrands = ['openai', 'elevenlabs'] as const;
export type VoiceBrand = (typeof voiceBrands)[number];

/** The four combinations the chat box offers; text/text is today's behaviour. */
export interface ConversationMode {
  input: VoiceMode;
  output: VoiceMode;
}

export const conversationModeSchema = z.object({
  input: z.enum(voiceModes),
  output: z.enum(voiceModes),
});

export const voicePreferencesSchema = conversationModeSchema.extend({
  autoSend: z.boolean(),
  volume: z.number().min(0).max(1),
});
export type VoicePreferences = z.infer<typeof voicePreferencesSchema>;

export const defaultVoicePreferences: VoicePreferences = {
  input: 'text',
  output: 'text',
  autoSend: false,
  volume: 1,
};

/** The setting keys of the voice page, in the order the page shows them. */
export const voiceSettingKeys = [
  'voice.enabled',
  'voice.provider',
  'voice.connection_id',
  'voice.stt_model',
  'voice.tts_model',
  'voice.voice_id',
  'voice.speed',
  'voice.language_hint',
  'voice.max_record_s',
  'voice.max_tts_chars',
  'voice.store_admin_audio',
  'voice.audio_retention_days',
] as const;
export type VoiceSettingKey = (typeof voiceSettingKeys)[number];

/** What the chat box needs to know; it never carries a secret. */
export interface VoiceClientConfig {
  enabled: boolean;
  /** Why the buttons are disabled when they are; null when voice is ready to use. */
  unavailableReason: 'disabled' | 'not_configured' | null;
  provider: VoiceBrand;
  speed: number;
  maxRecordSeconds: number;
  maxTtsCharacters: number;
  storesAdminAudio: boolean;
}

export const voiceConversationKinds = ['smart', 'stage', 'analysis'] as const;
export type VoiceConversationKind = (typeof voiceConversationKinds)[number];

/** The question a chat box asks to know which parts of the pipeline a mode uses. */
export function voiceSteps(mode: ConversationMode): { transcribe: boolean; speak: boolean } {
  return { transcribe: mode.input === 'voice', speak: mode.output === 'voice' };
}
