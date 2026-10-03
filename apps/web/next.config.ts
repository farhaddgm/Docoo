import type { NextConfig } from 'next';

/**
 * Same-origin only; the API is reached through the `/api` rewrite. Next.js needs inline
 * scripts for hydration data, so script-src allows 'unsafe-inline' but no other origin.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  redirects() {
    return Promise.resolve([{ source: '/', destination: '/fa', permanent: false }]);
  },
  rewrites() {
    const apiUrl = (process.env['API_PUBLIC_URL'] ?? 'http://localhost:4000').replace(/\/$/, '');
    return Promise.resolve([{ source: '/api/:path*', destination: `${apiUrl}/v1/:path*` }]);
  },
  headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
        ],
      },
    ];
  },
};

export default nextConfig;
