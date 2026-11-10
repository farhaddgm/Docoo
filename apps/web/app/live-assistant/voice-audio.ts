import { LIVE_VOICE_SAMPLE_RATE } from '@docoo/contracts';

import { VOICE_WORKLET_URL } from './voice-constants';

/**
 * Audio on the browser side of the voice link: 16-bit mono PCM at 24 kHz both ways, as the wire
 * protocol says. The conversions are plain functions so they can be tested without a browser; the
 * microphone and the speaker wrap the browser's audio API and are replaced in tests.
 */

/** Float samples (-1..1) to 16-bit little-endian PCM; louder than full scale is clipped. */
export function floatToPcm16(samples: Float32Array): ArrayBuffer {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const clipped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    out[i] = clipped < 0 ? Math.round(clipped * 0x8000) : Math.round(clipped * 0x7fff);
  }
  return out.buffer;
}

/** 16-bit little-endian PCM to float samples; a trailing odd byte is ignored. */
export function pcm16ToFloat(pcm: ArrayBuffer): Float32Array {
  const view = new DataView(pcm);
  const count = Math.floor(pcm.byteLength / 2);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const value = view.getInt16(i * 2, true);
    out[i] = value < 0 ? value / 0x8000 : value / 0x7fff;
  }
  return out;
}

/** Linear resampling to the wire rate (the microphone's own rate is rarely 24 kHz). */
export function resampleTo(
  samples: Float32Array,
  fromRate: number,
  toRate: number = LIVE_VOICE_SAMPLE_RATE,
): Float32Array {
  if (fromRate === toRate || samples.length === 0) return samples;
  const length = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  const out = new Float32Array(length);
  const step = fromRate / toRate;
  for (let i = 0; i < length; i += 1) {
    const position = i * step;
    const before = Math.floor(position);
    const after = Math.min(before + 1, samples.length - 1);
    const fraction = position - before;
    out[i] = (samples[before] ?? 0) * (1 - fraction) + (samples[after] ?? 0) * fraction;
  }
  return out;
}

export interface Microphone {
  /** Asks for the microphone and starts sending frames of wire-format PCM. */
  start(onFrame: (pcm: ArrayBuffer) => void): Promise<void>;
  stop(): void;
}

export interface Speaker {
  /** Queues a piece of the assistant's speech behind what is already playing. */
  play(pcm: ArrayBuffer): void;
  /** Drops what is queued and stops what is playing (the person talked over the assistant). */
  clear(): void;
  close(): void;
}

export function createBrowserMicrophone(): Microphone {
  let context: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let node: AudioWorkletNode | null = null;
  return {
    async start(onFrame) {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      context = new AudioContext();
      await context.audioWorklet.addModule(VOICE_WORKLET_URL);
      const rate = context.sampleRate;
      node = new AudioWorkletNode(context, 'docoo-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
      node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        onFrame(floatToPcm16(resampleTo(new Float32Array(event.data), rate)));
      };
      context.createMediaStreamSource(stream).connect(node);
    },
    stop() {
      try {
        node?.port.close();
        node?.disconnect();
        stream?.getTracks().forEach((track) => track.stop());
        void context?.close();
      } catch {
        /* already stopped */
      }
      node = null;
      stream = null;
      context = null;
    },
  };
}

export function createBrowserSpeaker(): Speaker {
  let context: AudioContext | null = null;
  let playAt = 0;
  const playing = new Set<AudioBufferSourceNode>();
  const ensure = (): AudioContext => {
    context ??= new AudioContext();
    return context;
  };
  return {
    play(pcm) {
      const audio = ensure();
      const samples = pcm16ToFloat(pcm);
      if (samples.length === 0) return;
      const buffer = audio.createBuffer(1, samples.length, LIVE_VOICE_SAMPLE_RATE);
      buffer.copyToChannel(new Float32Array(samples), 0);
      const source = audio.createBufferSource();
      source.buffer = buffer;
      source.connect(audio.destination);
      // Back to back, with a tiny lead the first time so the start is not clipped.
      playAt = Math.max(playAt, audio.currentTime + 0.05);
      source.start(playAt);
      playAt += buffer.duration;
      playing.add(source);
      source.onended = () => playing.delete(source);
    },
    clear() {
      for (const source of playing) {
        try {
          source.stop();
        } catch {
          /* already ended */
        }
      }
      playing.clear();
      playAt = 0;
    },
    close() {
      this.clear();
      void context?.close();
      context = null;
    },
  };
}
