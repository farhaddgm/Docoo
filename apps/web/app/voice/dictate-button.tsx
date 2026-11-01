'use client';

import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '../api-client';
import { useReadOnlyAccess } from '../[locale]/resource-access';
import type { Locale } from '../i18n';
import { useRecorder, type Recording } from './use-recorder';
import { voiceApi, type VoiceClientConfig } from './voice-api';
import { formatElapsed, problemFor } from './voice-helpers';
import { fillText, voiceMessages } from './voice-messages';

/** One config read per workspace for all the answer boxes of a page. */
const configs = new Map<string, Promise<VoiceClientConfig | null>>();
function configFor(workspaceId: string): Promise<VoiceClientConfig | null> {
  let known = configs.get(workspaceId);
  if (!known) {
    known = voiceApi.config(workspaceId).catch(() => null);
    configs.set(workspaceId, known);
  }
  return known;
}

/**
 * Dictation for one text field (ADR-0046): record, turn the speech into text and hand the text to
 * the field, which the administrator still reads and edits before saving anything. It is shown
 * only when voice is switched on and set up, and never to a read-only account. Nothing is stored.
 */
export function DictateButton({
  locale,
  workspaceId,
  disabled = false,
  onText,
}: {
  readonly locale: Locale;
  readonly workspaceId: string;
  readonly disabled?: boolean;
  readonly onText: (text: string) => void;
}) {
  const text = voiceMessages(locale);
  const readOnly = useReadOnlyAccess();
  const [config, setConfig] = useState<VoiceClientConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let live = true;
    void configFor(workspaceId).then((value) => {
      if (live) setConfig(value);
    });
    return () => {
      live = false;
    };
  }, [workspaceId]);

  const transcribe = useCallback(
    async (recording: Recording) => {
      setBusy(true);
      setProblem('');
      try {
        const result = await voiceApi.transcribe(workspaceId, {
          blob: recording.blob,
          durationMs: recording.durationMs,
          locale,
        });
        if (result.text.trim()) onText(result.text.trim());
        else setProblem(text.nothingHeard);
      } catch (error) {
        setProblem(
          text.problems[
            error instanceof ApiError ? problemFor(error.code, error.status) : 'unknown'
          ],
        );
      } finally {
        setBusy(false);
      }
    },
    [locale, onText, text, workspaceId],
  );

  const recorder = useRecorder(config?.maxRecordSeconds ?? 120, (recording) => {
    void transcribe(recording);
  });

  if (readOnly || !config || config.unavailableReason !== null) return null;
  const recording = recorder.state === 'recording';
  const failure =
    problem ||
    (recorder.failure === 'denied'
      ? text.micDenied
      : recorder.failure === 'no_device'
        ? text.noDevice
        : recorder.failure === 'unsupported'
          ? text.noMic
          : '');

  return (
    <div className="toolbar">
      <button
        type="button"
        className={recording ? 'primary-button voice-recording' : 'secondary-button'}
        aria-pressed={recording}
        aria-label={recording ? text.stop : text.dictate}
        title={recording ? text.stop : text.dictate}
        disabled={disabled || busy || recorder.state === 'requesting'}
        onClick={() => {
          if (!recording) {
            setProblem('');
            void recorder.start();
            return;
          }
          void recorder.stop().then((result) => (result ? transcribe(result) : undefined));
        }}
      >
        {recording ? '■' : '🎙'}
      </button>
      {recording && (
        <>
          <span role="status" className="voice-clock">
            {fillText(text.recording, {
              time: formatElapsed(recorder.elapsed),
              max: formatElapsed(config.maxRecordSeconds),
            })}
          </span>
          <button
            type="button"
            className="secondary-button"
            aria-label={text.cancel}
            title={text.cancel}
            onClick={recorder.cancel}
          >
            ✕
          </button>
        </>
      )}
      {busy && (
        <span role="status" className="muted">
          {text.transcribing}
        </span>
      )}
      {failure && (
        <small className="field-error" role="alert">
          {failure}
        </small>
      )}
    </div>
  );
}
