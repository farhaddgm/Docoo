import type { NextConfig } from 'next';

/** The Content-Security-Policy is set per request in `proxy.ts`, because it names the deployment's files host. */
const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: { useTypeScriptCli: false },
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  redirects() {
    return Promise.resolve([
      { source: '/', destination: '/fa', permanent: false },
      { source: '/auth/login', destination: '/fa/auth/login', permanent: false },
      { source: '/auth/login-up', destination: '/fa/auth/login-up', permanent: false },
    ]);
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
          // The microphone is allowed for this origin only, for voice conversation (ADR-0046).
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
