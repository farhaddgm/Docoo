import { createHmac, randomBytes } from 'node:crypto';

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function digestSecret(value: string, pepper: string): string {
  return createHmac('sha256', pepper).update(value).digest('hex');
}
