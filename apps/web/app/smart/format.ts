const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** `/workspaces/3f2…/projects` → `/workspaces/:id/projects` for toasts and labels. */
export function normalizeDisplayPath(path: string): string {
  return path.split('?')[0]!.replace(uuidPattern, ':id').slice(0, 80);
}

/** Markdown block an admin pastes to a developer or to an assistant to get the problem fixed. */
export function developerReport(input: {
  header: string;
  id: string;
  title: string;
  status: string;
  createdAt: string;
  body: string;
  context: unknown;
  note: string;
}): string {
  return [
    `# ${input.header}`,
    '',
    `- ID: ${input.id}`,
    `- Title: ${input.title}`,
    `- Status: ${input.status}`,
    `- Saved at: ${input.createdAt}`,
    ...(input.note ? [`- Fix note: ${input.note}`] : []),
    '',
    '## Report',
    '',
    input.body,
    '',
    '## Context',
    '',
    '```json',
    JSON.stringify(input.context ?? {}, null, 2),
    '```',
    '',
  ].join('\n');
}
