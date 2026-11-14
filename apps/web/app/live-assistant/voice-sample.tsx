'use client';

import { useEffect, useRef, useState } from 'react';

import { voiceApi } from '../voice/voice-api';

/** The words of the sample button, in the owner's language. */
export interface VoiceSampleText {
  readonly hear: string;
  readonly hearing: string;
  readonly failed: string;
  readonly needVoice: string;
  readonly sentence: string;
  readonly cost: string;
}

/**
 * Lets the owner hear a voice before choosing it. The sample is made by the server with the
 * assistant's own connection and speaking model (the same ones a conversation would use), played
 * from a local blob so nothing but the server's answer reaches the page, and stopped when the
 * page closes or another sample starts.
 */
export function VoiceSample({
  workspaceId,
  connectionId,
  voiceId,
  model,
  text,
}: {
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly voiceId: string;
  readonly model: string;
  readonly text: VoiceSampleText;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const player = useRef<HTMLAudioElement | null>(null);

  useEffect(
    () => () => {
      player.current?.pause();
      player.current = null;
    },
    [],
  );

  // A different voice is a different sample: what was said about the last one no longer applies.
  useEffect(() => setProblem(''), [voiceId, model, connectionId]);

  async function hear() {
    if (voiceId.trim() === '') {
      setProblem(text.needVoice);
      return;
    }
    setBusy(true);
    setProblem('');
    try {
      const blob = await voiceApi.preview(workspaceId, {
        text: text.sentence,
        voiceId,
        connectionId,
        ...(model.trim() === '' ? {} : { model }),
      });
      player.current?.pause();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      player.current = audio;
      await audio.play();
    } catch {
      setProblem(text.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <button
        type="button"
        className="secondary-button"
        disabled={busy || connectionId === ''}
        onClick={() => void hear()}
      >
        {busy ? text.hearing : text.hear}
      </button>
      <small className="muted">{text.cost}</small>
      {problem !== '' && (
        <p className="notice error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
