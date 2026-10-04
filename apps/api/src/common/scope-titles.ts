import type { PoolClient } from 'pg';

export interface ScopeRef {
  readonly type: 'workspace' | 'topic' | 'project';
  readonly id: string;
}

/** Key of a scope in the map `scopeTitles` returns. */
export const scopeKey = (scope: ScopeRef): string => `${scope.type}:${scope.id}`;

/**
 * Titles of the topics and projects scopes point to, so a screen can name a scope instead of
 * showing its id. A workspace has no title here (the screen says "whole workspace"); a removed
 * topic or project keeps its title because knowledge scoped to it still exists.
 */
export async function scopeTitles(
  client: PoolClient,
  scopes: readonly ScopeRef[],
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const topicIds = [...new Set(scopes.filter((s) => s.type === 'topic').map((s) => s.id))];
  const projectIds = [...new Set(scopes.filter((s) => s.type === 'project').map((s) => s.id))];
  if (topicIds.length > 0) {
    const topics = await client.query<{ id: string; title: string }>(
      'select id, title from topics where id = any($1::uuid[])',
      [topicIds],
    );
    for (const row of topics.rows) titles.set(`topic:${row.id}`, row.title);
  }
  if (projectIds.length > 0) {
    const projects = await client.query<{ id: string; title: string }>(
      'select id, title from projects where id = any($1::uuid[])',
      [projectIds],
    );
    for (const row of projects.rows) titles.set(`project:${row.id}`, row.title);
  }
  return titles;
}
