import { VOICE_WORKLET_SOURCE } from '../live-assistant/voice-worklet-source';

/** The microphone capture code of the live assistant, served from the page's own address. */
export function GET(): Response {
  return new Response(VOICE_WORKLET_SOURCE, {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
