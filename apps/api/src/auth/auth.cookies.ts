import type { FastifyReply } from 'fastify';

export const SESSION_COOKIE = 'docoo_session';

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(SESSION_COOKIE, { httpOnly: true, secure, sameSite: 'lax', path: '/' });
}
