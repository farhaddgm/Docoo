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

const icon = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export const MicIcon = () => (
  <svg {...icon}>
    <rect x="9" y="2.5" width="6" height="12" rx="3" />
    <path d="M5 11.5a7 7 0 0 0 14 0" />
    <path d="M12 18.5V22" />
  </svg>
);

export const StopIcon = () => (
  <svg {...icon} fill="currentColor" stroke="none">
    <rect x="6" y="6" width="12" height="12" rx="2.5" />
  </svg>
);

export const SpeakerIcon = ({ muted = false }: { muted?: boolean }) => (
  <svg {...icon}>
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" fill="currentColor" fillOpacity="0.15" />
    {muted ? (
      <path d="m16 9.5 5 5m0-5-5 5" />
    ) : (
      <>
        <path d="M15.5 9a4 4 0 0 1 0 6" />
        <path d="M18.2 6.5a8 8 0 0 1 0 11" />
      </>
    )}
  </svg>
);

const PlayIcon = () => (
  <svg {...icon} width={14} height={14} fill="currentColor" stroke="none">
    <path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2Z" />
  </svg>
);

const PauseIcon = () => (
  <svg {...icon} width={14} height={14} fill="currentColor" stroke="none">
    <rect x="6" y="5" width="4" height="14" rx="1.2" />
    <rect x="14" y="5" width="4" height="14" rx="1.2" />
  </svg>
);

/** The "input / reply" choices: text or voice. */
export function VoiceModes({ locale, voice }: { locale: Locale; voice: VoiceController }) {
  const text = voiceMessages(locale);
  const { prefs } = voice;
  const mode = describeMode(prefs.input, prefs.output);
  const modeLabel = {
    text: text.modeText,
    dictate: text.modeDictate,
    listen: text.modeListen,
    talk: text.modeTalk,
  }[mode];
  const blocked = !voice.ready;
  return (
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
  );
}

/** The record / stop button. */
export function MicButton({
  locale,
  voice,
  disabled = false,
}: {
  locale: Locale;
  voice: VoiceController;
  disabled?: boolean;
}) {
  const text = voiceMessages(locale);
  const { recorder } = voice;
  const recording = recorder.state === 'recording';
  const busy = voice.transcribing || recorder.state === 'requesting';
  const blocked = !voice.ready;
  return (
    <button
      type="button"
      className={
        recording
          ? 'primary-button voice-recording voice-icon-button'
          : 'secondary-button voice-icon-button'
      }
      aria-pressed={recording}
      aria-label={recording ? text.stop : text.record}
      title={blocked ? voice.unavailable : recording ? text.stop : text.record}
      disabled={blocked || busy || (disabled && !recording)}
      onClick={() => void voice.toggleRecording()}
    >
      {recording ? <StopIcon /> : <MicIcon />}
    </button>
  );
}

/** Recording clock, cancel, progress and problems of the voice controls. */
export function VoiceStatus({ locale, voice }: { locale: Locale; voice: VoiceController }) {
  const text = voiceMessages(locale);
  const { recorder, speaker } = voice;
  const recording = recorder.state === 'recording';
  const max = voice.config?.maxRecordSeconds ?? 120;
  return (
    <>
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
      {!voice.ready && voice.config && <span className="muted">{voice.unavailable}</span>}
      {speaker.truncated && <span className="muted">{text.truncated}</span>}
      {voice.problem && (
        <p className="notice error" role="alert">
          {voice.problem}
        </p>
      )}
    </>
  );
}

/** The speaker button; its settings open in a small popover right beside it. */
export function SpeakerMenu({
  locale,
  workspaceId,
  voice,
  scope,
}: {
  locale: Locale;
  workspaceId: string;
  voice: VoiceController;
  scope: VoiceScope | null;
}) {
  const text = voiceMessages(locale);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const { prefs } = voice;

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

  return (
    <span className="voice-speaker">
      <button
        type="button"
        className="secondary-button voice-icon-button"
        aria-expanded={open}
        aria-label={text.speaker}
        title={text.speaker}
        onClick={() => setOpen((value) => !value)}
      >
        <SpeakerIcon muted={voice.muted || prefs.volume === 0} />
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
    </span>
  );
}

/** The whole voice row of a chat box (used where the layout is not customised). */
export function VoiceBar({ locale, workspaceId, voice, scope, disabled = false }: VoiceBarProps) {
  const text = voiceMessages(locale);
  return (
    <div
      className="voice-bar"
      role="group"
      aria-label={text.bar}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <VoiceModes locale={locale} voice={voice} />
      <MicButton locale={locale} voice={voice} disabled={disabled} />
      <SpeakerMenu locale={locale} workspaceId={workspaceId} voice={voice} scope={scope} />
      <VoiceStatus locale={locale} voice={voice} />
    </div>
  );
}

/** The play button beside one answer, with a 1x / 2x speed switch. */
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
  const { rate, setRate } = voice.speaker;
  return (
    <>
      <button
        type="button"
        className="voice-play"
        aria-label={playing ? text.pause : text.play}
        title={loading ? text.loading : playing ? text.pause : text.play}
        aria-pressed={playing}
        onClick={() => void voice.speak(id, content)}
      >
        {loading ? (
          <span className="voice-play-dots">…</span>
        ) : playing ? (
          <PauseIcon />
        ) : (
          <PlayIcon />
        )}
      </button>
      <button
        type="button"
        className="voice-rate"
        aria-label={text.speed}
        title={text.speed}
        onClick={() => setRate(rate === 1 ? 2 : 1)}
      >
        {rate}x
      </button>
    </>
  );
}
