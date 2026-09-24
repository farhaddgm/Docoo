import fs from 'node:fs/promises';

const endpoint = process.env.NOTION_SYNC_WEBHOOK_URL;
if (!endpoint) throw new Error('NOTION_SYNC_WEBHOOK_URL is required.');

const manifest = await fs.readFile('docs/_meta/notion-manifest.yaml', 'utf8');
const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(process.env.NOTION_SYNC_WEBHOOK_TOKEN
      ? { authorization: `Bearer ${process.env.NOTION_SYNC_WEBHOOK_TOKEN}` }
      : {}),
  },
  body: JSON.stringify({
    repository: 'https://github.com/farhaddgm/Docoo',
    commit: process.env.SOURCE_COMMIT ?? 'unknown',
    manifest,
  }),
});

if (!response.ok) {
  throw new Error(`Notion sync request failed with HTTP ${response.status}.`);
}

console.log(`Notion sync request accepted for ${process.env.SOURCE_COMMIT ?? 'unknown'}.`);
