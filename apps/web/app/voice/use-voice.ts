'use client';

import { defaultVoicePreferences, type VoiceMode } from '@docoo/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../api-client';
import type { Locale } from '../i18n';
import { useRecorder, type Recording } from './use-recorder';
import { useSpeaker } from './use-speaker';
import {
  voiceApi,
  type VoiceClientConfig,
  type VoicePreferences,
  type VoiceScope,
} from './voice-api';
import { appendTranscript, problemFor } from './voice-helpers';
import { voiceMessages } from './voice-messages';

export interface TranscriptEvent {
  readonly text: string;
  /** True when the account chose voice input with auto-send: the caller may send it at once. */
  readonly sendNow: boolean;
  readonly audioId: string | null;
}

export interface UseVoiceOptions {
  readonly locale: Locale;
  readonly workspaceId: string;
  /** The conversation recordings belong to; without one nothing is ever stored. */
  readonly scope: VoiceScope | null;
  /**
   * Called after a recording when the account keeps recordings, to get (or start) the conversation
   * the recording belongs to. Without it a recording is stored only when `scope` already exists.
   */
  readonly ensureScope?: (() => Promise<VoiceScope | null>) | undefined;
  readonly onTranscript: (event: TranscriptEvent) => void;
}

/** One chat box's voice: the account's mode, the recorder, the speaker and the last problem. */
export function useVoice({
  locale,
  workspaceId,
  scope,
  ensureScope,
  onTranscript,
}: UseVoiceOptions) {
  const text = voiceMessages(locale);
  const [config, setConfig] = useState<VoiceClientConfig | null>(null);
  const [prefs, setPrefs] = useState<VoicePreferences>(defaultVoicePreferences);
  const [transcribing, setTranscribing] = useState(false);
  const [problem, setProblem] = useState('');
  const [muted, setMuted] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handler = useRef(onTranscript);
  handler.current = onTranscript;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const ensureRef = useRef(ensureScope);
  ensureRef.current = ensureScope;
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    let live = true;
    void Promise.all([voiceApi.config(workspaceId), voiceApi.preferences(workspaceId)])
      .then(([nextConfig, nextPrefs]) => {
        if (!live) return;
        setConfig(nextConfig);
        setPrefs(nextPrefs);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [workspaceId]);

  const explain = useCallback(
    (error: unknown) => {
      const known = error instanceof ApiError ? problemFor(error.code, error.status) : 'unknown';
      setProblem(text.problems[known]);
    },
    [text],
  );

  const update = useCallback(
    (patch: Partial<VoicePreferences>) => {
      const next = { ...prefsRef.current, ...patch };
      setPrefs(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void voiceApi.savePreferences(workspaceId, next).catch(() => undefined);
      }, 400);
    },
    [workspaceId],
  );

  const send = useCallback(
    async (recording: Recording) => {
      setTranscribing(true);
      setProblem('');
      try {
        const keeps = configRef.current?.storesAdminAudio === true;
        const target = keeps && ensureRef.current ? await ensureRef.current() : scopeRef.current;
        const result = await voiceApi.transcribe(workspaceId, {
          blob: recording.blob,
          durationMs: recording.durationMs,
          locale,
          scope: keeps ? (target ?? undefined) : undefined,
        });
        if (!result.text.trim()) {
          setProblem(text.nothingHeard);
          return;
        }
        handler.current({
          text: result.text.trim(),
          sendNow: prefsRef.current.input === 'voice' && prefsRef.current.autoSend,
          audioId: result.audioId,
        });
      } catch (error) {
        explain(error);
      } finally {
        setTranscribing(false);
      }
    },
    [explain, locale, text.nothingHeard, workspaceId],
  );

  const recorder = useRecorder(
    config?.maxRecordSeconds ?? 120,
    (recording) => void send(recording),
  );
  const speaker = useSpeaker(workspaceId, muted ? 0 : prefs.volume);

  const ready = Boolean(config?.enabled && config.unavailableReason === null);
  const unavailable = config
    ? config.unavailableReason
      ? text.unavailable[config.unavailableReason]
      : ''
    : '';

  const toggleRecording = useCallback(async () => {
    if (recorder.state === 'recording') {
      const recording = await recorder.stop();
      if (recording) await send(recording);
      return;
    }
    speaker.stop();
    await recorder.start();
  }, [recorder, send, speaker]);

  /** Reads an answer aloud, or stops it when it is already playing. */
  const speak = useCallback(
    async (key: string, content: string) => {
      setProblem('');
      try {
        await speaker.play(key, content, scopeRef.current ?? undefined);
      } catch (error) {
        explain(error);
      }
    },
    [explain, speaker],
  );

  const recorderProblem = recorder.failure
    ? recorder.failure === 'denied'
      ? text.micDenied
      : recorder.failure === 'no_device'
        ? text.noDevice
        : text.noMic
    : '';

  return {
    config,
    prefs,
    ready,
    unavailable,
    setInput: (input: VoiceMode) => update({ input }),
    setOutput: (output: VoiceMode) => update({ output }),
    setVolume: (volume: number) => {
      setMuted(false);
      update({ volume });
    },
    setAutoSend: (autoSend: boolean) => update({ autoSend }),
    muted,
    toggleMute: () => setMuted((value) => !value),
    recorder,
    transcribing,
    toggleRecording,
    cancelRecording: recorder.cancel,
    speaker,
    speak,
    problem: problem || recorderProblem,
    clearProblem: () => setProblem(''),
    /** True when a finished answer should be read aloud on its own. */
    autoSpeak: ready && prefs.output === 'voice',
  };
}

export type VoiceController = ReturnType<typeof useVoice>;

export { appendTranscript };
