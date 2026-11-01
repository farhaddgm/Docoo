'use client';

import { useState } from 'react';

import type { Locale } from '../i18n';
import { voiceApi, type VoiceScope } from './voice-api';
import { describeMode, formatElapsed } from './voice-helpers';
import { fillText, voiceMessages } from './voice-messages';
import type { VoiceController } from './use-voice';

interface VoiceBarProps {
  readonly locale: Locale;
  readonly workspaceId: string;
  readonly voice: VoiceController;
  /** The conversation whose recordings the "delete" button removes; null when there is none yet. */
  readonly scope: VoiceScope | null;
  /** The chat is busy answering: recording waits. */
  readonly disabled?: boolean;
}

/** The record button, the speaker settings and the two mode choices of one chat box (ADR-0046). */
export function VoiceBar({ locale, workspaceId, voice, scope, disabled = false }: VoiceBarProps) {
  const text = voiceMessages(locale);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const { prefs, recorder, speaker } = voice;
  const recording = recorder.state === 'recording';
  const mode = describeMode(prefs.input, prefs.output);
  const modeLabel = {
    text: text.modeText,
    dictate: text.modeDictate,
    listen: text.modeListen,
    talk: text.modeTalk,
  }[mode];
  const busy = voice.transcribing || recorder.state === 'requesting';
  const max = voice.config?.maxRecordSeconds ?? 120;

  async function remove(all: boolean) {
    try {
      const result = all
        ? await voiceApi.deleteMyAudio(workspaceId)
        : scope
          ? await voiceApi.deleteConversationAudio(workspaceId, scope)
          : { deleted: 0 };
      setNote(fillText(text.deleted, { n: result.deleted }));
    } catch {
      setNote(text.problems.unknown);
    }
  }

  const blocked = !voice.ready;
  const why = voice.unavailable;

  return (
    <div
      className="voice-bar"
      role="group"
      aria-label={text.bar}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <div className="voice-modes" title={modeLabel}>
        <label>
          <span className="muted">{text.input}</span>{' '}
          <select
            value={prefs.input}
            disabled={blocked}
            onChange={(event) => voice.setInput(event.target.value === 'voice' ? 'voice' : 'text')}
          >
            <option value="text">{text.text}</option>
            <option value="voice">{text.voice}</option>
          </select>
        </label>
        <label>
          <span className="muted">{text.output}</span>{' '}
          <select
            value={prefs.output}
            disabled={blocked}
            onChange={(event) => voice.setOutput(event.target.value === 'voice' ? 'voice' : 'text')}
          >
            <option value="text">{text.text}</option>
            <option value="voice">{text.voice}</option>
          </select>
        </label>
      </div>

      <button
        type="button"
        className={recording ? 'primary-button voice-recording' : 'secondary-button'}
        aria-pressed={recording}
        aria-label={recording ? text.stop : text.record}
        title={blocked ? why : recording ? text.stop : text.record}
        disabled={blocked || busy || (disabled && !recording)}
        onClick={() => void voice.toggleRecording()}
      >
        {recording ? '■' : '🎙'}
      </button>
      {recording && (
        <>
          <span role="status" className="voice-clock">
            {fillText(text.recording, {
              time: formatElapsed(recorder.elapsed),
              max: formatElapsed(max),
            })}
          </span>
          <button
            type="button"
            className="secondary-button"
            onClick={voice.cancelRecording}
            aria-label={text.cancel}
            title={text.cancel}
          >
            ✕
          </button>
        </>
      )}
      {recorder.state === 'requesting' && (
        <span role="status" className="muted">
          {text.requesting}
        </span>
      )}
      {voice.transcribing && (
        <span role="status" className="muted">
          {text.transcribing}
        </span>
      )}

      <button
        type="button"
        className="secondary-button"
        aria-expanded={open}
        aria-label={text.speaker}
        title={text.speaker}
        onClick={() => setOpen((value) => !value)}
      >
        {voice.muted || prefs.volume === 0 ? '🔇' : '🔊'}
      </button>

      {open && (
        <div className="voice-popover" role="dialog" aria-label={text.speaker}>
          <label className="voice-volume">
            <span>{text.volume}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={voice.muted ? 0 : prefs.volume}
              onChange={(event) => voice.setVolume(Number(event.target.value))}
              aria-label={text.volume}
            />
          </label>
          <button type="button" className="secondary-button" onClick={voice.toggleMute}>
            {voice.muted ? text.unmute : text.mute}
          </button>
          <label className="voice-check">
            <input
              type="checkbox"
              checked={prefs.autoSend}
              onChange={(event) => voice.setAutoSend(event.target.checked)}
            />{' '}
            {text.autoSend}
          </label>
          <p className="muted">{text.autoSendHint}</p>
          <p className="muted">{text.replayCosts}</p>
          {voice.config?.storesAdminAudio && (
            <>
              <p className="muted">{text.storesNote}</p>
              {scope && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void remove(false)}
                >
                  {text.deleteAudio}
                </button>
              )}
              <button type="button" className="secondary-button" onClick={() => void remove(true)}>
                {text.deleteMine}
              </button>
            </>
          )}
          {note && <p role="status">{note}</p>}
        </div>
      )}

      {blocked && voice.config && <span className="muted">{why}</span>}
      {speaker.truncated && <span className="muted">{text.truncated}</span>}
      {voice.problem && (
        <p className="notice error" role="alert">
          {voice.problem}
        </p>
      )}
    </div>
  );
}

/** The play button beside one answer. */
export function SpeakButton({
  locale,
  voice,
  id,
  content,
}: {
  readonly locale: Locale;
  readonly voice: VoiceController;
  readonly id: string;
  readonly content: string;
}) {
  const text = voiceMessages(locale);
  if (!voice.ready) return null;
  const playing = voice.speaker.playingKey === id;
  const loading = voice.speaker.loadingKey === id;
  return (
    <button
      type="button"
      className="secondary-button"
      aria-label={playing ? text.pause : text.play}
      title={loading ? text.loading : playing ? text.pause : text.play}
      aria-pressed={playing}
      onClick={() => void voice.speak(id, content)}
    >
      {loading ? '…' : playing ? '⏸' : '▶'}
    </button>
  );
}
