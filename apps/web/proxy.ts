import { NextResponse, type NextRequest } from 'next/server';

import { contentSecurityPolicy } from './app/content-security-policy';

/**
 * Sets the Content-Security-Policy on every page. It is built per request from the runtime
 * environment (the files host differs per deployment), which `next.config.ts` headers cannot
 * do because they are fixed when the image is built.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  const policy = contentSecurityPolicy(process.env, nonce);
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Cache-Control', 'private, no-store');
  if (request.nextUrl.pathname.endsWith('/auth/login-up'))
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  // Every path, static files included, as the policy always was (the 0.8.0 headers).
  matcher: '/:path*',
};
