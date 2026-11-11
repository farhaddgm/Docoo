import { describe, expect, it } from 'vitest';

import { VOICE_WORKLET_SOURCE } from './voice-worklet-source';
import { floatToPcm16, pcm16ToFloat, resampleTo } from './voice-audio';
import { GET } from '../voice-worklet.js/route';

describe('voice audio conversions', () => {
  it('turns float samples into 16-bit PCM and back, clipping what is too loud', () => {
    const pcm = floatToPcm16(new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]));
    const ints = Array.from(new Int16Array(pcm));
    expect(ints).toEqual([0, 16384, -16384, 32767, -32768, 32767, -32768]);
    const back = pcm16ToFloat(pcm);
    expect(back[1]).toBeCloseTo(0.5, 3);
    expect(back[4]).toBe(-1);
  });

  it('ignores a trailing odd byte and empty audio', () => {
    expect(pcm16ToFloat(new ArrayBuffer(3)).length).toBe(1);
    expect(pcm16ToFloat(new ArrayBuffer(0)).length).toBe(0);
  });

  it('resamples to the wire rate and leaves matching or empty audio alone', () => {
    const input = new Float32Array(480).fill(0.25);
    expect(resampleTo(input, 24000)).toBe(input);
    const down = resampleTo(new Float32Array(960).fill(0.25), 48000);
    expect(down.length).toBe(480);
    expect(down.every((value) => Math.abs(value - 0.25) < 1e-6)).toBe(true);
    const up = resampleTo(new Float32Array(160).fill(0.1), 16000);
    expect(up.length).toBe(240);
    expect(resampleTo(new Float32Array(0), 48000).length).toBe(0);
  });

  it('serves the capture code from the page address as JavaScript', async () => {
    const response = GET();
    expect(response.headers.get('content-type')).toContain('text/javascript');
    expect(await response.text()).toBe(VOICE_WORKLET_SOURCE);
    expect(VOICE_WORKLET_SOURCE).toContain("registerProcessor('docoo-capture'");
    // No network, no eval: it only gathers samples.
    expect(VOICE_WORKLET_SOURCE).not.toMatch(/fetch\(|eval\(|importScripts/u);
  });
});
