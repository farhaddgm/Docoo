'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { pickRecordingType } from './voice-helpers';

export type RecorderState = 'idle' | 'requesting' | 'recording';
export type RecorderFailure = 'unsupported' | 'denied' | 'no_device';

export interface Recording {
  readonly blob: Blob;
  readonly durationMs: number;
}

export function canRecord(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    pickRecordingType((type) => MediaRecorder.isTypeSupported(type)) !== null
  );
}

/**
 * Records the microphone until `stop()` (which resolves with the audio) or `cancel()`. The clock
 * stops the recording by itself at `maxSeconds`; the track is always released afterwards.
 */
export function useRecorder(maxSeconds: number, onAutoStop: (recording: Recording) => void) {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [failure, setFailure] = useState<RecorderFailure | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const finish = useRef<((recording: Recording | null) => void) | null>(null);
  const autoStop = useRef(onAutoStop);
  autoStop.current = onAutoStop;

  const release = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    recorder.current = null;
    setState('idle');
    setElapsed(0);
  }, []);

  useEffect(() => release, [release]);

  const start = useCallback(async () => {
    setFailure(null);
    const type = canRecord() ? pickRecordingType((t) => MediaRecorder.isTypeSupported(t)) : null;
    if (!type) {
      setFailure('unsupported');
      return;
    }
    setState('requesting');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      setState('idle');
      setFailure(
        error instanceof DOMException && error.name === 'NotFoundError' ? 'no_device' : 'denied',
      );
      return;
    }
    chunks.current = [];
    const media = new MediaRecorder(stream.current, { mimeType: type });
    recorder.current = media;
    media.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    media.onstop = () => {
      const durationMs = Date.now() - startedAt.current;
      const blob = new Blob(chunks.current, { type: media.mimeType || type });
      const done = finish.current;
      finish.current = null;
      release();
      const recording = blob.size > 0 ? { blob, durationMs } : null;
      if (done) done(recording);
      else if (recording) autoStop.current(recording);
    };
    startedAt.current = Date.now();
    media.start();
    setState('recording');
    timer.current = setInterval(() => {
      const seconds = (Date.now() - startedAt.current) / 1000;
      setElapsed(seconds);
      if (seconds >= maxSeconds && media.state === 'recording') media.stop();
    }, 250);
  }, [maxSeconds, release]);

  const stop = useCallback(
    () =>
      new Promise<Recording | null>((resolve) => {
        const media = recorder.current;
        if (!media || media.state !== 'recording') return resolve(null);
        finish.current = resolve;
        media.stop();
      }),
    [],
  );

  const cancel = useCallback(() => {
    const media = recorder.current;
    finish.current = () => undefined;
    if (media && media.state === 'recording') media.stop();
    else release();
  }, [release]);

  return { state, elapsed, failure, start, stop, cancel };
}
