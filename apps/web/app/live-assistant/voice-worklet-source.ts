/**
 * The code that runs on the browser's audio thread to capture the microphone. It only gathers the
 * small blocks the browser hands it into about 40 ms of samples and posts them to the page, which
 * converts and sends them. It is served from the page's own address (`/voice-worklet.js`), so the
 * Content-Security-Policy (`script-src 'self'`) allows it without relaxing anything.
 */
export const VOICE_WORKLET_SOURCE = `
class DoocoCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.count = 0;
    // About 40 ms at the context's own sample rate.
    this.target = Math.round(sampleRate * 0.04);
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) {
      this.buffer.push(new Float32Array(channel));
      this.count += channel.length;
      if (this.count >= this.target) {
        const out = new Float32Array(this.count);
        let at = 0;
        for (const block of this.buffer) {
          out.set(block, at);
          at += block.length;
        }
        this.buffer = [];
        this.count = 0;
        this.port.postMessage(out.buffer, [out.buffer]);
      }
    }
    return true;
  }
}
registerProcessor('docoo-capture', DoocoCapture);
`;
