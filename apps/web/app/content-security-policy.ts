/**
 * The one other origin a page may call is the object store that takes presigned uploads
 * (S3_PUBLIC_ENDPOINT); answer files go from the browser straight to it (ING-001).
 */
export function uploadOrigin(endpoint: string | undefined): string | null {
  if (!endpoint) return null;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Same-origin only; the API is reached through the `/api` rewrite and uploads go to the files
 * host. Next.js needs inline scripts for hydration data, so script-src allows 'unsafe-inline'
 * but no other origin.
 */
export function contentSecurityPolicy(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const files = uploadOrigin(env['S3_PUBLIC_ENDPOINT']);
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    ["connect-src 'self'", files].filter(Boolean).join(' '),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
