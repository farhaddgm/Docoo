import type { FastifyInstance } from 'fastify';

/** The most a recording may weigh; at 32 kbit/s that is far more than the longest allowed ten minutes. */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/**
 * Lets a route receive a recording as its raw body (`Content-Type: audio/webm`, ...), up to
 * `MAX_AUDIO_BYTES`. Other routes keep Fastify's default body limit, and the bytes are still
 * checked against the format's signature in the service.
 */
export function registerAudioBodyParser(instance: FastifyInstance): void {
  instance.addContentTypeParser(
    /^audio\/(webm|ogg|mp4|wav|mpeg)(;.*)?$/u,
    { parseAs: 'buffer', bodyLimit: MAX_AUDIO_BYTES },
    (_request, body, done) => done(null, body),
  );
}
