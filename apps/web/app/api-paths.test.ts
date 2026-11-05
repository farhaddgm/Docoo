import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The web server sends every `/api/...` request to the API's `/v1/...` (next.config.ts), so a path
 * given to the API client must not start with `/v1` itself: it would arrive as `/v1/v1/...` and
 * answer 404. This looks for a quoted or template path that starts with it.
 */
const ROOT = join(import.meta.dirname);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
    return /\.tsx?$/u.test(entry.name) && !/\.test\./u.test(entry.name) ? [path] : [];
  });
}

/** String starts of the form '/v1/...', "/v1/..." or `/v1/...` (the path's first segment is `v1`). */
export function versionedPaths(source: string): string[] {
  return source.match(/['"`]\/v1\/[^'"`]*/gu) ?? [];
}

describe('API client paths', () => {
  it('no source gives the API client a path that starts with /v1', () => {
    const offenders = sources(ROOT).flatMap((file) =>
      versionedPaths(readFileSync(file, 'utf8')).map(
        (path) => `${file.slice(ROOT.length)}: ${path}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('the check itself sees such a path in every kind of string', () => {
    expect(versionedPaths("apiGet('/v1/workspaces/x')")).toHaveLength(1);
    expect(versionedPaths('apiGet(`/v1/workspaces/${id}`)')).toHaveLength(1);
    expect(versionedPaths('apiGet("/v1/workspaces")')).toHaveLength(1);
    expect(versionedPaths("apiGet('/workspaces/x/v1/y')")).toHaveLength(0);
  });
});
