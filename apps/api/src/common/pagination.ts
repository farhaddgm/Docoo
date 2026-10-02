import { z } from 'zod';

import { badRequest } from './problems.js';

const timestampSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
const cursorSchema = z
  .object({ version: z.literal(1), scope: z.string().min(1), at: timestampSchema, id: z.uuid() })
  .strict();

export type Cursor = z.infer<typeof cursorSchema>;

/** Formats timestamptz with microseconds so keyset cursors compare exactly. */
export function isoColumn(column: string, alias: string): string {
  return `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ${alias}`;
}

export const pageQuerySchema = {
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(512).optional(),
};

/** Opaque keyset cursor bound to a scope (for example a workspace and list name). */
export function encodeCursor(scope: string, at: string, id: string): string {
  return Buffer.from(JSON.stringify({ version: 1, scope, at, id })).toString('base64url');
}

export function decodeCursor(raw: string, scope: string, code: string): Cursor {
  try {
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(raw)) throw new Error('Invalid cursor encoding');
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    if (Buffer.from(json).toString('base64url') !== raw) throw new Error('Invalid encoding');
    const cursor = cursorSchema.parse(JSON.parse(json));
    if (cursor.scope !== scope || !Number.isFinite(Date.parse(cursor.at))) {
      throw new Error('Invalid cursor context');
    }
    return cursor;
  } catch {
    throw badRequest(code, 'The page cursor is invalid.');
  }
}
