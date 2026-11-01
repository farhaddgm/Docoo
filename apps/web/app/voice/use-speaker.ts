'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { voiceApi, type VoiceScope } from './voice-api';

/**
 * Plays one spoken answer at a time. A played answer is kept in memory for this visit so that
 * playing it again does not call the voice provider (and cost) a second time (ADR-0046).
 */
export function useSpeaker(workspaceId: string, volume: number) {
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const cache = useRef(new Map<string, { blob: Blob; truncated: boolean }>());
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const token = useRef(0);

  const halt = useCallback(() => {
    token.current += 1;
    audio.current?.pause();
    audio.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setPlayingKey(null);
    setLoadingKey(null);
  }, []);

  useEffect(() => halt, [halt]);

  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
  }, [volume]);

  /** Reads `text`; a second call with the same key while it plays stops it. Throws what the API refuses. */
  const play = useCallback(
    async (key: string, text: string, scope?: VoiceScope) => {
      if (playingKey === key || loadingKey === key) {
        halt();
        return;
      }
      halt();
      const mine = token.current;
      setLoadingKey(key);
      try {
        let entry = cache.current.get(key);
        if (!entry) {
          entry = await voiceApi.speak(workspaceId, text, scope);
          cache.current.set(key, entry);
        }
        if (mine !== token.current) return;
        setTruncated(entry.truncated);
        url.current = URL.createObjectURL(entry.blob);
        const element = new Audio(url.current);
        element.volume = volumeRef.current;
        element.onended = () => {
          if (mine === token.current) halt();
        };
        audio.current = element;
        setLoadingKey(null);
        setPlayingKey(key);
        await element.play();
      } catch (error) {
        if (mine === token.current) halt();
        throw error;
      }
    },
    [halt, loadingKey, playingKey, workspaceId],
  );

  return { play, stop: halt, loadingKey, playingKey, truncated };
}
